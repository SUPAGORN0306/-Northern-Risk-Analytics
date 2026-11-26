"""Aligned monthly panel and 17 province structural profile builders with seasonality removal."""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from src.config.feature_registry import get_validation_policy
from src.db.connection import bulk_execute, fetch_all
from src.guardrails.schemas import get_province_metadata, resolve_northern_province


def build_monthly_analysis_panel(
    train_cutoff_date: pd.Timestamp | None = None,
    prevent_lookahead: bool = True,
) -> pd.DataFrame:
    """Build aligned 17 province monthly panel with train fitted seasonal baselines to avoid lookahead leakage."""
    today_month = date.today().replace(day=1)

    rows = fetch_all(
        """
        SELECT id, fetched_at, dataset_name, period_date, province_raw, metric_name, metric_value
        FROM bronze.provincial_stats_raw
        WHERE dataset_name = 'macro_controls' AND period_date < :today_month
        UNION ALL
        SELECT r.source_bronze_id AS id, b.fetched_at, r.dataset_name, r.period_date,
               d.name_th AS province_raw, r.metric_name, r.metric_value
        FROM silver.provincial_stats_resolved r
        JOIN silver.dim_provinces d ON d.province_code = r.province_code
        JOIN bronze.provincial_stats_raw b ON b.id = r.source_bronze_id
        WHERE r.dataset_name IN ('mots_tourism', 'open_meteo_pm25', 'open_meteo_rainfall')
          AND r.period_date < :today_month
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

    # Resolve duplicate monthly natural keys deterministically using latest fetched revision
    prov_df = prov_df.sort_values(["fetched_at", "id"], ascending=[False, False])
    prov_df = prov_df.drop_duplicates(
        subset=["province_code", "period_date", "metric_name"], keep="first"
    )
    if prov_df.duplicated(subset=["province_code", "period_date", "metric_name"]).any():
        raise ValueError("Resolved provincial panel still contains duplicate natural keys")
    # `pivot` deliberately raises on an unexpected duplicate instead of silently taking a value.
    prov_wide = prov_df.pivot(
        index=["province_code", "period_date"],
        columns="metric_name",
        values="metric_value",
    ).reset_index()

    # Reindex to complete province x monthly calendar grid BEFORE YoY diffs so missing months never misalign lag 12
    prov_wide = prov_wide.sort_values(["province_code", "period_date"])
    if not prov_wide.empty:
        all_provinces = sorted(get_province_metadata().keys())
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
        prov_wide = cal_grid.sort_values(["province_code", "period_date"])

    # Merge macro controls by month_date using latest fetched revision deterministically
    macro_df = df[df["dataset_name"] == "macro_controls"].copy()
    if not macro_df.empty:
        macro_df = macro_df.sort_values(["fetched_at", "id"], ascending=[False, False])
        macro_df = macro_df.drop_duplicates(subset=["period_date", "metric_name"], keep="first")
        if macro_df.duplicated(subset=["period_date", "metric_name"]).any():
            raise ValueError("Resolved macro controls still contain duplicate month/metric keys")
        macro_wide = macro_df.pivot(
            index="period_date",
            columns="metric_name",
            values="metric_value",
        ).reset_index()
        panel = prov_wide.merge(macro_wide, on="period_date", how="left")
    else:
        panel = prov_wide

    panel["cal_month"] = panel["period_date"].dt.month
    metric_cols = [
        col for col in panel.columns
        if col not in {"province_code", "period_date", "cal_month", "seasonal_fit_cutoff_date"}
    ]
    # Preserve missingness explicitly: zero is an observed value, never a substitute for missing.
    has_any_value = panel[metric_cols].notna().any(axis=1)
    all_observed_values_are_zero = panel[metric_cols].fillna(0).eq(0).all(axis=1)
    panel["data_status"] = np.select(
        [has_any_value & all_observed_values_are_zero, has_any_value],
        ["true_zero", "observed"],
        default="no_data",
    )
    panel["metric_status"] = panel[metric_cols].apply(
        lambda row: {
            str(col): ("no_data" if pd.isna(value) else ("true_zero" if float(value) == 0.0 else "observed"))
            for col, value in row.items()
        },
        axis=1,
    )

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


def resolve_provincial_stats() -> dict[str, Any]:
    """Materialize one latest revision per provincial metric and audit revision conflicts."""
    rows = fetch_all(
        """
        SELECT id, dataset_name, period_date, province_raw, metric_name, metric_value, fetched_at
        FROM bronze.provincial_stats_raw
        WHERE dataset_name IN ('mots_tourism', 'open_meteo_pm25', 'open_meteo_rainfall')
        ORDER BY fetched_at DESC, id DESC
        """
    )
    if not rows:
        return {"source_rows": 0, "resolved_rows": 0, "conflicting_keys": 0}

    grouped: dict[tuple[str, str, Any, str], list[dict[str, Any]]] = {}
    for row in rows:
        province_code = resolve_northern_province(row.get("province_raw"))
        if not province_code:
            continue
        key = (str(row["dataset_name"]), province_code, row["period_date"], str(row["metric_name"]))
        grouped.setdefault(key, []).append(row)

    resolved: list[dict[str, Any]] = []
    conflicts = 0
    for (dataset, province, period, metric), versions in grouped.items():
        values = {float(r["metric_value"]) for r in versions if r.get("metric_value") is not None}
        has_conflict = len(values) > 1
        conflicts += int(has_conflict)
        latest = versions[0]
        resolved.append({
            "dataset_name": dataset,
            "province_code": province,
            "period_date": period,
            "metric_name": metric,
            "metric_value": latest.get("metric_value"),
            "source_bronze_id": int(latest["id"]),
            "revision_count": len(versions),
            "has_conflict": has_conflict,
        })

    upsert_sql = """
        INSERT INTO silver.provincial_stats_resolved (
            dataset_name, province_code, period_date, metric_name, metric_value,
            source_bronze_id, revision_count, has_conflict, resolved_at
        ) VALUES (
            :dataset_name, :province_code, :period_date, :metric_name, :metric_value,
            :source_bronze_id, :revision_count, :has_conflict, NOW()
        ) ON CONFLICT (dataset_name, province_code, period_date, metric_name) DO UPDATE SET
            metric_value = EXCLUDED.metric_value,
            source_bronze_id = EXCLUDED.source_bronze_id,
            revision_count = EXCLUDED.revision_count,
            has_conflict = EXCLUDED.has_conflict,
            resolved_at = NOW()
    """
    written = bulk_execute(upsert_sql, resolved)
    return {"source_rows": len(rows), "resolved_rows": written, "conflicting_keys": conflicts}


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

    # Attach latest official NSO household finance survey ordered by latest revision
    nso_rows = fetch_all(
        """
        SELECT id, fetched_at, period_date, province_raw, metric_name, metric_value
        FROM bronze.provincial_stats_raw
        WHERE dataset_name = 'nso_household_finance'
        ORDER BY fetched_at DESC, id DESC
        """
    )
    nso_df = pd.DataFrame(nso_rows)
    if not nso_df.empty:
        nso_df["province_code"] = nso_df["province_raw"].map(resolve_northern_province)
        latest_year = nso_df["period_date"].max()
        nso_sub = nso_df[nso_df["period_date"] == latest_year].sort_values(
            ["fetched_at", "id"], ascending=[False, False]
        )
        nso_sub = nso_sub.drop_duplicates(subset=["province_code", "metric_name"], keep="first")
        if nso_sub.duplicated(subset=["province_code", "metric_name"]).any():
            raise ValueError("Resolved NSO profile still contains duplicate province/metric keys")
        nso_latest = nso_sub.pivot(
            index="province_code",
            columns="metric_name",
            values="metric_value",
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

    struct["log_foreign_visitor_share"] = np.log1p(struct["foreign_visitor_share"].clip(lower=0.0))
    struct["name_th"] = struct["province_code"].map(lambda c: meta_map[c]["name_th"])
    struct["name_en"] = struct["province_code"].map(lambda c: meta_map[c]["name_en"])
    struct["subregion"] = struct["province_code"].map(lambda c: meta_map[c]["subregion"])
    return struct.sort_values("province_code").reset_index(drop=True)
