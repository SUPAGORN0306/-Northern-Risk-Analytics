"""Concurrent extractor for official Thailand macro control series from BIS and FRED."""

from __future__ import annotations

import hashlib
import io
import json
import ssl
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
import truststore
import yaml

from src.db.connection import bulk_execute

BACKEND_DIR = Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def _load_macro_config() -> tuple[dict[str, Any], int]:
    """Load BIS and FRED control endpoints plus lookback window from config/sources.yaml."""
    cfg = yaml.safe_load((BACKEND_DIR / "config" / "sources.yaml").read_text(encoding="utf-8"))
    return cfg["macro_controls"], int(cfg["open_meteo"]["lookback_months"])


def _make_control_hash(dataset: str, period_str: str, metric: str) -> str:
    """Compute SHA256 digest for idempotent macro control upsert."""
    raw = f"{dataset}|{period_str}|MACRO|{metric}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _fetch_bis_cpi(url: str, metric_name: str, timeout_sec: int) -> list[dict[str, Any]]:
    """Fetch official monthly Thailand CPI series from the BIS SDMX API."""
    tls_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    with httpx.Client(verify=tls_ctx, timeout=timeout_sec, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()

    df = pd.read_csv(io.StringIO(resp.text))
    df["period_date"] = pd.to_datetime(df["TIME_PERIOD"], format="%Y-%m", errors="coerce").dt.date
    df["val"] = pd.to_numeric(df["OBS_VALUE"], errors="coerce")
    df = df.dropna(subset=["period_date", "val"])

    rows: list[dict[str, Any]] = []
    for rec in df.to_dict(orient="records"):
        period = rec["period_date"]
        val = round(float(rec["val"]), 4)
        rows.append(
            {
                "dataset_name": "macro_controls",
                "source_org": "Bank for International Settlements",
                "source_file": url,
                "period_date": period,
                "province_raw": None,
                "metric_name": metric_name,
                "metric_value": val,
                "raw_row": json.dumps({"period": period.isoformat(), "metric": metric_name, "value": val}),
                "content_sha256": _make_control_hash("macro_controls", period.isoformat(), metric_name),
            }
        )
    return rows


def _fetch_fred_monthly(
    base_url: str,
    metric_name: str,
    series_id: str,
    start_date: str,
    timeout_sec: int,
) -> list[dict[str, Any]]:
    """Fetch an official FRED CSV series and aggregate daily observations to monthly means."""
    url = f"{base_url}?id={series_id}&cosd={start_date}"
    tls_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    with httpx.Client(verify=tls_ctx, timeout=timeout_sec, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()

    df = pd.read_csv(io.StringIO(resp.text))
    df.columns = ["obs_date", "val"]
    df["obs_date"] = pd.to_datetime(df["obs_date"], errors="coerce")
    df["val"] = pd.to_numeric(df["val"], errors="coerce")
    df = df.dropna(subset=["obs_date", "val"])

    df["month_date"] = df["obs_date"].dt.to_period("M").dt.to_timestamp()
    monthly = df.groupby("month_date", as_index=False)["val"].mean().sort_values("month_date")
    monthly["yoy_pct"] = monthly["val"].pct_change(periods=12) * 100.0

    rows: list[dict[str, Any]] = []
    for rec in monthly.to_dict(orient="records"):
        period = rec["month_date"].date()
        period_str = period.isoformat()
        level_val = round(float(rec["val"]), 4)
        rows.append(
            {
                "dataset_name": "macro_controls",
                "source_org": "Federal Reserve Economic Data",
                "source_file": series_id,
                "period_date": period,
                "province_raw": None,
                "metric_name": metric_name,
                "metric_value": level_val,
                "raw_row": json.dumps({"series_id": series_id, "period": period_str, "value": level_val}),
                "content_sha256": _make_control_hash("macro_controls", period_str, metric_name),
            }
        )
        if pd.notna(rec["yoy_pct"]):
            yoy_metric = f"{metric_name}_yoy_pct"
            yoy_val = round(float(rec["yoy_pct"]), 4)
            rows.append(
                {
                    "dataset_name": "macro_controls",
                    "source_org": "Federal Reserve Economic Data",
                    "source_file": series_id,
                    "period_date": period,
                    "province_raw": None,
                    "metric_name": yoy_metric,
                    "metric_value": yoy_val,
                    "raw_row": json.dumps({"series_id": series_id, "period": period_str, "yoy_pct": yoy_val}),
                    "content_sha256": _make_control_hash("macro_controls", period_str, yoy_metric),
                }
            )
    return rows


def load_macro_controls_to_bronze() -> dict[str, int]:
    """Fetch official BIS CPI and FRED macro control series concurrently into Neon Bronze."""
    cfg, lookback_months = _load_macro_config()
    timeout = int(cfg["timeout_sec"])
    # Fetch an extra 12 months so YoY percentage changes are populated across the full 36 month window
    start_dt = (date.today() - timedelta(days=(lookback_months + 13) * 30)).replace(day=1)
    start_str = start_dt.isoformat()

    all_rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=int(cfg["max_workers"])) as pool:
        futures = [
            pool.submit(_fetch_bis_cpi, cfg["bis_th_cpi_yoy_url"], "th_cpi_yoy_pct", timeout),
            pool.submit(_fetch_bis_cpi, cfg["bis_th_cpi_idx_url"], "th_cpi_index", timeout),
        ]
        for metric_name, series_id in cfg["fred_series"].items():
            futures.append(
                pool.submit(_fetch_fred_monthly, cfg["fred_base_url"], metric_name, series_id, start_str, timeout)
            )
        for fut in as_completed(futures):
            all_rows.extend(fut.result())

    upsert_sql = """
        INSERT INTO bronze.provincial_stats_raw (
            dataset_name, source_org, source_file, period_date,
            province_raw, metric_name, metric_value, raw_row, content_sha256
        ) VALUES (
            :dataset_name, :source_org, :source_file, :period_date,
            :province_raw, :metric_name, :metric_value, CAST(:raw_row AS JSONB), :content_sha256
        )
        ON CONFLICT (content_sha256) DO NOTHING
    """
    inserted = bulk_execute(upsert_sql, all_rows)
    return {"fetched_rows": len(all_rows), "inserted_bronze": inserted}
