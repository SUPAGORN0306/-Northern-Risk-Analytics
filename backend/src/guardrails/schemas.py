"""Pydantic schemas and O(1) lookup tables for the 17 Northern Thailand provinces."""

from __future__ import annotations

import re
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, field_validator

BACKEND_DIR = Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def _load_province_lookups() -> tuple[
    frozenset[str],
    dict[str, str],
    dict[str, dict],
    re.Pattern[str],
    dict[str, str],
    dict[str, str],
]:
    """Build cached O(1) hash maps and compiled boundary regexes for 17 Northern provinces."""
    yaml_path = BACKEND_DIR / "config" / "provinces_north_17.yaml"
    payload = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))

    valid_codes: set[str] = set()
    alias_to_code: dict[str, str] = {}
    code_to_meta: dict[str, dict] = {}
    en_name_to_code: dict[str, str] = {}
    th_name_to_code: dict[str, str] = {}

    for item in payload["provinces"]:
        code = item["code"].strip().upper()
        name_th = item["name_th"].strip()
        name_en = item["name_en"].strip()

        valid_codes.add(code)
        code_to_meta[code] = item
        en_name_to_code[name_en.lower()] = code
        th_name_to_code[name_th] = code

        # Register normalized lookup keys for constant time resolution
        for key in (
            code,
            code.lower(),
            name_th,
            f"จังหวัด{name_th}",
            f"จ.{name_th}",
            f"จ. {name_th}",
            name_en.lower(),
            name_en.lower().replace(" ", ""),
        ):
            alias_to_code[key] = code

    # Precompile whole word English boundary regex so tak never matches Intharaphitak
    sorted_en = sorted(en_name_to_code.keys(), key=len, reverse=True)
    en_boundary_re = re.compile(
        r"\b(" + "|".join(re.escape(name) for name in sorted_en) + r")\b",
        re.IGNORECASE,
    )

    return (
        frozenset(valid_codes),
        alias_to_code,
        code_to_meta,
        en_boundary_re,
        en_name_to_code,
        th_name_to_code,
    )


def resolve_northern_province(raw_value: str | None) -> str | None:
    """Resolve a Thai or English province string safely to its 2 letter Northern code."""
    if not raw_value:
        return None
    _, alias_to_code, _, en_boundary_re, en_name_to_code, th_name_to_code = _load_province_lookups()
    cleaned = " ".join(raw_value.strip().split())
    if not cleaned:
        return None

    # Step 1 constant time exact hash lookup
    direct = alias_to_code.get(cleaned) or alias_to_code.get(cleaned.lower())
    if direct:
        return direct

    # Step 2 station address strings use the province after the final comma
    if "," in cleaned:
        tail = cleaned.rsplit(",", 1)[-1].strip()
        tail_clean = re.sub(r"^(จังหวัด|จ\.\s*)", "", tail).strip()
        tail_match = alias_to_code.get(tail) or alias_to_code.get(tail_clean) or alias_to_code.get(tail_clean.lower())
        if tail_match:
            return tail_match
        en_tail = en_boundary_re.search(tail)
        if en_tail:
            return en_name_to_code[en_tail.group(1).lower()]
        return None

    # Step 3 safe Thai lookup requiring prefix for short province names
    for name_th, code in sorted(th_name_to_code.items(), key=lambda x: len(x[0]), reverse=True):
        if f"จังหวัด{name_th}" in cleaned or f"จ.{name_th}" in cleaned or f"จ. {name_th}" in cleaned:
            return code
        if len(name_th) >= 5 and name_th in cleaned:
            return code

    # Step 4 whole word English lookup
    en_match = en_boundary_re.search(cleaned)
    if en_match:
        return en_name_to_code[en_match.group(1).lower()]

    return None


def get_valid_province_codes() -> frozenset[str]:
    """Return the immutable set of 17 Northern province codes."""
    valid_codes, _, _, _, _, _ = _load_province_lookups()
    return valid_codes


def get_province_metadata() -> dict[str, dict]:
    """Return metadata keyed by 2 letter province code."""
    _, _, code_to_meta, _, _, _ = _load_province_lookups()
    return code_to_meta


SectorType = Literal["tourism_hotel", "food_retail", "transport", "general_service"]
ShockType = Literal["flood", "pm25", "water_pollution", "demand_drop", "cost_surge", "policy_relief"]
BusinessType = Literal["hotel", "restaurant", "tour", "general_service"]


class Air4ThaiStationReading(BaseModel):
    """Validated reading from Air4Thai API with sentinel value sanitization."""

    model_config = ConfigDict(str_strip_whitespace=True)

    station_id: str = Field(min_length=1)
    province_code: str
    recorded_at: datetime
    pm25: float | None = Field(default=None)
    aqi: int | None = Field(default=None)

    @field_validator("province_code", mode="before")
    @classmethod
    def validate_province(cls, value: str) -> str:
        """Ensure station belongs to one of the 17 Northern provinces."""
        resolved = resolve_northern_province(value)
        if not resolved:
            raise ValueError(f"Province outside Northern 17 scope ({value})")
        return resolved

    @field_validator("pm25", mode="before")
    @classmethod
    def sanitize_pm25(cls, value: object) -> float | None:
        """Convert Air4Thai sentinel values to None and enforce physical bounds."""
        if value is None or value == "" or value == "-":
            return None
        num = float(value)
        if num < 0:
            return None
        if num > 1500.0:
            raise ValueError(f"Unrealistic PM2.5 reading ({num})")
        return round(num, 2)

    @field_validator("aqi", mode="before")
    @classmethod
    def sanitize_aqi(cls, value: object) -> int | None:
        """Convert negative sentinel AQI values to None."""
        if value is None or value == "" or value == "-":
            return None
        num = int(float(value))
        return None if num < 0 else num


class NewsShockExtraction(BaseModel):
    """Strict structured output contract for LLM news shock extraction."""

    model_config = ConfigDict(str_strip_whitespace=True)

    province_code: str
    event_date: date
    sector: SectorType
    shock_type: ShockType
    severity_score: int = Field(ge=1, le=5)
    evidence_quote: str = Field(min_length=10, max_length=600)
    confidence: float = Field(ge=0.0, le=1.0)

    @field_validator("province_code", mode="before")
    @classmethod
    def validate_province(cls, value: str) -> str:
        """Reject any province outside the 17 Northern provinces."""
        resolved = resolve_northern_province(value)
        if not resolved:
            raise ValueError(f"Province outside Northern 17 scope ({value})")
        return resolved


class ReliefCheckRequest(BaseModel):
    """Validated user input for deterministic DSR and policy eligibility checks."""

    model_config = ConfigDict(str_strip_whitespace=True)

    province_code: str
    business_type: BusinessType
    impact_tags: list[str] = Field(default_factory=list, max_length=6)
    monthly_revenue_thb: float = Field(ge=0.0, le=1e11)
    monthly_debt_thb: float = Field(ge=0.0, le=1e11)
    question: str = Field(default="", max_length=1000)

    @field_validator("province_code", mode="before")
    @classmethod
    def validate_province(cls, value: str) -> str:
        """Normalize province input to its 2 letter Northern province code."""
        resolved = resolve_northern_province(value)
        if not resolved:
            raise ValueError(f"Province outside Northern 17 scope ({value})")
        return resolved
