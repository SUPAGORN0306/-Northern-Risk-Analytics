"""Aligned monthly panel and 17 province structural profile builders with seasonality removal."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from src.db.connection import fetch_all
from src.guardrails.schemas import get_province_metadata, resolve_northern_province


def build_monthly_analysis_panel() -> pd.DataFrame:
    """Build aligned 17 province monthly panel excluding incomplete current month and annual NSO rows."""
    today_month = date.today().replace(day=1)

    rows = fetch_all(
        """
        SELECT dataset_name, period_date, province_raw, metric_name, metric_value
        FROM bronze.provincial_stats_raw
        WHERE dataset_name IN ('mots_tourism', 'open_meteo_pm25', 'open_meteo_rainfall', 'macro_controls')
          AND period_date < :today_month
        """,
        {"today_month": today_month},
    )
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame()

    df["period_date"] = pd.to_datetime(df["period_date"])
    df["metric_value"] = pd.to_numeric(df["metric_value"], errors="coerce")

    # Separate provincial monthly records from national macro control series
    prov_df = df[df["dataset_name"] != "macro_controls"].copy()
    prov_df["province_code"] = prov_df["province_raw"].map(resolve_northern_province)
    prov_df = prov_df.dropna(subset=["province_code"])

    prov_wide = prov_df.pivot_table(
        index=["province_code", "period_date"],
        columns="metric_name",
        values="metric_value",
        aggfunc="first",
    ).reset_index()

    # Keep only months where MOTS target occupancy exists so every target row is complete
    prov_wide = prov_wide.dropna(subset=["occupancy_rate"]).sort_values(["province_code", "period_date"])

    # Merge macro controls by month_date
    macro_df = df[df["dataset_name"] == "macro_controls"].copy()
    if not macro_df.empty:
        macro_wide = macro_df.pivot_table(
            index="period_date",
            columns="metric_name",
            values="metric_value",
            aggfunc="first",
        ).reset_index()
        panel = prov_wide.merge(macro_wide, on="period_date", how="left")
    else:
        panel = prov_wide

    panel["cal_month"] = panel["period_date"].dt.month

    # Vectorized deseasonalization and YoY feature engineering per province
    grp = panel.groupby("province_code", sort=False)
    panel["occupancy_yoy_diff"] = grp["occupancy_rate"].diff(12)
    panel["visitors_yoy_pct"] = grp["visitors_total"].pct_change(12) * 100.0
    panel["revenue_yoy_pct"] = grp["revenue_total_mthb"].pct_change(12) * 100.0

    # Calendar month baseline anomaly preserves all 34 months including 2024 flood episodes
    pm_grp = panel.groupby(["province_code", "cal_month"])
    panel["occupancy_deseason"] = panel["occupancy_rate"] - pm_grp["occupancy_rate"].transform("mean")
    panel["log_visitors"] = np.log1p(panel["visitors_total"].clip(lower=0))
    panel["visitors_deseason_pct"] = (
        panel["log_visitors"] - pm_grp["log_visitors"].transform("mean")
    ) * 100.0
    panel["log_revenue"] = np.log1p(panel["revenue_total_mthb"].clip(lower=0))
    panel["revenue_deseason_pct"] = (
        panel["log_revenue"] - pm_grp["log_revenue"].transform("mean")
    ) * 100.0

    # Hazard seasonal excess and full sample province standardized scores
    if "rainfall_sum_mm" in panel.columns:
        panel["rainfall_excess_mm"] = panel["rainfall_sum_mm"] - pm_grp["rainfall_sum_mm"].transform("mean")
        rain_prov_mean = grp["rainfall_sum_mm"].transform("mean")
        rain_prov_std = grp["rainfall_sum_mm"].transform("std").replace(0, np.nan)
        panel["rainfall_z_prov"] = (panel["rainfall_sum_mm"] - rain_prov_mean) / rain_prov_std

    if "pm25_mean" in panel.columns:
        panel["pm25_excess"] = panel["pm25_mean"] - pm_grp["pm25_mean"].transform("mean")
        pm_prov_mean = grp["pm25_mean"].transform("mean")
        pm_prov_std = grp["pm25_mean"].transform("std").replace(0, np.nan)
        panel["pm25_z_prov"] = (panel["pm25_mean"] - pm_prov_mean) / pm_prov_std

    if {"visitors_foreign", "visitors_total"}.issubset(panel.columns):
        panel["foreign_visitor_share"] = (
            panel["visitors_foreign"] / panel["visitors_total"].replace(0, np.nan)
        ) * 100.0

    if {"revenue_foreign_mthb", "revenue_total_mthb"}.issubset(panel.columns):
        panel["foreign_revenue_share"] = (
            panel["revenue_foreign_mthb"] / panel["revenue_total_mthb"].replace(0, np.nan)
        ) * 100.0

    return panel.reset_index(drop=True)


def build_provincial_structural_profile(panel: pd.DataFrame | None = None) -> pd.DataFrame:
    """Build 17 row cross sectional profile combining MOTS exposure, chronic hazards, and NSO debt."""
    if panel is None:
        panel = build_monthly_analysis_panel()

    meta_map = get_province_metadata()
    n_months = max(panel["period_date"].nunique(), 1)
    annual_factor = 12.0 / float(n_months)

    # Aggregate 34 month tourism exposure and chronic physical hazard per province
    struct = panel.groupby("province_code", as_index=False).agg(
        avg_occupancy_rate=("occupancy_rate", "mean"),
        occupancy_volatility=("occupancy_rate", "std"),
        avg_monthly_revenue_mthb=("revenue_total_mthb", "mean"),
        foreign_visitor_share=("foreign_visitor_share", "mean"),
        foreign_revenue_share=("foreign_revenue_share", "mean"),
        pm25_mean_3y=("pm25_mean", "mean"),
        pm25_p90_3y=("pm25_mean", lambda s: float(np.nanpercentile(s, 90))),
        annual_pm25_days_over_37_5=("pm25_days_over_37_5", lambda s: float(s.sum()) * annual_factor),
        annual_pm25_days_over_75_0=("pm25_days_over_75_0", lambda s: float(s.sum()) * annual_factor),
        annual_heavy_rain_days=("heavy_rain_days", lambda s: float(s.sum()) * annual_factor),
        max_monthly_rainfall_mm=("rainfall_sum_mm", "max"),
    )

    # Attach latest official NSO household finance survey (2025) for All households and Non farm SMEs
    nso_rows = fetch_all(
        """
        SELECT period_date, province_raw, metric_name, metric_value
        FROM bronze.provincial_stats_raw
        WHERE dataset_name = 'nso_household_finance'
        """
    )
    nso_df = pd.DataFrame(nso_rows)
    if not nso_df.empty:
        nso_df["province_code"] = nso_df["province_raw"].map(resolve_northern_province)
        latest_year = nso_df["period_date"].max()
        nso_latest = nso_df[nso_df["period_date"] == latest_year].pivot_table(
            index="province_code",
            columns="metric_name",
            values="metric_value",
            aggfunc="first",
        ).reset_index()

        # Compute annual debt to income ratios deterministically for both overall and SME households
        if {"avg_household_debt_thb_all", "monthly_income_thb_all"}.issubset(nso_latest.columns):
            nso_latest["debt_to_annual_income_all"] = nso_latest["avg_household_debt_thb_all"] / (
                nso_latest["monthly_income_thb_all"].replace(0, np.nan) * 12.0
            )
        if {"avg_household_debt_thb_sme", "monthly_income_thb_sme"}.issubset(nso_latest.columns):
            nso_latest["debt_to_annual_income_sme"] = nso_latest["avg_household_debt_thb_sme"] / (
                nso_latest["monthly_income_thb_sme"].replace(0, np.nan) * 12.0
            )

        struct = struct.merge(nso_latest, on="province_code", how="left")

    struct["name_th"] = struct["province_code"].map(lambda c: meta_map[c]["name_th"])
    struct["name_en"] = struct["province_code"].map(lambda c: meta_map[c]["name_en"])
    struct["subregion"] = struct["province_code"].map(lambda c: meta_map[c]["subregion"])
    return struct.sort_values("province_code").reset_index(drop=True)
