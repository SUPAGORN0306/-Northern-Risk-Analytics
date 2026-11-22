"""Page level PDF downloader, Thai text normalizer, quality gate, and bronze loader."""

from __future__ import annotations

import hashlib
import re
import ssl
from pathlib import Path
from typing import Any

import httpx
import pymupdf
import truststore
import yaml

from src.db.connection import bulk_execute

BACKEND_DIR = Path(__file__).resolve().parents[2]
DOCS_RAW_DIR = BACKEND_DIR / "data" / "raw" / "docs"
SOURCES_PATH = BACKEND_DIR / "config" / "sources.yaml"

# Precompiled Thai PDF normalization patterns fixing split Sara Am and font map artifacts
_TONE_SPLIT_SARA_AM_RE = re.compile(r"([\u0e01-\u0e2e])(?:([\u0e48-\u0e4b])[ \t]+|[ \t]+([\u0e48-\u0e4b]))\u0e32")
_SPACED_SARA_AM_RE = re.compile(r"([\u0e01-\u0e2e][\u0e48-\u0e4b]?)[ \t]+([\u0e48-\u0e4b]?)\u0e33")
_PLAIN_SPLIT_SARA_AM_RE = re.compile(r"([\u0e01-\u0e2e])[ \t]+\u0e32")
_NIKHAHIT_SARA_AA_RE = re.compile(r"\u0e4d\u0e32")
_MULTI_SPACE_RE = re.compile(r"[ \t]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")

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
            local_path = DOCS_RAW_DIR / f"{doc_id}.pdf"
            if force_refresh or not local_path.exists() or local_path.stat().st_size < 1024:
                resp = client.get(str(item["url"]))
                resp.raise_for_status()
                if resp.content[:4] != b"%PDF":
                    raise ValueError(f"Configured URL for {doc_id} did not return valid PDF bytes")
                local_path.write_bytes(resp.content)
            downloaded.append(
                {
                    "doc_id": doc_id,
                    "doc_title": str(item["doc_title"]),
                    "category": str(item.get("category", "policy")),
                    "url": str(item["url"]),
                    "local_path": local_path,
                    "size_kb": round(local_path.stat().st_size / 1024.0, 1),
                }
            )
    return downloaded
