"""Incremental SHA256 PDF indexer creating page scoped chunks and 768 dim Gemini embeddings in pgvector."""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

import yaml

import numpy as np
from dotenv import load_dotenv
from google import genai
from google.genai import types

from src.db.connection import bulk_execute, fetch_all, get_connection
from src.extract.bot_pdf_loader import (
    DOCS_RAW_DIR,
    assess_pdf_text_quality,
    create_ocr_review_draft,
    download_configured_pdfs,
    extract_pdf_pages,
    get_approved_ocr_pages,
)

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")

_PRIMARY_EMBEDDING_MODEL = (os.getenv("GEMINI_EMBEDDING_MODEL") or "gemini-embedding-001").strip()
EMBEDDING_MODELS: tuple[str, ...] = tuple(dict.fromkeys((_PRIMARY_EMBEDDING_MODEL, "gemini-embedding-001")))
EMBEDDING_DIM = 768
EMBED_BATCH_SIZE = 16


def _get_genai_client(timeout_ms: int = 25_000) -> genai.Client:
    """Create Gemini API client with explicit network timeout."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is missing from backend/.env")
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=timeout_ms))


def _l2_normalize(vec: list[float]) -> list[float]:
    """L2 normalize truncated 768 dim embedding vector for exact cosine distance."""
    arr = np.asarray(vec, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    if norm <= 1e-12:
        return arr.tolist()
    return (arr / norm).tolist()


def embed_texts_batch(
    texts: list[str],
    task_type: str = "RETRIEVAL_DOCUMENT",
    client: genai.Client | None = None,
) -> tuple[list[list[float]], str]:
    """Embed a batch of texts into L2 normalized 768 dim vectors using Gemini embedding models."""
    if not texts:
        return [], EMBEDDING_MODELS[0]
    if client is None:
        client = _get_genai_client()

    last_err: Exception | None = None
    for model_name in EMBEDDING_MODELS:
        try:
            all_vecs: list[list[float]] = []
            for start in range(0, len(texts), EMBED_BATCH_SIZE):
                batch = texts[start : start + EMBED_BATCH_SIZE]
                batch_vecs: list[list[float]] | None = None
                for attempt in range(5):
                    try:
                        res = client.models.embed_content(
                            model=model_name,
                            contents=batch,
                            config=types.EmbedContentConfig(
                                task_type=task_type,
                                output_dimensionality=EMBEDDING_DIM,
                            ),
                        )
                        if len(res.embeddings) != len(batch):
                            raise ValueError(
                                f"Embedding count mismatch ({len(res.embeddings)} returned for {len(batch)} inputs)"
                            )
                        batch_vecs = [_l2_normalize(list(emb.values)) for emb in res.embeddings]
                        break
                    except Exception as exc:
                        msg = str(exc)
                        is_rate_limit = ("429" in msg) or ("RESOURCE_EXHAUSTED" in msg) or ("503" in msg) or ("504" in msg)
                        if is_rate_limit and attempt < 4:
                            time.sleep(22.0 + attempt * 8.0)
                            continue
                        raise
                assert batch_vecs is not None
                all_vecs.extend(batch_vecs)
                if start + EMBED_BATCH_SIZE < len(texts):
                    time.sleep(2.5)
            return all_vecs, model_name
        except Exception as exc:
            last_err = exc
            continue
    raise RuntimeError(f"All Gemini embedding models failed ({last_err})")


def format_pgvector_literal(vec: list[float]) -> str:
    """Serialize float vector into pgvector literal syntax."""
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


def split_page_into_chunks(text: str, chunk_size: int = 780, overlap: int = 120) -> list[str]:
    """Split a single page into overlapping chunks while preserving exact single page provenance."""
    clean = text.strip()
    if len(clean) < 60:
        return []
    if len(clean) <= chunk_size:
        return [clean]

    chunks: list[str] = []
    start = 0
    step = max(chunk_size - overlap, 100)
    while start < len(clean):
        end = min(start + chunk_size, len(clean))
        if end < len(clean):
            split_pos = max(clean.rfind("\n", start + step // 2, end), clean.rfind(" ", start + step // 2, end))
            if split_pos > start + 200:
                end = split_pos
        piece = clean[start:end].strip()
        if len(piece) >= 60:
            chunks.append(piece)
        if end >= len(clean):
            break
        start = max(end - overlap, start + 1)
    return chunks


def _get_existing_doc_state(doc_title: str) -> tuple[set[str], int]:
    """Fetch existing bronze file hashes and silver chunk count for incremental sync."""
    bronze_rows = fetch_all(
        "SELECT DISTINCT file_sha256 FROM bronze.bot_docs_raw WHERE doc_title = :doc_title",
        {"doc_title": doc_title},
    )
    silver_rows = fetch_all(
        "SELECT count(*) AS n FROM silver.policy_chunks WHERE doc_title = :doc_title",
        {"doc_title": doc_title},
    )
    hashes = {str(r["file_sha256"]).strip() for r in bronze_rows}
    chunk_count = int(silver_rows[0]["n"]) if silver_rows else 0
    return hashes, chunk_count


def _delete_stale_doc_versions(doc_title: str, conn: Any | None = None) -> None:
    """Remove outdated bronze pages and silver chunks for a document title."""
    if conn is not None:
        cur = conn.cursor()
        try:
            cur.execute("DELETE FROM silver.policy_chunks WHERE doc_title = %s", (doc_title,))
            cur.execute("DELETE FROM bronze.bot_docs_raw WHERE doc_title = %s", (doc_title,))
        finally:
            cur.close()
        return

    with get_connection() as own_conn:
        cur = own_conn.cursor()
        try:
            cur.execute("DELETE FROM silver.policy_chunks WHERE doc_title = %s", (doc_title,))
            cur.execute("DELETE FROM bronze.bot_docs_raw WHERE doc_title = %s", (doc_title,))
        finally:
            cur.close()


def index_single_pdf(
    pdf_path: str | Path,
    doc_title: str,
    doc_url: str | None = None,
    force_reindex: bool = False,
    client: genai.Client | None = None,
) -> dict[str, Any]:
    """Load one PDF into bronze and incrementally embed page scoped chunks into silver.policy_chunks."""
    from src.rag.policy_assistant import clear_bm25_cache

    path = Path(pdf_path)
    file_sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    existing_hashes, existing_chunks = _get_existing_doc_state(doc_title)

    source_cfg = yaml.safe_load((BACKEND_DIR / "config" / "sources.yaml").read_text(encoding="utf-8"))
    configured_doc = next(
        (item for item in source_cfg.get("official_pdfs", {}).get("docs", [])
         if str(item.get("doc_title", "")).strip() == doc_title.strip()
         or str(item.get("doc_id", "")).strip() == path.stem),
        {},
    )
    doc_id = str(configured_doc.get("doc_id") or path.stem)

    # Skip unchanged document versions completely to avoid redundant embedding API usage
    if file_sha256 in existing_hashes and existing_chunks > 0:
        return {
            "doc_title": doc_title,
            "status": "skipped_unchanged",
            "pages": 0,
            "chunks_inserted": 0,
            "existing_chunks": existing_chunks,
            "model_used": None,
        }

    # Extract once and validate quality BEFORE deleting any existing version or calling embedding API
    pages = extract_pdf_pages(pdf_path=path, doc_title=doc_title, doc_url=doc_url)
    quality_ok, quality_reason = assess_pdf_text_quality(pages)
    import pymupdf

    with pymupdf.open(path) as pdf:
        page_count = len(pdf)
    extracted_page_numbers = {int(page["page_num"]) for page in pages}
    complete_page_coverage = extracted_page_numbers == set(range(1, page_count + 1))
    if not complete_page_coverage:
        quality_ok = False
        quality_reason = (
            f"Text extraction covered {len(extracted_page_numbers)} of {page_count} pages; "
            "all pages must be readable or manually reviewed via OCR"
        )
    if not quality_ok:
        pages, review = get_approved_ocr_pages(file_sha256, doc_id, page_count)
        if pages is None:
            vision_timeout_ms = max(30_000, int(os.getenv("GEMINI_VISION_TIMEOUT_MS", "180000")))
            draft_path = create_ocr_review_draft(
                path,
                doc_id=doc_id,
                doc_title=doc_title,
                doc_url=doc_url,
                client=_get_genai_client(timeout_ms=vision_timeout_ms),
            )
            try:
                draft_state = json.loads(draft_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                draft_state = {}
            return {
                "doc_title": doc_title,
                "doc_id": doc_id,
                "status": "pending_ocr_review",
                "reason": draft_state.get("last_error") or quality_reason,
                "page_count": page_count,
                "ocr_completed_pages": int(draft_state.get("completed_pages") or 0),
                "ocr_status": draft_state.get("status"),
                "ocr_model": draft_state.get("ocr_model"),
                "retry_after_at": draft_state.get("retry_after_at"),
                "review_draft": str(draft_path),
                "chunks_inserted": 0,
                "model_used": None,
            }
        quality_ok, quality_reason = assess_pdf_text_quality(pages)
        if not quality_ok:
            return {
                "doc_title": doc_title,
                "status": "rejected_ocr_quality",
                "reason": quality_reason,
                "reviewed_by": review.get("reviewed_by") if review else None,
                "pages": len(pages),
                "chunks_inserted": 0,
                "model_used": None,
            }

    chunk_records: list[dict[str, Any]] = []
    embed_inputs: list[str] = []

    for page in pages:
        page_num = int(page["page_num"])
        pieces = split_page_into_chunks(str(page["raw_text"]))
        for c_idx, piece in enumerate(pieces):
            sha = hashlib.sha256(f"{doc_title}|{file_sha256}|{page_num}|{c_idx}|{piece}".encode("utf-8")).hexdigest()
            embed_inputs.append(f"{doc_title} หน้า {page_num}\n{piece}")
            chunk_records.append(
                {
                    "doc_title": doc_title.strip(),
                    "doc_url": doc_url,
                    "page_num": page_num,
                    "chunk_index": c_idx,
                    "chunk_text": piece,
                    "content_sha256": sha,
                    "extraction_method": str(page.get("extraction_method") or "pdf_text"),
                    "ocr_reviewed_by": page.get("ocr_reviewed_by"),
                    "ocr_reviewed_at": page.get("ocr_reviewed_at"),
                }
            )

    if not chunk_records:
        return {
            "doc_title": doc_title,
            "status": "empty_chunks",
            "pages": len(pages),
            "chunks_inserted": 0,
            "model_used": None,
        }

    # Generate all embeddings BEFORE touching existing bronze/silver records
    vectors, model_used = embed_texts_batch(embed_inputs, task_type="RETRIEVAL_DOCUMENT", client=client)
    for rec, vec in zip(chunk_records, vectors):
        rec["embedding"] = format_pgvector_literal(vec)

    should_replace_existing = file_sha256 not in existing_hashes

    bronze_rows = [
        (
            r["doc_title"],
            r["doc_url"],
            int(r["page_num"]),
            str(r["raw_text"]),
            str(r["file_sha256"]),
            str(r.get("extraction_method") or "pdf_text"),
            r.get("ocr_reviewed_by"),
            r.get("ocr_reviewed_at"),
        )
        for r in pages
    ]
    # Local drop-ins remain identifiable but are not promoted as official policy.
    effective_from = configured_doc.get("effective_from")
    doc_version = str(configured_doc.get("doc_version") or file_sha256[:12])

    silver_rows = [
        (
            r["doc_title"],
            r["doc_url"],
            r["page_num"],
            r["chunk_index"],
            r["chunk_text"],
            r["embedding"],
            r["content_sha256"],
            doc_id,
            doc_version,
            effective_from,
            True,
            str(r.get("extraction_method") or "pdf_text"),
            r.get("ocr_reviewed_by"),
        )
        for r in chunk_records
    ]

    with get_connection() as conn:
        if should_replace_existing:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    UPDATE silver.policy_chunks
                    SET is_active = FALSE,
                        effective_to = COALESCE(effective_to, CURRENT_DATE)
                    WHERE doc_id = %s AND is_active = TRUE
                    """,
                    (doc_id,),
                )
            finally:
                cur.close()
        cur = conn.cursor()
        try:
            cur.executemany(
                """
                INSERT INTO bronze.bot_docs_raw (
                    doc_title, doc_url, page_num, raw_text, file_sha256,
                    extraction_method, ocr_reviewed_by, ocr_reviewed_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::timestamptz)
                ON CONFLICT (file_sha256, page_num) DO NOTHING
                """,
                bronze_rows,
            )
            cur.executemany(
                """
                INSERT INTO silver.policy_chunks (
                    doc_title, doc_url, page_num, chunk_index, chunk_text, embedding, content_sha256,
                    doc_id, doc_version, effective_from, is_active, extraction_method, ocr_reviewed_by
                ) VALUES (
                    %s, %s, %s, %s, %s, CAST(%s AS vector), %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (content_sha256) DO NOTHING
                """,
                silver_rows,
            )
            inserted = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else len(silver_rows)
        finally:
            cur.close()

    clear_bm25_cache()
    return {
        "doc_title": doc_title,
        "status": "indexed",
        "pages": len(pages),
        "chunks_inserted": inserted,
        "model_used": model_used,
    }


def index_all_official_pdfs(force_download: bool = False, force_reindex: bool = False) -> dict[str, Any]:
    """Download configured official PDFs, scan drop in local PDFs, and sync Neon pgvector index."""
    client = _get_genai_client()
    downloaded = download_configured_pdfs(force_refresh=force_download)
    configured_paths = {Path(item["local_path"]).resolve() for item in downloaded}

    # Backfill stable identity for chunks created before version metadata was introduced.
    for item in downloaded:
        bulk_execute(
            """
            UPDATE silver.policy_chunks p
            SET doc_id = :doc_id,
                doc_version = COALESCE(
                    (SELECT max(b.file_sha256) FROM bronze.bot_docs_raw b WHERE b.doc_title = p.doc_title),
                    p.doc_version,
                    'legacy'
                )
            WHERE p.doc_title = :doc_title AND p.doc_id IS NULL
            """,
            [{"doc_id": item["doc_id"], "doc_title": item["doc_title"]}],
        )

    results: list[dict[str, Any]] = []
    for item in downloaded:
        res = index_single_pdf(
            pdf_path=item["local_path"],
            doc_title=item["doc_title"],
            doc_url=item["url"],
            force_reindex=force_reindex,
            client=client,
        )
        res["doc_id"] = item["doc_id"]
        res["size_kb"] = item["size_kb"]
        res["category"] = item["category"]
        res["source_refreshed"] = item.get("source_refreshed", False)
        results.append(res)

    if DOCS_RAW_DIR.exists():
        for extra_pdf in sorted(DOCS_RAW_DIR.glob("*.pdf")):
            if extra_pdf.resolve() in configured_paths:
                continue
            title = extra_pdf.stem.replace("_", " ").strip()
            res = index_single_pdf(
                pdf_path=extra_pdf,
                doc_title=title,
                doc_url=None,
                force_reindex=force_reindex,
                client=client,
            )
            res["size_kb"] = round(extra_pdf.stat().st_size / 1024.0, 1)
            res["category"] = "local_dropin"
            results.append(res)

    totals = fetch_all(
        """
            SELECT
            (SELECT count(*) FROM bronze.bot_docs_raw) AS bronze_pages,
            (SELECT count(DISTINCT doc_id) FROM silver.policy_chunks WHERE is_active = TRUE
                AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
                AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)) AS silver_docs,
            (SELECT count(*) FROM silver.policy_chunks WHERE is_active = TRUE
                AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
                AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)) AS silver_chunks,
            round((pg_total_relation_size('silver.policy_chunks') / 1048576.0)::numeric, 2) AS silver_chunks_mb
        """
    )[0]

    summary = {
        "documents": results,
        "bronze_pages_total": int(totals["bronze_pages"]),
        "silver_docs_total": int(totals["silver_docs"]),
        "silver_chunks_total": int(totals["silver_chunks"]),
        "silver_chunks_mb": float(totals["silver_chunks_mb"]),
    }

    bulk_execute(
        """
        INSERT INTO gold.pipeline_eval_runs (run_type, metrics_json, token_count, estimated_cost_thb)
        VALUES (:run_type, CAST(:metrics_json AS JSONB), 0, 0.0)
        """,
        [
            {
                "run_type": "rag_indexing",
                "metrics_json": json.dumps(summary, ensure_ascii=False),
            }
        ],
    )
    return summary
