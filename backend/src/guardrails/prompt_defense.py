"""Prompt injection detection and untrusted text sandboxing for Thai and English inputs."""

from __future__ import annotations

import re
from dataclasses import dataclass

# Precompiled patterns targeting instruction override and role hijacking attempts
_INJECTION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("ignore_instructions_en", re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions?", re.I)),
    ("disregard_rules_en", re.compile(r"disregard\s+(all\s+)?(rules|system|instructions?)", re.I)),
    ("system_prompt_leak_en", re.compile(r"(reveal|print|show|dump)\s+(your\s+)?system\s+prompt", re.I)),
    ("role_override_en", re.compile(r"(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\s+(an?\s+)?(admin|root|unrestricted|approver)", re.I)),
    ("force_approve_en", re.compile(r"(always|automatically)\s+approve\s+(all\s+)?(loans?|requests?|cases?)", re.I)),
    ("ignore_instructions_th", re.compile(r"(ลืม|เพิกเฉย|ยกเลิก|ไม่ต้องทำตาม)(คำสั่งเดิม|กฎทั้งหมด|คำสั่งก่อนหน้า|ข้อจำกัด)")),
    ("system_prompt_leak_th", re.compile(r"(เปิดเผย|แสดง|ขอดู)(คำสั่งระบบ|system\s*prompt|พรอมต์ระบบ)", re.I)),
    ("force_approve_th", re.compile(r"(อนุมัติทุกกรณี|ตอบว่าผ่านทั้งหมด|บังคับให้ผ่านเกณฑ์)")),
    ("xml_tag_breakout", re.compile(r"</?\s*(untrusted_news_content|untrusted_user_query|system)\s*>", re.I)),
)


@dataclass(frozen=True)
class InjectionCheckResult:
    """Result of scanning untrusted text for adversarial prompt injection patterns."""

    is_suspicious: bool
    matched_rules: tuple[str, ...]


def detect_prompt_injection(text: str) -> InjectionCheckResult:
    """Scan text against compiled Thai and English prompt injection signatures."""
    if not text:
        return InjectionCheckResult(is_suspicious=False, matched_rules=())

    matched = [name for name, pattern in _INJECTION_PATTERNS if pattern.search(text)]
    return InjectionCheckResult(is_suspicious=bool(matched), matched_rules=tuple(matched))


def wrap_untrusted_text(text: str, tag_name: str = "untrusted_news_content") -> str:
    """Escape delimiter tags and wrap untrusted text for strict prompt isolation."""
    sanitized = re.sub(r"</?\s*" + re.escape(tag_name) + r"\s*>", "", text, flags=re.I)
    return f"<{tag_name}>\n{sanitized.strip()}\n</{tag_name}>"
