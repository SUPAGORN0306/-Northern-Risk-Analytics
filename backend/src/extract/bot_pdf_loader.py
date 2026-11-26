"""Page level PDF downloader, Thai text normalizer, quality gate, and bronze loader."""

from __future__ import annotations

import hashlib
import json
import os
import random
import re
import ssl
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types
import httpx
import pymupdf
import truststore
import yaml

from src.db.connection import bulk_execute

BACKEND_DIR = Path(__file__).resolve().parents[2]
DOCS_RAW_DIR = BACKEND_DIR / "data" / "raw" / "docs"
SOURCES_PATH = BACKEND_DIR / "config" / "sources.yaml"
OCR_REVIEW_DIR = BACKEND_DIR / "data" / "ocr_review"
load_dotenv(BACKEND_DIR / ".env")

# Precompiled Thai PDF normalization patterns fixing split Sara Am and font map artifacts
_TONE_SPLIT_SARA_AM_RE = re.compile(r"([\u0e01-\u0e2e])(?:([\u0e48-\u0e4b])[ \t]+|[ \t]+([\u0e48-\u0e4b]))\u0e32")
_SPACED_SARA_AM_RE = re.compile(r"([\u0e01-\u0e2e][\u0e48-\u0e4b]?)[ \t]+([\u0e48-\u0e4b]?)\u0e33")
_PLAIN_SPLIT_SARA_AM_RE = re.compile(r"([\u0e01-\u0e2e])[ \t]+\u0e32")
_NIKHAHIT_SARA_AA_RE = re.compile(r"\u0e4d\u0e32")
_MULTI_SPACE_RE = re.compile(r"[ \t]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")
_HTTP_STATUS_RE = re.compile(r"\b(429|500|502|503|504)\b")


def _ocr_retry_delay_seconds(exc: Exception, attempt: int) -> float | None:
    """Return a bounded delay for transient provider failures; None means do not retry now."""
    response = getattr(exc, "response", None)
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if status is None and response is not None:
        status = getattr(response, "status_code", None)
    try:
        status = int(status)
    except (TypeError, ValueError):
        match = _HTTP_STATUS_RE.search(str(exc))
        status = int(match.group(1)) if match else None

    transient_statuses = {429, 500, 502, 503, 504}
    is_network_timeout = isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, TimeoutError))
    if status not in transient_statuses and not is_network_timeout:
        return None

    try:
        max_wait = max(0.0, float(os.getenv("GEMINI_VISION_MAX_RETRY_WAIT_SECONDS", "300")))
    except ValueError:
        max_wait = 300.0

    headers = getattr(response, "headers", None) or getattr(exc, "headers", None) or {}
    retry_after = headers.get("Retry-After") if hasattr(headers, "get") else None
    if retry_after:
        try:
            delay = max(0.0, float(retry_after))
        except (TypeError, ValueError):
            try:
                retry_at = parsedate_to_datetime(str(retry_after))
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=timezone.utc)
                delay = max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
            except (TypeError, ValueError, OverflowError):
                delay = -1.0
        if delay >= 0:
            # The caller persists long server delays instead of sleeping or retrying early.
            return delay

    try:
        base = max(0.0, float(os.getenv("GEMINI_VISION_RETRY_BASE_SECONDS", "30")))
    except ValueError:
        base = 30.0
    delay = min(max_wait, base * (2**max(0, attempt)))
    return min(max_wait, random.uniform(delay * 0.8, delay * 1.2)) if delay > 0 else 0.0

# Safe unambiguous Thai font glyph replacements seen in official BOT PowerPoint and Word PDFs
_THAI_FONT_FIXES: tuple[tuple[str, str], ...] = (
    ("ธนำคำร", "ธนาคาร"),
    ("ภำคเหนือ", "ภาคเหนือ"),
    ("สำนักงำน", "สำนักงาน"),
    ("ไตรมำส", "ไตรมาส"),
    ("รำยได้", "รายได้"),
    ("รำยจ่ำย", "รายจ่าย"),
    ("กำรท่องเที่ยว", "การท่องเที่ยว"),
    ("กำรเงิน", "การเงิน"),
    ("กำรบริโภค", "การบริโภค"),
    ("กำรลงทุน", "การลงทุน"),
    ("กำรผลิต", "การผลิต"),
    ("กำรให้สินเชื่อ", "การให้สินเชื่อ"),
    ("กำรบริหำร", "การบริหาร"),
    ("กำรพัฒนำ", "การพัฒนา"),
    ("กำรโฆษณำ", "การโฆษณา"),
    ("กำรชำระหนี้", "การชำระหนี้"),
    ("กำรปรับปรุง", "การปรับปรุง"),
    ("มำตรกำร", "มาตรการ"),
    ("ขยำยตัว", "ขยายตัว"),
    ("อุตสำหกรรม", "อุตสาหกรรม"),
    ("ด้ำนอุปทำน", "ด้านอุปทาน"),
    ("ด้ำนอุปสงค", "ด้านอุปสงค์"),
    ("ปรับฤดูกำล", "ปรับฤดูกาล"),
    ("ผู้อำนวยกำร", "ผู้อำนวยการ"),
    ("ผู้ให้บริกำร", "ผู้ให้บริการ"),
    ("แถลงข่ำว", "แถลงข่าว"),
    ("พฤศจิกำยน", "พฤศจิกายน"),
    ("พฤษภำคม", "พฤษภาคม"),
    ("ควำมต้องกำร", "ความต้องการ"),
    ("ควำมสำมำรถ", "ความสามารถ"),
    ("ควำมเสี่ยง", "ความเสี่ยง"),
    ("ควำมเป็นธรรม", "ความเป็นธรรม"),
    ("อัตรำดอกเบี้ย", "อัตราดอกเบี้ย"),
    ("สัญญำ", "สัญญา"),
    ("ลูกค้ำ", "ลูกค้า"),
    ("ส่าคัญ", "สำคัญ"),
    ("ช่าระ", "ชำระ"),
    ("ด่าเนิน", "ดำเนิน"),
    ("จ่านวน", "จำนวน"),
    ("ก่าหนด", "กำหนด"),
    ("ต่่า", "ต่ำ"),
    ("ขั้นต่่า", "ขั้นต่ำ"),
    ("ส าคัญ", "สำคัญ"),
    ("ส าหรับ", "สำหรับ"),
    ("ช าระ", "ชำระ"),
    ("ด าเนิน", "ดำเนิน"),
    ("จ านวน", "จำนวน"),
    ("ก าหนด", "กำหนด"),
    ("ท าให้", "ทำให้"),
    ("จัดท า", "จัดทำ"),
    ("ค าแนะนำ", "คำแนะนำ"),
    ("ค านึง", "คำนึง"),
    ("จ าเป็น", "จำเป็น"),
    ("น าเสนอ", "นำเสนอ"),
    ("สม่่าเสมอ", "สม่ำเสมอ"),
)


def normalize_thai_pdf_text(text: str) -> str:
    """Repair broken Thai Sara Am and font mapping artifacts and normalize PDF whitespace."""
    if not text:
        return ""
    cleaned = text.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    cleaned = _NIKHAHIT_SARA_AA_RE.sub("\u0e33", cleaned)
    cleaned = _SPACED_SARA_AM_RE.sub("\\1\\2\u0e33", cleaned)
    cleaned = _TONE_SPLIT_SARA_AM_RE.sub(lambda m: f"{m.group(1)}{m.group(2) or m.group(3)}\u0e33", cleaned)
    cleaned = _PLAIN_SPLIT_SARA_AM_RE.sub("\\1\u0e33", cleaned)
    for bad_seq, good_seq in _THAI_FONT_FIXES:
        if bad_seq in cleaned:
            cleaned = cleaned.replace(bad_seq, good_seq)
    cleaned = _MULTI_SPACE_RE.sub(" ", cleaned)
    cleaned = _MULTI_NEWLINE_RE.sub("\n\n", cleaned)
    return cleaned.strip()


def assess_pdf_text_quality(pages: list[dict[str, Any]]) -> tuple[bool, str]:
    """Reject scanned empty PDFs and legacy garbled font encodings before bronze ingestion."""
    if not pages:
        return False, "No extractable text pages found"
    combined = " ".join(p["raw_text"] for p in pages)
    non_space = [ch for ch in combined if not ch.isspace()]
    if len(non_space) < 200:
        return False, f"Too few readable characters ({len(non_space)})"
    thai_or_ascii = sum(
        1 for ch in non_space if ("\u0e00" <= ch <= "\u0e7f") or (32 <= ord(ch) <= 126)
    )
    readable_ratio = thai_or_ascii / float(len(non_space))
    if readable_ratio < 0.75:
        return False, f"Garbled encoding detected (readable ratio {readable_ratio:.2f})"
    return True, "ok"


def get_approved_ocr_pages(
    pdf_sha256: str,
    doc_id: str,
    expected_page_count: int,
) -> tuple[list[dict[str, Any]] | None, dict[str, str] | None]:
    """Load OCR text only after a human approval record matches the exact source PDF hash."""
    if not OCR_REVIEW_DIR.exists():
        return None, None
    safe_doc_id = re.sub(r"[^A-Za-z0-9_.-]", "_", doc_id)
    candidates = sorted(OCR_REVIEW_DIR.glob(f"{safe_doc_id}-{pdf_sha256[:16]}.json"))
    for path in candidates:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if (
            payload.get("status") != "approved"
            or payload.get("document_sha256") != pdf_sha256
            or payload.get("doc_id") != doc_id
            or not str(payload.get("doc_title") or "").strip()
        ):
            continue
        reviewer = str(payload.get("reviewed_by") or "").strip()
        reviewed_at = str(payload.get("reviewed_at") or "").strip()
        raw_pages = payload.get("pages") or []
        ocr_engine = str(
            payload.get("ocr_engine") or payload.get("ocr_model") or "gemini"
        ).strip().lower()
        if "tesseract" in ocr_engine:
            extraction_method = "tesseract_ocr_human_reviewed"
        elif "gemini" in ocr_engine:
            extraction_method = "gemini_vision_ocr_human_reviewed"
        else:
            extraction_method = "ocr_human_reviewed"
        if not reviewer or not reviewed_at or len(raw_pages) != expected_page_count:
            continue
        pages = []
        for expected_num, item in enumerate(raw_pages, start=1):
            text = normalize_thai_pdf_text(str(item.get("raw_text") or ""))
            try:
                actual_num = int(item.get("page_num") or 0)
            except (TypeError, ValueError):
                return None, None
            if actual_num != expected_num or len(text) < 25:
                return None, None
            pages.append({
                "doc_title": str(payload["doc_title"]),
                "doc_url": payload.get("doc_url"),
                "page_num": expected_num,
                "raw_text": text,
                "file_sha256": pdf_sha256,
                "extraction_method": extraction_method,
                "ocr_reviewed_by": reviewer,
                "ocr_reviewed_at": reviewed_at,
            })
        quality_ok, _ = assess_pdf_text_quality(pages)
        if quality_ok:
            return pages, {"reviewed_by": reviewer, "reviewed_at": reviewed_at}
    return None, None


def create_ocr_review_draft(
    pdf_path: str | Path,
    doc_id: str,
    doc_title: str,
    doc_url: str | None = None,
    client: genai.Client | None = None,
) -> Path:
    """OCR pages into a resumable human-review draft; never indexes OCR output automatically."""
    path = Path(pdf_path)
    file_bytes = path.read_bytes()
    file_sha256 = hashlib.sha256(file_bytes).hexdigest()
    OCR_REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    safe_doc_id = re.sub(r"[^A-Za-z0-9_.-]", "_", doc_id)
    output_path = OCR_REVIEW_DIR / f"{safe_doc_id}-{file_sha256[:16]}.json"
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if client is None:
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY is required to prepare a human-reviewed OCR draft")
        timeout_ms = max(30_000, int(os.getenv("GEMINI_VISION_TIMEOUT_MS", "180000")))
        client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=timeout_ms))
    model = (os.getenv("GEMINI_VISION_MODEL") or "gemini-3.8-flash").strip()
    with pymupdf.open(stream=file_bytes, filetype="pdf") as pdf:
        page_count = len(pdf)
        max_pages = int(os.getenv("OCR_REVIEW_MAX_PAGES", "100"))
        if page_count > max_pages:
            raise ValueError(
                f"PDF has {page_count} pages, above OCR_REVIEW_MAX_PAGES={max_pages}; split and review deliberately"
            )
        pages_by_num: dict[int, dict[str, Any]] = {}
        if output_path.exists():
            try:
                previous = json.loads(output_path.read_text(encoding="utf-8"))
                if (
                    previous.get("document_sha256") == file_sha256
                    and previous.get("doc_id") == doc_id
                    and previous.get("page_count") == page_count
                ):
                    if previous.get("status") == "pending_human_review":
                        return output_path
                    for item in previous.get("pages") or []:
                        page_num = int(item.get("page_num") or 0)
                        text = str(item.get("raw_text") or "").strip()
                        if 1 <= page_num <= page_count and text:
                            pages_by_num[page_num] = {"page_num": page_num, "raw_text": text}
                    retry_after_at = previous.get("retry_after_at")
                    if retry_after_at:
                        try:
                            retry_at = datetime.fromisoformat(str(retry_after_at))
                            if retry_at.tzinfo is None:
                                retry_at = retry_at.replace(tzinfo=timezone.utc)
                            if retry_at > datetime.now(timezone.utc):
                                return output_path
                        except ValueError:
                            pass
                    previous_error = str(previous.get("last_error") or "")
                    is_transient_previous = bool(_HTTP_STATUS_RE.search(previous_error)) or any(
                        token in previous_error.lower() for token in ("timeout", "timed out")
                    )
                    if not retry_after_at and is_transient_previous:
                        try:
                            cooldown = max(
                                0.0,
                                float(os.getenv("GEMINI_VISION_TRANSIENT_COOLDOWN_SECONDS", "900")),
                            )
                            updated_at = datetime.fromisoformat(str(previous.get("updated_at")))
                            if updated_at.tzinfo is None:
                                updated_at = updated_at.replace(tzinfo=timezone.utc)
                            retry_at = updated_at + timedelta(seconds=cooldown)
                            if retry_at > datetime.now(timezone.utc):
                                previous["retry_after_at"] = retry_at.isoformat()
                                output_path.write_text(
                                    json.dumps(previous, ensure_ascii=False, indent=2), encoding="utf-8"
                                )
                                return output_path
                        except (TypeError, ValueError):
                            pass
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                pages_by_num = {}

        created_at = datetime.now(timezone.utc).isoformat()

        def save_checkpoint(
            status: str,
            *,
            error: str | None = None,
            failed_page: int | None = None,
            retry_after_at: str | None = None,
        ) -> None:
            payload = {
                "doc_id": doc_id,
                "doc_title": doc_title,
                "doc_url": doc_url,
                "document_sha256": file_sha256,
                "page_count": page_count,
                "status": status,
                "ocr_model": model,
                "created_at": created_at,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "reviewed_by": None,
                "reviewed_at": None,
                "pages": [pages_by_num[num] for num in sorted(pages_by_num)],
                "completed_pages": len(pages_by_num),
                "review_instructions": "Compare every page against the source PDF; correct the text before approval. OCR output is not searchable by RAG until human review and approval.",
            }
            if error:
                payload["last_error"] = error
                payload["failed_page_num"] = failed_page
            if retry_after_at:
                payload["retry_after_at"] = retry_after_at
            temp_path = output_path.with_suffix(".json.tmp")
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
            )
            temp_path.replace(output_path)

        for page_num, page in enumerate(pdf, start=1):
            if page_num in pages_by_num:
                continue
            pixmap = page.get_pixmap(matrix=pymupdf.Matrix(1.6, 1.6), alpha=False)
            attempts = max(1, min(5, int(os.getenv("GEMINI_VISION_PAGE_RETRIES", "2"))))
            last_error: Exception | None = None
            retry_after_at: str | None = None
            for attempt in range(attempts):
                try:
                    response = client.models.generate_content(
                        model=model,
                        contents=[
                            "Transcribe all visible Thai and English text exactly. Preserve headings, numbers, tables and paragraph order. Do not summarize, infer missing text, or add commentary. Mark unreadable spans as [ไม่ชัด].",
                            types.Part.from_bytes(data=pixmap.tobytes("png"), mime_type="image/png"),
                        ],
                        config=types.GenerateContentConfig(temperature=0),
                    )
                    page_text = (response.text or "").strip()
                    if not page_text:
                        raise ValueError(f"OCR returned empty text for page {page_num}")
                    pages_by_num[page_num] = {"page_num": page_num, "raw_text": page_text}
                    save_checkpoint("ocr_in_progress")
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    retry_delay = _ocr_retry_delay_seconds(exc, attempt)
                    if retry_delay is None:
                        break
                    max_wait = max(0.0, float(os.getenv("GEMINI_VISION_MAX_RETRY_WAIT_SECONDS", "300")))
                    if retry_delay > max_wait:
                        retry_after_at = datetime.fromtimestamp(
                            datetime.now(timezone.utc).timestamp() + retry_delay, tz=timezone.utc
                        ).isoformat()
                        break
                    if attempt + 1 >= attempts:
                        try:
                            cooldown = max(
                                0.0,
                                float(os.getenv("GEMINI_VISION_TRANSIENT_COOLDOWN_SECONDS", "900")),
                            )
                        except ValueError:
                            cooldown = 900.0
                        retry_after_at = datetime.fromtimestamp(
                            datetime.now(timezone.utc).timestamp() + max(cooldown, retry_delay),
                            tz=timezone.utc,
                        ).isoformat()
                        break
                    time.sleep(retry_delay)
            if last_error is not None:
                # Preserve completed pages so a later sync can resume instead of repeating OCR calls.
                safe_error = str(last_error).strip()
                safe_error = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "[REDACTED_API_KEY]", safe_error)
                safe_error = re.sub(
                    r"(?i)(api[_ -]?key|authorization|password|access[_ -]?token)(\s*[:=]\s*)[^\s,;]+",
                    r"\1\2[REDACTED]",
                    safe_error,
                )
                safe_error = re.sub(r"https?://[^\s'\"<>]+", "[URL]", safe_error)[:600]
                save_checkpoint(
                    "ocr_in_progress",
                    error=f"{type(last_error).__name__}: {safe_error or 'OCR request failed'}",
                    failed_page=page_num,
                    retry_after_at=retry_after_at,
                )
                return output_path

        save_checkpoint("pending_human_review")
    return output_path


def create_tesseract_ocr_review_draft(
    pdf_path: str | Path,
    doc_id: str,
    doc_title: str,
    doc_url: str | None = None,
    language: str = "tha+eng",
    dpi: int = 300,
) -> Path:
    """Create a resumable local Tesseract OCR draft; indexing still requires human approval."""
    path = Path(pdf_path)
    file_bytes = path.read_bytes()
    file_sha256 = hashlib.sha256(file_bytes).hexdigest()
    OCR_REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    safe_doc_id = re.sub(r"[^A-Za-z0-9_.-]", "_", doc_id)
    output_path = OCR_REVIEW_DIR / f"{safe_doc_id}-{file_sha256[:16]}.json"

    with pymupdf.open(stream=file_bytes, filetype="pdf") as pdf:
        page_count = len(pdf)
        pages_by_num: dict[int, dict[str, Any]] = {}
        if output_path.exists():
            try:
                previous = json.loads(output_path.read_text(encoding="utf-8"))
                if previous.get("status") == "approved":
                    raise ValueError("This exact source PDF already has an approved OCR draft")
                if (
                    previous.get("document_sha256") == file_sha256
                    and previous.get("doc_id") == doc_id
                    and previous.get("page_count") == page_count
                ):
                    if previous.get("status") == "pending_human_review":
                        return output_path
                    for item in previous.get("pages") or []:
                        page_num = int(item.get("page_num") or 0)
                        text = str(item.get("raw_text") or "").strip()
                        if 1 <= page_num <= page_count and text:
                            pages_by_num[page_num] = {"page_num": page_num, "raw_text": text}
            except (OSError, json.JSONDecodeError, TypeError):
                pages_by_num = {}

        created_at = datetime.now(timezone.utc).isoformat()

        def save_checkpoint(status: str, error: str | None = None, failed_page: int | None = None) -> None:
            payload = {
                "doc_id": doc_id,
                "doc_title": doc_title,
                "doc_url": doc_url,
                "document_sha256": file_sha256,
                "page_count": page_count,
                "status": status,
                "ocr_model": "tesseract-local",
                "ocr_engine": "tesseract",
                "ocr_language": language,
                "ocr_dpi": dpi,
                "created_at": created_at,
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "reviewed_by": None,
                "reviewed_at": None,
                "pages": [pages_by_num[num] for num in sorted(pages_by_num)],
                "completed_pages": len(pages_by_num),
                "review_instructions": "Compare every page against the exact source PDF; correct the text before approval. OCR output is not searchable by RAG until human review and approval.",
            }
            if error:
                payload["last_error"] = error[:600]
                payload["failed_page_num"] = failed_page
            temp_path = output_path.with_suffix(".json.tmp")
            temp_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8"
            )
            temp_path.replace(output_path)

        for page_num, page in enumerate(pdf, start=1):
            if page_num in pages_by_num:
                continue
            try:
                text_page = page.get_textpage_ocr(language=language, dpi=dpi, full=True)
                page_text = page.get_text("text", textpage=text_page, sort=True).strip()
                if len(page_text) < 25:
                    raise ValueError(f"Tesseract returned too little text for page {page_num}")
                pages_by_num[page_num] = {"page_num": page_num, "raw_text": page_text}
                save_checkpoint("ocr_in_progress")
            except Exception as exc:
                save_checkpoint(
                    "ocr_in_progress",
                    error=f"{type(exc).__name__}: {exc}",
                    failed_page=page_num,
                )
                return output_path

        save_checkpoint("pending_human_review")
    return output_path


def extract_pdf_pages(pdf_path: str | Path, doc_title: str, doc_url: str | None = None) -> list[dict[str, Any]]:
    """Extract normalized page text with exact page numbers and file SHA256 lineage."""
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF file not found ({path})")

    file_bytes = path.read_bytes()
    file_sha256 = hashlib.sha256(file_bytes).hexdigest()
    rows: list[dict[str, Any]] = []

    with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
        for idx, page in enumerate(doc, start=1):
            raw_text = page.get_text("text") or ""
            text = normalize_thai_pdf_text(raw_text)
            if len(text) < 25:
                continue
            rows.append(
                {
                    "doc_title": doc_title.strip(),
                    "doc_url": doc_url,
                    "page_num": idx,
                    "raw_text": text,
                    "file_sha256": file_sha256,
                }
            )
    return rows


def load_pdf_to_bronze(pdf_path: str | Path, doc_title: str, doc_url: str | None = None) -> dict[str, Any]:
    """Validate readability and load extracted PDF pages idempotently into bronze.bot_docs_raw."""
    rows = extract_pdf_pages(pdf_path=pdf_path, doc_title=doc_title, doc_url=doc_url)
    ok, reason = assess_pdf_text_quality(rows)
    if not ok:
        return {
            "doc_title": doc_title,
            "file_sha256": None,
            "extracted_pages": len(rows),
            "inserted_bronze": 0,
            "quality_passed": False,
            "quality_reason": reason,
        }

    upsert_sql = """
        INSERT INTO bronze.bot_docs_raw (
            doc_title, doc_url, page_num, raw_text, file_sha256
        ) VALUES (
            :doc_title, :doc_url, :page_num, :raw_text, :file_sha256
        )
        ON CONFLICT (file_sha256, page_num) DO NOTHING
    """
    inserted = bulk_execute(upsert_sql, rows)
    return {
        "doc_title": doc_title,
        "file_sha256": rows[0]["file_sha256"],
        "extracted_pages": len(rows),
        "inserted_bronze": inserted,
        "quality_passed": True,
        "quality_reason": "ok",
    }


def download_configured_pdfs(force_refresh: bool = False) -> list[dict[str, Any]]:
    """Download official policy and regional economic PDFs configured in sources.yaml."""
    cfg = yaml.safe_load(SOURCES_PATH.read_text(encoding="utf-8"))
    pdf_cfg = cfg.get("official_pdfs", {})
    docs = pdf_cfg.get("docs", [])
    timeout_sec = float(pdf_cfg.get("timeout_sec", 35))

    DOCS_RAW_DIR.mkdir(parents=True, exist_ok=True)
    ssl_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; NorthRiskAnalytics/1.0)"}

    downloaded: list[dict[str, Any]] = []
    with httpx.Client(verify=ssl_ctx, follow_redirects=True, timeout=timeout_sec, headers=headers) as client:
        for item in docs:
            doc_id = str(item["doc_id"])
            source_url = str(item["url"])
            local_path = DOCS_RAW_DIR / f"{doc_id}.pdf"
            source_meta_path = DOCS_RAW_DIR / f"{doc_id}.source.json"
            cached_source_url = None
            try:
                cached_source_url = json.loads(source_meta_path.read_text(encoding="utf-8")).get("url")
            except (OSError, json.JSONDecodeError, AttributeError):
                pass
            source_changed = cached_source_url != source_url
            refreshed = force_refresh or source_changed or not local_path.exists() or local_path.stat().st_size < 1024
            if refreshed:
                resp = client.get(source_url)
                resp.raise_for_status()
                if resp.content[:4] != b"%PDF":
                    raise ValueError(f"Configured URL for {doc_id} did not return valid PDF bytes")
                temp_pdf_path = local_path.with_suffix(".pdf.tmp")
                temp_pdf_path.write_bytes(resp.content)
                temp_pdf_path.replace(local_path)
                temp_meta_path = source_meta_path.with_suffix(".json.tmp")
                temp_meta_path.write_text(
                    json.dumps({"url": source_url}, ensure_ascii=False), encoding="utf-8"
                )
                temp_meta_path.replace(source_meta_path)
            downloaded.append(
                {
                    "doc_id": doc_id,
                    "doc_title": str(item["doc_title"]),
                    "category": str(item.get("category", "policy")),
                    "url": source_url,
                    "local_path": local_path,
                    "size_kb": round(local_path.stat().st_size / 1024.0, 1),
                    "source_refreshed": refreshed,
                }
            )
    return downloaded
