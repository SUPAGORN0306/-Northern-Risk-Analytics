"""Prepare a local, human-reviewed OCR draft for a configured official PDF."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.extract.bot_pdf_loader import DOCS_RAW_DIR, SOURCES_PATH, create_tesseract_ocr_review_draft


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("doc_id", help="Document ID from backend/config/sources.yaml")
    parser.add_argument("--language", default="tha+eng", help="Tesseract language pack combination")
    parser.add_argument("--dpi", type=int, default=300, help="OCR rendering resolution (72–600 DPI)")
    args = parser.parse_args()
    if not 72 <= args.dpi <= 600:
        parser.error("--dpi must be between 72 and 600")

    config = yaml.safe_load(SOURCES_PATH.read_text(encoding="utf-8"))
    document = next(
        (item for item in config.get("official_pdfs", {}).get("docs", []) if item.get("doc_id") == args.doc_id),
        None,
    )
    if document is None:
        parser.error(f"Unknown official PDF doc_id: {args.doc_id}")

    pdf_path = DOCS_RAW_DIR / f"{args.doc_id}.pdf"
    if not pdf_path.is_file():
        parser.error(f"Source PDF is missing; run the official PDF sync first: {pdf_path}")

    draft_path = create_tesseract_ocr_review_draft(
        pdf_path,
        doc_id=args.doc_id,
        doc_title=str(document["doc_title"]),
        doc_url=str(document["url"]),
        language=args.language,
        dpi=args.dpi,
    )
    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    print(
        json.dumps(
            {
                "draft": str(draft_path),
                "status": draft.get("status"),
                "completed_pages": draft.get("completed_pages", 0),
                "page_count": draft.get("page_count"),
                "last_error": draft.get("last_error"),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
