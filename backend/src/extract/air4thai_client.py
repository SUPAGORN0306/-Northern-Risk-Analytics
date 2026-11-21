"""Live Air4Thai API extractor for the 17 Northern Thailand provinces."""

from __future__ import annotations

import hashlib
import json
import logging
import ssl
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
import truststore
import yaml

from src.db.connection import bulk_execute
from src.guardrails.schemas import Air4ThaiStationReading, resolve_northern_province

BACKEND_DIR = Path(__file__).resolve().parents[2]
ICT_TZ = timezone(timedelta(hours=7))
logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _load_air4thai_config() -> dict[str, Any]:
    """Load Air4Thai endpoint settings from config/sources.yaml."""
    cfg = yaml.safe_load((BACKEND_DIR / "config" / "sources.yaml").read_text(encoding="utf-8"))
    return cfg["air4thai"]


def _make_sha256(station_id: str, recorded_iso: str, pm25_raw: Any) -> str:
    """Compute deterministic SHA256 digest for idempotent Bronze ingestion."""
    key = f"{station_id}|{recorded_iso}|{pm25_raw}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _fetch_air4thai_json(url: str, timeout_sec: int) -> dict[str, Any]:
    """Fetch Air4Thai JSON with OS CA verification first, falling back if server omits intermediate CA."""
    tls_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    try:
        with httpx.Client(verify=tls_ctx, timeout=timeout_sec, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError as exc:
        err_text = str(exc)
        is_ssl_chain_err = (
            "CERTIFICATE_VERIFY_FAILED" in err_text
            or isinstance(exc.__cause__, ssl.SSLCertVerificationError)
        )
        if not is_ssl_chain_err:
            raise
        logger.warning(
            "Air4Thai TLS intermediate certificate missing on Linux/WSL; retrying public endpoint without SSL verification"
        )
        with httpx.Client(verify=False, timeout=timeout_sec, follow_redirects=True) as insecure_client:
            resp = insecure_client.get(url)
            resp.raise_for_status()
            return resp.json()


def fetch_northern_air4thai() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Fetch current Air4Thai stations and separate valid Northern rows from quarantined rows."""
    cfg = _load_air4thai_config()
    payload = _fetch_air4thai_json(cfg["endpoint_url"], int(cfg["timeout_sec"]))
    stations = payload.get("stations", [])

    bronze_rows: list[dict[str, Any]] = []
    quarantine_rows: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()

    for st in stations:
        area_th = st.get("areaTH") or ""
        area_en = st.get("areaEN") or ""
        province_code = resolve_northern_province(area_th) or resolve_northern_province(area_en)
        if not province_code:
            continue

        station_id = str(st.get("stationID", "")).strip()
        last = st.get("AQILast") or {}
        date_str = last.get("date")
        time_str = last.get("time")
        pm25_raw = (last.get("PM25") or {}).get("value")
        aqi_raw = (last.get("AQI") or {}).get("aqi")

        if not station_id or not date_str or not time_str:
            quarantine_rows.append(
                {
                    "source_table": "bronze.air4thai_raw",
                    "source_record_id": station_id or "unknown",
                    "error_reason": "Missing station identifier or timestamp",
                    "raw_payload": json.dumps(st, ensure_ascii=False),
                }
            )
            continue

        try:
            # Air4Thai timestamps use Thailand ICT offset
            recorded_at = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M").replace(
                tzinfo=ICT_TZ
            )
            validated = Air4ThaiStationReading(
                station_id=station_id,
                province_code=province_code,
                recorded_at=recorded_at,
                pm25=pm25_raw,
                aqi=aqi_raw,
            )
        except Exception as exc:
            quarantine_rows.append(
                {
                    "source_table": "bronze.air4thai_raw",
                    "source_record_id": station_id,
                    "error_reason": str(exc),
                    "raw_payload": json.dumps(st, ensure_ascii=False),
                }
            )
            continue

        digest = _make_sha256(station_id, validated.recorded_at.isoformat(), pm25_raw)
        if digest in seen_hashes:
            continue
        seen_hashes.add(digest)

        bronze_rows.append(
            {
                "station_id": validated.station_id,
                "province_raw": area_th or area_en,
                "recorded_at": validated.recorded_at,
                "pm25_raw": validated.pm25,
                "aqi_raw": validated.aqi,
                "raw_payload": json.dumps(st, ensure_ascii=False),
                "content_sha256": digest,
            }
        )

    return bronze_rows, quarantine_rows


def load_air4thai_to_bronze() -> dict[str, int]:
    """Extract live Northern Air4Thai data and bulk upsert into Neon Bronze and Quarantine."""
    bronze_rows, quarantine_rows = fetch_northern_air4thai()

    bronze_sql = """
        INSERT INTO bronze.air4thai_raw (
            station_id, province_raw, recorded_at, pm25_raw, aqi_raw, raw_payload, content_sha256
        ) VALUES (
            :station_id, :province_raw, :recorded_at, :pm25_raw, :aqi_raw,
            CAST(:raw_payload AS JSONB), :content_sha256
        )
        ON CONFLICT (content_sha256) DO NOTHING
    """
    quarantine_sql = """
        INSERT INTO silver.quarantine (
            source_table, source_record_id, error_reason, raw_payload
        ) VALUES (
            :source_table, :source_record_id, :error_reason, CAST(:raw_payload AS JSONB)
        )
        ON CONFLICT (source_table, source_record_id) DO NOTHING
    """

    inserted_bronze = bulk_execute(bronze_sql, bronze_rows)
    inserted_quarantine = bulk_execute(quarantine_sql, quarantine_rows)
    return {
        "fetched_valid": len(bronze_rows),
        "inserted_bronze": inserted_bronze,
        "quarantined": inserted_quarantine,
    }