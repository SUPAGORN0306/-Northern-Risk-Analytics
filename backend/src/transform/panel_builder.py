"""Aligned monthly panel and 17 province structural profile builders with seasonality removal."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from src.config.feature_registry import get_validation_policy
from src.db.connection import fetch_all
from src.guardrails.schemas import get_province_metadata, resolve_northern_province


def build_monthly_analysis_panel(
    train_cutoff_date: pd.Timestamp | None = None,
    prevent_lookahead: bool = True,
) -> pd.DataFrame:
    """Build aligned 17 province monthly panel with train fitted seasonal baselines to avoid lookahead leakage."""
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

    # Reindex to complete province x monthly calendar grid BEFORE YoY diffs so missing months never misalign lag 12
    prov_wide = prov_wide.dropna(subset=["occupancy_rate"]).sort_values(["province_code", "period_date"])
    if not prov_wide.empty:
        all_provinces = sorted(prov_wide["province_code"].unique())
        min_month = prov_wide["period_date"].min()
        max_month = prov_wide["period_date"].max()
        full_months = pd.date_range(start=min_month, end=max_month, freq="MS")
        full_idx = pd.MultiIndex.from_product(
            [all_provinces, full_months], names=["province_code", "period_date"]
        )
        cal_grid = (
            prov_wide.set_index(["province_code", "period_date"])
            .reindex(full_idx)
            .reset_index()
        )
        cal_grp = cal_grid.groupby("province_code", sort=False)
        cal_grid["occupancy_yoy_diff"] = cal_grp["occupancy_rate"].diff(12)
        cal_grid["visitors_yoy_pct"] = cal_grp["visitors_total"].pct_change(12, fill_method=None) * 100.0
        cal_grid["revenue_yoy_pct"] = cal_grp["revenue_total_mthb"].pct_change(12, fill_method=None) * 100.0
        prov_wide = cal_grid.dropna(subset=["occupancy_rate"]).sort_values(["province_code", "period_date"])

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

    panel["log_visitors"] = np.log1p(panel["visitors_total"].clip(lower=0))
    panel["log_revenue"] = np.log1p(panel["revenue_total_mthb"].clip(lower=0))

    # Estimate seasonal means and standardization stats strictly on chronological train window to prevent leakage
    unique_months = np.sort(panel["period_date"].unique())
    if train_cutoff_date is not None:
        cutoff = pd.Timestamp(train_cutoff_date)
    elif prevent_lookahead and len(unique_months) >= 16:
        policy = get_validation_policy()
        split_idx = max(12, int(len(unique_months) * float(policy["time_split_train_ratio"])))
        cutoff = pd.Timestamp(unique_months[min(split_idx, len(unique_months) - 1)])
    else:
        cutoff = pd.Timestamp(unique_months[-1])

    fit_panel = panel[panel["period_date"] <= cutoff]
    if fit_panel.empty:
        fit_panel = panel

    panel["seasonal_fit_cutoff_date"] = cutoff

    def _apply_seasonal_anomaly(col: str) -> pd.Series:
        pm_means = (
            fit_panel.groupby(["province_code", "cal_month"])[col]
            .mean()
            .rename("_pm_mean")
        )
        p_fallback = fit_panel.groupby("province_code")[col].mean().rename("_p_mean")
        joined = panel[["province_code", "cal_month"]].merge(
            pm_means.reset_index(), on=["province_code", "cal_month"], how="left"
        )
        joined = joined.merge(p_fallback.reset_index(), on="province_code", how="left")
        baseline = joined["_pm_mean"].fillna(joined["_p_mean"]).to_numpy(dtype=float)
        return pd.Series(panel[col].to_numpy(dtype=float) - baseline, index=panel.index)

    def _apply_train_zscore(col: str) -> pd.Series:
        p_stats = fit_panel.groupby("province_code")[col].agg(["mean", "std"]).reset_index()
        joined = panel[["province_code"]].merge(p_stats, on="province_code", how="left")
        stds = joined["std"].replace(0, np.nan).to_numpy(dtype=float)
        means = joined["mean"].to_numpy(dtype=float)
        return pd.Series((panel[col].to_numpy(dtype=float) - means) / stds, index=panel.index)

    panel["occupancy_deseason"] = _apply_seasonal_anomaly("occupancy_rate")
    panel["visitors_deseason_pct"] = _apply_seasonal_anomaly("log_visitors") * 100.0
    panel["revenue_deseason_pct"] = _apply_seasonal_anomaly("log_revenue") * 100.0

    # Hazard seasonal excess and train fitted province standardized scores
    if "rainfall_sum_mm" in panel.columns:
        panel["rainfall_excess_mm"] = _apply_seasonal_anomaly("rainfall_sum_mm")
        panel["rainfall_z_prov"] = _apply_train_zscore("rainfall_sum_mm")

    if "pm25_mean" in panel.columns:
        panel["pm25_excess"] = _apply_seasonal_anomaly("pm25_mean")
        panel["pm25_z_prov"] = _apply_train_zscore("pm25_mean")

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
    def _annualize_observed_monthly_days(series: pd.Series) -> float:
        observed_months = int(series.notna().sum())
        if observed_months == 0:
            return float("nan")
        return float(series.sum()) * 12.0 / observed_months

    # Aggregate 34 month tourism exposure and chronic physical hazard per province
    struct = panel.groupby("province_code", as_index=False).agg(
        avg_occupancy_rate=("occupancy_rate", "mean"),
        occupancy_volatility=("occupancy_rate", "std"),
        avg_monthly_revenue_mthb=("revenue_total_mthb", "mean"),
        foreign_visitor_share=("foreign_visitor_share", "mean"),
        foreign_revenue_share=("foreign_revenue_share", "mean"),
        pm25_mean_3y=("pm25_mean", "mean"),
        pm25_p90_3y=("pm25_mean", lambda s: float(np.nanpercentile(s, 90))),
        annual_pm25_days_over_37_5=("pm25_days_over_37_5", _annualize_observed_monthly_days),
        annual_pm25_days_over_75_0=("pm25_days_over_75_0", _annualize_observed_monthly_days),
        annual_heavy_rain_days=("heavy_rain_days", _annualize_observed_monthly_days),
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
