"""Approve an OCR draft only after a reviewer compares every page to the source PDF."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pymupdf

BACKEND_DIR = Path(__file__).resolve().parents[1]
REVIEW_DIR = BACKEND_DIR / "data" / "ocr_review"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("draft", type=Path, help="OCR review JSON draft created by the RAG indexer")
    parser.add_argument("--source-pdf", type=Path, required=True, help="Exact PDF used to create the draft")
    parser.add_argument("--reviewed-by", required=True, help="Reviewer name or project role")
    parser.add_argument("--confirm-all-pages-checked", action="store_true")
    args = parser.parse_args()

    draft_path = args.draft.resolve()
    source_path = args.source_pdf.resolve()
    if not draft_path.is_relative_to(REVIEW_DIR.resolve()):
        parser.error(f"Draft must be inside {REVIEW_DIR}")
    if not args.confirm_all_pages_checked:
        parser.error("Review every page against the PDF, correct the JSON text, then pass --confirm-all-pages-checked")
    if not args.reviewed_by.strip() or not source_path.is_file():
        parser.error("A reviewer and existing source PDF are required")

    payload = json.loads(draft_path.read_text(encoding="utf-8"))
    source_hash = hashlib.sha256(source_path.read_bytes()).hexdigest()
    if payload.get("status") != "pending_human_review":
        parser.error("Only pending_human_review drafts can be approved")
    if payload.get("document_sha256") != source_hash:
        parser.error("Source PDF hash does not match the OCR draft")
    with pymupdf.open(source_path) as pdf:
        page_count = len(pdf)
    pages = payload.get("pages") or []
    if payload.get("page_count") != page_count or len(pages) != page_count:
        parser.error("Draft page count does not match the source PDF")
    if [int(page.get("page_num") or 0) for page in pages] != list(range(1, page_count + 1)):
        parser.error("Draft pages must be present and ordered from page 1 through the last page")
    if any(len(str(page.get("raw_text") or "").strip()) < 25 for page in pages):
        parser.error("Every page must have at least 25 reviewed characters")

    payload["status"] = "approved"
    payload["reviewed_by"] = args.reviewed_by.strip()
    payload["reviewed_at"] = datetime.now(timezone.utc).isoformat()
    payload["approval_source_sha256"] = source_hash
    draft_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Approved reviewed OCR draft: {draft_path.name} ({page_count} pages)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
