"""Concurrent historical PM2.5 and rainfall extractor for 17 Northern provinces via Open Meteo."""

from __future__ import annotations

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests
import yaml

from src.db.connection import bulk_execute
from src.guardrails.schemas import get_province_metadata

BACKEND_DIR = Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def _load_open_meteo_config() -> tuple[dict[str, Any], dict[str, Any]]:
    """Load Open Meteo endpoints and PCD thresholds from YAML config files."""
    sources = yaml.safe_load((BACKEND_DIR / "config" / "sources.yaml").read_text(encoding="utf-8"))
    guards = yaml.safe_load((BACKEND_DIR / "config" / "guardrails.yaml").read_text(encoding="utf-8"))
    return sources["open_meteo"], guards["air4thai"]


def _resolve_date_window(
    start_date: str | None,
    end_date: str | None,
    lookback_months: int,
) -> tuple[str, str]:
    """Compute a dynamic date window relative to today when explicit dates are omitted."""
    end_dt = date.fromisoformat(end_date) if end_date else date.today()
    if start_date:
        start_dt = date.fromisoformat(start_date)
    else:
        approx_days = lookback_months * 30
        start_dt = (end_dt - timedelta(days=approx_days)).replace(day=1)
    return start_dt.isoformat(), end_dt.isoformat()


def _make_stat_hash(dataset: str, period: str, province: str, metric: str) -> str:
    """Compute SHA256 digest for idempotent monthly panel ingestion."""
    raw = f"{dataset}|{period}|{province}|{metric}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _fetch_province_monthly_hazards(
    code: str,
    meta: dict[str, Any],
    start_date: str,
    end_date: str,
) -> list[dict[str, Any]]:
    """Fetch hourly PM2.5 and daily rainfall for one province and vector aggregate to monthly."""
    cfg, air_cfg = _load_open_meteo_config()
    lat = float(meta["lat"])
    lon = float(meta["lon"])
    timeout = int(cfg["timeout_sec"])
    elevated_th = float(air_cfg["pm25_elevated_threshold"])
    critical_th = float(air_cfg["pm25_critical_threshold"])
    heavy_rain_th = float(cfg["heavy_rain_threshold_mm"])
    rows: list[dict[str, Any]] = []

    # Fetch historical PM2.5 hourly series and aggregate to monthly indicators
    aq_url = cfg["air_quality_url"]
    aq_resp = requests.get(
        aq_url,
        params={
            "latitude": lat,
            "longitude": lon,
            "start_date": start_date,
            "end_date": end_date,
            "hourly": "pm2_5",
            "timezone": "Asia/Bangkok",
        },
        timeout=timeout,
    )
    aq_resp.raise_for_status()
    aq_hourly = aq_resp.json().get("hourly") or {}
    if aq_hourly.get("time") and aq_hourly.get("pm2_5"):
        df_aq = pd.DataFrame(
            {
                "ts": pd.to_datetime(aq_hourly["time"]),
                "pm25": pd.to_numeric(aq_hourly["pm2_5"], errors="coerce"),
            }
        ).dropna()
        df_aq["obs_date"] = df_aq["ts"].dt.date
        daily_pm = df_aq.groupby("obs_date", as_index=False)["pm25"].mean()
        daily_pm["month_date"] = pd.to_datetime(daily_pm["obs_date"]).dt.to_period("M").dt.to_timestamp()
        daily_pm["over_elevated"] = (daily_pm["pm25"] > elevated_th).astype(np.int32)
        daily_pm["over_critical"] = (daily_pm["pm25"] > critical_th).astype(np.int32)

        monthly_pm = daily_pm.groupby("month_date", as_index=False).agg(
            pm25_mean=("pm25", "mean"),
            pm25_max=("pm25", "max"),
            pm25_days_over_37_5=("over_elevated", "sum"),
            pm25_days_over_75_0=("over_critical", "sum"),
        )
        for rec in monthly_pm.to_dict(orient="records"):
            period = rec["month_date"].date()
            period_str = period.isoformat()
            for metric in ("pm25_mean", "pm25_max", "pm25_days_over_37_5", "pm25_days_over_75_0"):
                val = round(float(rec[metric]), 3)
                rows.append(
                    {
                        "dataset_name": "open_meteo_pm25",
                        "source_org": "Open Meteo Air Quality Archive",
                        "source_file": aq_url,
                        "period_date": period,
                        "province_raw": meta["name_th"],
                        "metric_name": metric,
                        "metric_value": val,
                        "raw_row": json.dumps({"province_code": code, "month": period_str, metric: val}),
                        "content_sha256": _make_stat_hash("open_meteo_pm25", period_str, code, metric),
                    }
                )

    # Fetch historical daily rainfall and heavy rain days as flood proxy
    wx_url = cfg["weather_url"]
    wx_resp = requests.get(
        wx_url,
        params={
            "latitude": lat,
            "longitude": lon,
            "start_date": start_date,
            "end_date": end_date,
            "daily": "precipitation_sum",
            "timezone": "Asia/Bangkok",
        },
        timeout=timeout,
    )
    wx_resp.raise_for_status()
    wx_daily = wx_resp.json().get("daily") or {}
    if wx_daily.get("time") and wx_daily.get("precipitation_sum"):
        df_wx = pd.DataFrame(
            {
                "obs_date": pd.to_datetime(wx_daily["time"]),
                "rain_mm": pd.to_numeric(wx_daily["precipitation_sum"], errors="coerce"),
            }
        ).dropna()
        df_wx["month_date"] = df_wx["obs_date"].dt.to_period("M").dt.to_timestamp()
        df_wx["heavy_rain_day"] = (df_wx["rain_mm"] >= heavy_rain_th).astype(np.int32)

        monthly_wx = df_wx.groupby("month_date", as_index=False).agg(
            rainfall_sum_mm=("rain_mm", "sum"),
            rainfall_max_day_mm=("rain_mm", "max"),
            heavy_rain_days=("heavy_rain_day", "sum"),
        )
        for rec in monthly_wx.to_dict(orient="records"):
            period = rec["month_date"].date()
            period_str = period.isoformat()
            for metric in ("rainfall_sum_mm", "rainfall_max_day_mm", "heavy_rain_days"):
                val = round(float(rec[metric]), 3)
                rows.append(
                    {
                        "dataset_name": "open_meteo_rainfall",
                        "source_org": "Open Meteo Historical Weather",
                        "source_file": wx_url,
                        "period_date": period,
                        "province_raw": meta["name_th"],
                        "metric_name": metric,
                        "metric_value": val,
                        "raw_row": json.dumps({"province_code": code, "month": period_str, metric: val}),
                        "content_sha256": _make_stat_hash("open_meteo_rainfall", period_str, code, metric),
                    }
                )

    return rows


def fetch_all_northern_hazards(
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    """Fetch monthly PM2.5 and rainfall history concurrently for all 17 Northern provinces."""
    cfg, _ = _load_open_meteo_config()
    resolved_start, resolved_end = _resolve_date_window(
        start_date, end_date, int(cfg["lookback_months"])
    )
    provinces = get_province_metadata()
    all_rows: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=int(cfg["max_workers"])) as pool:
        futures = {
            pool.submit(_fetch_province_monthly_hazards, code, meta, resolved_start, resolved_end): code
            for code, meta in provinces.items()
        }
        for future in as_completed(futures):
            all_rows.extend(future.result())

    return all_rows


def load_historical_hazards_to_bronze(
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, int]:
    """Load monthly PM2.5 and rainfall panel data into bronze.provincial_stats_raw."""
    rows = fetch_all_northern_hazards(start_date=start_date, end_date=end_date)
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
    inserted = bulk_execute(upsert_sql, rows)
    return {"fetched_rows": len(rows), "inserted_bronze": inserted}
