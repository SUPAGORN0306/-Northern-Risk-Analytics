"""Tests for the human-reviewed OCR promotion gate."""

import json

from src.extract import bot_pdf_loader


def _write_review(tmp_path, *, status="approved", document_sha256="a" * 64, pages=None):
    payload = {
        "doc_id": "sample_policy",
        "doc_title": "Sample policy",
        "doc_url": None,
        "document_sha256": document_sha256,
        "page_count": 2,
        "status": status,
        "reviewed_by": "reviewer",
        "reviewed_at": "2026-11-24T00:00:00+00:00",
        "pages": pages or [
            {"page_num": 1, "raw_text": "เนื้อหาหนึ่ง" * 15},
            {"page_num": 2, "raw_text": "เนื้อหาสอง" * 15},
        ],
    }
    (tmp_path / f"sample_policy-{document_sha256[:16]}.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def test_pending_ocr_draft_is_not_promoted(tmp_path, monkeypatch):
    monkeypatch.setattr(bot_pdf_loader, "OCR_REVIEW_DIR", tmp_path)
    _write_review(tmp_path, status="pending_human_review")

    pages, review = bot_pdf_loader.get_approved_ocr_pages("a" * 64, "sample_policy", 2)

    assert pages is None
    assert review is None


def test_approved_ocr_requires_matching_hash_and_complete_pages(tmp_path, monkeypatch):
    monkeypatch.setattr(bot_pdf_loader, "OCR_REVIEW_DIR", tmp_path)
    monkeypatch.setattr(bot_pdf_loader, "assess_pdf_text_quality", lambda _pages: (True, "ok"))
    _write_review(tmp_path)

    pages, review = bot_pdf_loader.get_approved_ocr_pages("a" * 64, "sample_policy", 2)

    assert len(pages) == 2
    assert all(page["extraction_method"] == "gemini_vision_ocr_human_reviewed" for page in pages)
    assert all(page["ocr_reviewed_by"] == "reviewer" for page in pages)
    assert review["reviewed_by"] == "reviewer"
    assert bot_pdf_loader.get_approved_ocr_pages("b" * 64, "sample_policy", 2) == (None, None)
    assert bot_pdf_loader.get_approved_ocr_pages("a" * 64, "sample_policy", 3) == (None, None)


def test_approved_ocr_rejects_missing_or_out_of_order_page(tmp_path, monkeypatch):
    monkeypatch.setattr(bot_pdf_loader, "OCR_REVIEW_DIR", tmp_path)
    monkeypatch.setattr(bot_pdf_loader, "assess_pdf_text_quality", lambda _pages: (True, "ok"))
    _write_review(
        tmp_path,
        pages=[
            {"page_num": 2, "raw_text": "เนื้อหาหนึ่ง" * 15},
            {"page_num": 1, "raw_text": "เนื้อหาสอง" * 15},
        ],
    )

    assert bot_pdf_loader.get_approved_ocr_pages("a" * 64, "sample_policy", 2) == (None, None)
