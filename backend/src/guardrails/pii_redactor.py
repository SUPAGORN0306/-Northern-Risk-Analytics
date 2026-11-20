"""Deterministic single pass PII redactor for Thai and general personal data."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Precompiled regex patterns ordered from most specific to general
_PII_PATTERNS: tuple[tuple[str, re.Pattern[str], str], ...] = (
    (
        "email",
        re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"),
        "[REDACTED_EMAIL]",
    ),
    (
        "thai_national_id",
        re.compile(
            r"(?<!\d)(?:\d[\s\-]?\d{4}[\s\-]?\d{5}[\s\-]?\d{2}[\s\-]?\d|\d{13})(?!\d)"
        ),
        "[REDACTED_THAI_ID]",
    ),
    (
        "thai_phone",
        re.compile(
            r"(?<!\d)(?:\+66[\s\-]?\d{1,2}[\s\-]?\d{3}[\s\-]?\d{4}|0[689]\d[\s\-]?\d{3}[\s\-]?\d{4}|02[\s\-]?\d{3}[\s\-]?\d{4}|0[3-7]\d[\s\-]?\d{3}[\s\-]?\d{3,4})(?!\d)"
        ),
        "[REDACTED_PHONE]",
    ),
    (
        "bank_account",
        re.compile(
            r"(?<!\d)(?:\d{3}[\s\-]\d[\s\-]\d{5}[\s\-]\d|\d{3}[\s\-]\d{6}[\s\-]\d|\d{10,12})(?!\d)"
        ),
        "[REDACTED_ACCOUNT]",
    ),
)


@dataclass(frozen=True)
class RedactionResult:
    """Immutable output containing sanitized text and per category redaction counts."""

    redacted_text: str
    counts: dict[str, int]

    @property
    def total_redacted(self) -> int:
        """Return total number of sensitive tokens removed."""
        return sum(self.counts.values())


def redact_pii(text: str) -> RedactionResult:
    """Mask Thai national IDs, phone numbers, emails, and bank accounts before LLM calls."""
    if not text:
        return RedactionResult(redacted_text="", counts={})

    current = text
    counts: dict[str, int] = {}

    for label, pattern, replacement in _PII_PATTERNS:
        current, n_subs = pattern.subn(replacement, current)
        if n_subs > 0:
            counts[label] = n_subs

    return RedactionResult(redacted_text=current, counts=counts)
