"""Deterministic Bronze to Silver cleaning with freshness and quarantine guardrails."""

from __future__ import annotations

import json
from datetime import timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from src.db.connection import bulk_execute, fetch_all
from src.guardrails.schemas import resolve_northern_province

BACKEND_DIR = Path(__file__).resolve().parents[2]
ICT_TZ = timezone(timedelta(hours=7))


@lru_cache(maxsize=1)
def _load_air_thresholds() -> dict[str, float]:
    """Load PCD PM2.5 thresholds from config/guardrails.yaml."""
    cfg = yaml.safe_load((BACKEND_DIR / "config" / "guardrails.yaml").read_text(encoding="utf-8"))
    return cfg["air4thai"]


def _existing_quarantine_ids(source_table: str) -> set[str]:
    """Return O(1) lookup set of record IDs already quarantined for a source table."""
    rows = fetch_all(
        "SELECT source_record_id FROM silver.quarantine WHERE source_table = :tbl",
        {"tbl": source_table},
    )
    return {str(r["source_record_id"]) for r in rows}


def transform_air4thai_bronze_to_silver(max_age_hours: int = 48) -> dict[str, int]:
    """Aggregate fresh Northern Air4Thai readings to silver.air_daily and quarantine stale sensors."""
    air_cfg = _load_air_thresholds()
    elevated_th = float(air_cfg["pm25_elevated_threshold"])
    critical_th = float(air_cfg["pm25_critical_threshold"])

    raw_rows = fetch_all(
        """
        SELECT id, station_id, province_raw, recorded_at, pm25_raw, fetched_at
        FROM bronze.air4thai_raw
        """
    )
    already_quarantined = _existing_quarantine_ids("bronze.air4thai_raw")

    valid_records: list[dict[str, Any]] = []
    new_quarantine: list[dict[str, Any]] = []

    for row in raw_rows:
        rec_id = str(row["id"])
        prov_code = resolve_northern_province(row.get("province_raw"))
        recorded_at = row["recorded_at"]
        fetched_at = row["fetched_at"]
        pm25_val = row["pm25_raw"]

        error_reason: str | None = None
        if not prov_code:
            error_reason = "Province outside Northern 17 scope"
        elif pm25_val is None or float(pm25_val) < 0:
            error_reason = "Missing or invalid PM2.5 reading"
        elif fetched_at and recorded_at:
            age_hours = (fetched_at - recorded_at).total_seconds() / 3600.0
            if age_hours > max_age_hours:
                error_reason = f"Stale Air4Thai sensor exceeding {max_age_hours} hours ({age_hours:.1f}h old)"

        if error_reason:
            if rec_id not in already_quarantined:
                already_quarantined.add(rec_id)
                new_quarantine.append(
                    {
                        "source_table": "bronze.air4thai_raw",
                        "source_record_id": rec_id,
                        "error_reason": error_reason,
                        "raw_payload": json.dumps(
                            {
                                "id": row["id"],
                                "station_id": row["station_id"],
                                "province_raw": row["province_raw"],
                                "recorded_at": recorded_at.isoformat() if recorded_at else None,
                                "pm25_raw": pm25_val,
                            },
                            ensure_ascii=False,
                        ),
                    }
                )
            continue

        obs_date = recorded_at.astimezone(ICT_TZ).date()
        valid_records.append(
            {
                "province_code": prov_code,
                "obs_date": obs_date,
                "station_id": row["station_id"],
                "pm25": float(pm25_val),
            }
        )

    quarantine_sql = """
        INSERT INTO silver.quarantine (
            source_table, source_record_id, error_reason, raw_payload
        ) VALUES (
            :source_table, :source_record_id, :error_reason, CAST(:raw_payload AS JSONB)
        )
        ON CONFLICT (source_table, source_record_id) DO NOTHING
    """
    inserted_quarantine = bulk_execute(quarantine_sql, new_quarantine)

    upserted_silver = 0
    if valid_records:
        df = pd.DataFrame(valid_records)
        agg = df.groupby(["province_code", "obs_date"], as_index=False).agg(
            pm25_mean=("pm25", "mean"),
            pm25_max=("pm25", "max"),
            station_count=("station_id", "nunique"),
        )
        silver_rows = [
            {
                "province_code": rec["province_code"],
                "obs_date": rec["obs_date"],
                "pm25_mean": round(float(rec["pm25_mean"]), 2),
                "pm25_max": round(float(rec["pm25_max"]), 2),
                "station_count": int(rec["station_count"]),
                "exceeds_37_5": bool(rec["pm25_mean"] > elevated_th),
                "exceeds_75_0": bool(rec["pm25_mean"] > critical_th),
            }
            for rec in agg.to_dict(orient="records")
        ]
        silver_sql = """
            INSERT INTO silver.air_daily (
                province_code, obs_date, pm25_mean, pm25_max,
                station_count, exceeds_37_5, exceeds_75_0
            ) VALUES (
                :province_code, :obs_date, :pm25_mean, :pm25_max,
                :station_count, :exceeds_37_5, :exceeds_75_0
            )
            ON CONFLICT (province_code, obs_date) DO UPDATE SET
                pm25_mean = EXCLUDED.pm25_mean,
                pm25_max = EXCLUDED.pm25_max,
                station_count = EXCLUDED.station_count,
                exceeds_37_5 = EXCLUDED.exceeds_37_5,
                exceeds_75_0 = EXCLUDED.exceeds_75_0,
                updated_at = NOW()
        """
        upserted_silver = bulk_execute(silver_sql, silver_rows)

    return {
        "bronze_scanned": len(raw_rows),
        "valid_readings": len(valid_records),
        "silver_daily_upserted": upserted_silver,
        "newly_quarantined": inserted_quarantine,
    }
