"""Deep exploratory data analysis covering distributions, seasonality, thresholds, NSO shifts, and macro trends."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
import pandas as pd
import seaborn as sns
from scipy import stats

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from src.analytics.eda_feature_selection import STRUCTURAL_CANDIDATES, _compute_vif_map
from src.config.feature_registry import get_clustering_core_features, get_validation_policy
from src.db.connection import bulk_execute, fetch_all
from src.guardrails.schemas import get_province_metadata, resolve_northern_province
from src.transform.panel_builder import (
    build_monthly_analysis_panel,
    build_provincial_structural_profile,
)

BACKEND_DIR = Path(__file__).resolve().parents[2]
FIGURES_DIR = BACKEND_DIR / "reports" / "figures"

MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _cliffs_delta(x: np.ndarray, y: np.ndarray) -> float:
    """Compute nonparametric Cliffs delta effect size between two numeric arrays."""
    if len(x) == 0 or len(y) == 0:
        return 0.0
    diff = x[:, None] - y[None, :]
    greater = float(np.sum(diff > 0))
    less = float(np.sum(diff < 0))
    return (greater - less) / float(len(x) * len(y))


def audit_distributions_and_outliers(
    panel: pd.DataFrame,
    struct_df: pd.DataFrame,
) -> dict[str, Any]:
    """Compute distribution, skewness, zero share, IQR outlier fences, and log1p impact."""
    monthly_cols = [
        "occupancy_rate",
        "occupancy_deseason",
        "occupancy_yoy_diff",
        "revenue_total_mthb",
        "visitors_total",
        "pm25_mean",
        "pm25_days_over_37_5",
        "pm25_days_over_75_0",
        "pm25_excess",
        "rainfall_sum_mm",
        "heavy_rain_days",
        "rainfall_excess_mm",
        "th_cpi_yoy_pct",
        "oil_brent_yoy_pct",
        "usdthb_yoy_pct",
    ]
    monthly_audit: list[dict[str, Any]] = []
    for col in monthly_cols:
        if col not in panel.columns:
            continue
        s = panel[col].dropna()
        if s.empty:
            continue
        q1, med, q3 = np.percentile(s, [25, 50, 75])
        iqr = float(q3 - q1)
        upper_fence = q3 + 1.5 * iqr
        lower_fence = q1 - 1.5 * iqr
        outliers = s[(s > upper_fence) | (s < lower_fence)]
        skew_val = float(stats.skew(s))
        kurt_val = float(stats.kurtosis(s))
        zero_pct = float((s == 0).mean() * 100.0)
        monthly_audit.append(
            {
                "feature": col,
                "n": int(len(s)),
                "mean": round(float(s.mean()), 2),
                "median": round(float(med), 2),
                "std": round(float(s.std()), 2),
                "iqr": round(iqr, 2),
                "min": round(float(s.min()), 2),
                "p95": round(float(np.percentile(s, 95)), 2),
                "max": round(float(s.max()), 2),
                "skew": round(skew_val, 2),
                "kurtosis": round(kurt_val, 2),
                "zero_pct": round(zero_pct, 1),
                "iqr_outlier_pct": round(float(len(outliers) / len(s) * 100.0), 1),
            }
        )

    struct_cols = [c for c, _ in STRUCTURAL_CANDIDATES if c in struct_df.columns]
    struct_audit: list[dict[str, Any]] = []
    for col in struct_cols:
        sub = struct_df[["province_code", col]].dropna()
        s = sub[col]
        q1, med, q3 = np.percentile(s, [25, 50, 75])
        iqr = float(q3 - q1)
        upper_fence = q3 + 1.5 * iqr
        lower_fence = q1 - 1.5 * iqr
        out_provs = sub[(s > upper_fence) | (s < lower_fence)]["province_code"].tolist()
        skew_val = float(stats.skew(s))
        log_skew = float(stats.skew(np.log1p(np.clip(s, 0, None)))) if float(s.min()) >= 0 else None
        shapiro_p = float(stats.shapiro(s).pvalue) if len(s) >= 3 else 1.0
        rec = "log1p_or_robust" if abs(skew_val) >= 1.0 or len(out_provs) > 0 else "standard_or_robust"
        struct_audit.append(
            {
                "feature": col,
                "mean": round(float(s.mean()), 2),
                "median": round(float(med), 2),
                "min": round(float(s.min()), 2),
                "max": round(float(s.max()), 2),
                "max_to_min_ratio": round(float(s.max() / s.min()), 2) if float(s.min()) > 0 else None,
                "skew": round(skew_val, 2),
                "log1p_skew": round(log_skew, 2) if log_skew is not None else None,
                "shapiro_p": round(shapiro_p, 4),
                "outlier_provinces": out_provs,
                "scaling_advice": rec,
            }
        )

    # Compute revenue Pareto concentration across 17 northern provinces
    rev_rank = struct_df[["province_code", "name_en", "avg_monthly_revenue_mthb"]].sort_values(
        "avg_monthly_revenue_mthb", ascending=False
    )
    total_rev = float(rev_rank["avg_monthly_revenue_mthb"].sum())
    rev_rank["rev_share_pct"] = (rev_rank["avg_monthly_revenue_mthb"] / max(total_rev, 1e-9)) * 100.0
    rev_rank["cum_share_pct"] = rev_rank["rev_share_pct"].cumsum()

    return {
        "monthly_audit": monthly_audit,
        "structural_audit": struct_audit,
        "revenue_concentration": {
            "top1_code": str(rev_rank.iloc[0]["province_code"]),
            "top1_share_pct": round(float(rev_rank.iloc[0]["rev_share_pct"]), 1),
            "top3_codes": rev_rank.iloc[:3]["province_code"].tolist(),
            "top3_share_pct": round(float(rev_rank.iloc[2]["cum_share_pct"]), 1),
            "top5_share_pct": round(float(rev_rank.iloc[4]["cum_share_pct"]), 1),
            "bottom10_share_pct": round(float(100.0 - rev_rank.iloc[6]["cum_share_pct"]), 1),
            "ranking": rev_rank[["province_code", "avg_monthly_revenue_mthb", "rev_share_pct"]].round(2).to_dict(orient="records"),
        },
    }


def analyze_upper_vs_lower_north(
    panel: pd.DataFrame,
    struct_df: pd.DataFrame,
) -> dict[str, Any]:
    """Compare Upper North 9 provinces against Lower North 8 provinces with BH FDR adjusted Mann Whitney U tests."""
    test_cols = [
        "avg_occupancy_rate",
        "occupancy_volatility",
        "log_foreign_visitor_share",
        "avg_monthly_revenue_mthb",
        "annual_pm25_days_over_37_5",
        "annual_pm25_days_over_75_0",
        "max_monthly_rainfall_mm",
        "annual_heavy_rain_days",
        "debt_to_annual_income_all",
        "debt_to_annual_income_sme",
        "expense_to_income_pct_all",
        "expense_to_income_pct_sme",
    ]
    upper = struct_df[struct_df["subregion"] == "Upper North"]
    lower = struct_df[struct_df["subregion"] == "Lower North"]

    comparisons: list[dict[str, Any]] = []
    for col in test_cols:
        if col not in struct_df.columns:
            continue
        u_vals = upper[col].dropna().to_numpy(dtype=float)
        l_vals = lower[col].dropna().to_numpy(dtype=float)
        _, pval = stats.mannwhitneyu(u_vals, l_vals, alternative="two-sided")
        delta = _cliffs_delta(u_vals, l_vals)
        comparisons.append(
            {
                "feature": col,
                "upper_median": round(float(np.median(u_vals)), 2),
                "lower_median": round(float(np.median(l_vals)), 2),
                "upper_mean": round(float(np.mean(u_vals)), 2),
                "lower_mean": round(float(np.mean(l_vals)), 2),
                "mann_whitney_p": round(float(pval), 5),
                "cliffs_delta": round(float(delta), 3),
            }
        )

    # Apply Benjamini Hochberg FDR across all 12 subregion hypothesis tests
    if comparisons:
        raw_p = np.array([c["mann_whitney_p"] for c in comparisons], dtype=float)
        m_cnt = len(raw_p)
        order = np.argsort(raw_p)
        ranks = np.empty_like(order)
        ranks[order] = np.arange(1, m_cnt + 1)
        fdr = np.minimum(1.0, raw_p * (float(m_cnt) / ranks))
        fdr_sorted = np.minimum.accumulate(fdr[order][::-1])[::-1]
        q_vals = np.empty_like(fdr)
        q_vals[order] = np.round(fdr_sorted, 5)
        for item, qv in zip(comparisons, q_vals):
            item["mann_whitney_q_fdr"] = float(qv)
            item["significant_005"] = bool(qv < 0.05)

    # Compute regional monthly seasonal peaks for occupancy, PM2.5, and rainfall
    meta_map = get_province_metadata()
    p_sub = panel.copy()
    p_sub["subregion"] = p_sub["province_code"].map(lambda c: meta_map[c]["subregion"])
    cal_summary = (
        p_sub.groupby(["subregion", "cal_month"], as_index=False)
        .agg(
            occ_mean=("occupancy_rate", "mean"),
            pm25_mean=("pm25_mean", "mean"),
            rain_mean=("rainfall_sum_mm", "mean"),
        )
        .round(2)
    )

    return {
        "upper_vs_lower_tests": comparisons,
        "monthly_calendar_by_subregion": cal_summary.to_dict(orient="records"),
    }


def analyze_threshold_effects_and_crises(panel: pd.DataFrame) -> dict[str, Any]:
    """Quantify same metric regime impacts using train fitted thresholds, AR1 persistence, and crisis audits."""
    df = panel.sort_values(["province_code", "period_date"]).copy()
    meta_map = get_province_metadata()
    df["subregion"] = df["province_code"].map(lambda c: meta_map[c]["subregion"])

    # Fit rainfall excess thresholds strictly on chronological 75 percent train window to avoid full sample leakage
    policy = get_validation_policy()
    unique_months = np.sort(df["period_date"].unique())
    split_idx = max(12, int(len(unique_months) * float(policy["time_split_train_ratio"])))
    train_cutoff = unique_months[min(split_idx, len(unique_months) - 1)]
    train_df = df[df["period_date"] <= train_cutoff]
    if train_df.empty:
        train_df = df

    p75_rain = float(np.nanpercentile(train_df["rainfall_excess_mm"], 75))
    p95_rain = float(np.nanpercentile(train_df["rainfall_excess_mm"], 95))
    df["rain_regime"] = np.where(
        df["rainfall_excess_mm"] >= p95_rain,
        "Extreme (>=P95 Train)",
        np.where(df["rainfall_excess_mm"] >= p75_rain, "Elevated (P75 to P95)", "Normal (<P75)"),
    )
    rain_regimes: list[dict[str, Any]] = []
    for label in ["Normal (<P75)", "Elevated (P75 to P95)", "Extreme (>=P95 Train)"]:
        sub = df[df["rain_regime"] == label]
        rain_regimes.append(
            {
                "regime": label,
                "n_obs": int(len(sub)),
                "occ_deseason_mean": round(float(sub["occupancy_deseason"].mean()), 2),
                "occ_deseason_median": round(float(sub["occupancy_deseason"].median()), 2),
                "rev_deseason_mean": round(float(sub["revenue_deseason_pct"].mean()), 2),
                "rev_deseason_median": round(float(sub["revenue_deseason_pct"].median()), 2),
                "occ_yoy_mean": round(float(sub["occupancy_yoy_diff"].mean()), 2),
            }
        )

    # Regime 2 PM2.5 PCD operational buckets evaluated on the EXACT SAME occupancy_deseason metric
    df["pm25_regime"] = np.where(
        (df["pm25_days_over_75_0"] >= 1) | (df["pm25_mean"] > 50.0),
        "Severe Red (Days>75 or >50)",
        np.where(df["pm25_days_over_37_5"] >= 5, "Elevated Orange (>=5d >37.5)", "Normal (<5d >37.5)"),
    )
    pm_regimes: list[dict[str, Any]] = []
    for label in ["Normal (<5d >37.5)", "Elevated Orange (>=5d >37.5)", "Severe Red (Days>75 or >50)"]:
        sub = df[df["pm25_regime"] == label]
        pm_regimes.append(
            {
                "regime": label,
                "n_obs": int(len(sub)),
                "n_yoy_obs": int(sub["occupancy_yoy_diff"].notna().sum()),
                "occ_deseason_mean": round(float(sub["occupancy_deseason"].mean()), 2),
                "occ_deseason_median": round(float(sub["occupancy_deseason"].median()), 2),
                "occ_yoy_mean": round(float(sub["occupancy_yoy_diff"].mean()), 2),
                "rev_deseason_mean": round(float(sub["revenue_deseason_pct"].mean()), 2),
            }
        )

    # Exact 17 province impact during Sept 2024 flood and Mar Apr 2026 haze using unified occupancy_deseason
    flood_df = df[df["period_date"] == pd.Timestamp("2024-09-01")][
        [
            "province_code",
            "subregion",
            "occupancy_rate",
            "occupancy_deseason",
            "revenue_deseason_pct",
            "rainfall_sum_mm",
            "rainfall_excess_mm",
        ]
    ].sort_values("occupancy_deseason")

    haze_df = (
        df[df["period_date"].isin([pd.Timestamp("2026-03-01"), pd.Timestamp("2026-04-01")])]
        .groupby(["province_code", "subregion"], as_index=False)
        .agg(
            occupancy_rate=("occupancy_rate", "mean"),
            occupancy_deseason=("occupancy_deseason", "mean"),
            occupancy_yoy_diff=("occupancy_yoy_diff", "mean"),
            revenue_yoy_pct=("revenue_yoy_pct", "mean"),
            pm25_mean=("pm25_mean", "mean"),
            pm25_days_over_37_5=("pm25_days_over_37_5", "sum"),
            pm25_days_over_75_0=("pm25_days_over_75_0", "sum"),
        )
        .sort_values("occupancy_deseason")
    )

    # Within province AR1 autocorrelation justifies Liang Zeger province clustered standard errors
    ar1_stats: dict[str, float] = {}
    for col in ["occupancy_deseason", "revenue_deseason_pct", "occupancy_yoy_diff", "pm25_excess", "rainfall_excess_mm"]:
        lag1 = df.groupby("province_code", sort=False)[col].shift(1)
        pair = pd.DataFrame({"x": lag1, "y": df[col]}).dropna()
        if len(pair) >= 30:
            ar1_stats[col] = round(float(stats.pearsonr(pair["x"], pair["y"])[0]), 3)

    return {
        "train_threshold_cutoff": str(pd.Timestamp(train_cutoff).date()),
        "rain_p75_mm": round(p75_rain, 1),
        "rain_p95_mm": round(p95_rain, 1),
        "rain_regimes": rain_regimes,
        "pm25_regimes": pm_regimes,
        "regime_methodology_note": "Descriptive same metric regime means using train fitted thresholds; panel AR1 precludes iid Kruskal Wallis p value inference",
        "sept_2024_flood_17p": flood_df.round(2).to_dict(orient="records"),
        "mar_apr_2026_haze_17p": haze_df.round(2).to_dict(orient="records"),
        "within_province_ar1": ar1_stats,
    }


def analyze_nso_vulnerability_shift() -> pd.DataFrame:
    """Compare NSO 2023 against 2025 household and non farm SME debt and cash cushion across 17 provinces."""
    rows = fetch_all(
        """
        SELECT period_date, province_raw, metric_name, metric_value
        FROM bronze.provincial_stats_raw
        WHERE dataset_name = 'nso_household_finance'
        """
    )
    df = pd.DataFrame(rows)
    df["province_code"] = df["province_raw"].map(resolve_northern_province)
    df["year"] = pd.to_datetime(df["period_date"]).dt.year
    df["metric_value"] = pd.to_numeric(df["metric_value"], errors="coerce")

    wide = df.pivot_table(
        index=["province_code", "year"],
        columns="metric_name",
        values="metric_value",
        aggfunc="first",
    ).reset_index()

    wide["dti_all"] = wide["avg_household_debt_thb_all"] / (wide["monthly_income_thb_all"] * 12.0)
    wide["dti_sme"] = wide["avg_household_debt_thb_sme"] / (wide["monthly_income_thb_sme"] * 12.0)
    wide["cushion_all_pct"] = 100.0 - wide["expense_to_income_pct_all"]
    wide["cushion_sme_pct"] = 100.0 - wide["expense_to_income_pct_sme"]

    y23 = wide[wide["year"] == 2023].set_index("province_code")
    y25 = wide[wide["year"] == 2025].set_index("province_code")
    meta_map = get_province_metadata()

    out = pd.DataFrame(index=sorted(y25.index))
    out.index.name = "province_code"
    out["subregion"] = [meta_map[c]["subregion"] for c in out.index]
    out["dti_all_2023"] = y23["dti_all"]
    out["dti_all_2025"] = y25["dti_all"]
    out["dti_all_delta"] = out["dti_all_2025"] - out["dti_all_2023"]
    out["dti_sme_2023"] = y23["dti_sme"]
    out["dti_sme_2025"] = y25["dti_sme"]
    out["dti_sme_delta"] = out["dti_sme_2025"] - out["dti_sme_2023"]
    out["sme_vs_all_gap_2025"] = out["dti_sme_2025"] - out["dti_all_2025"]
    out["exp_inc_all_2025"] = y25["expense_to_income_pct_all"]
    out["exp_inc_sme_2025"] = y25["expense_to_income_pct_sme"]
    out["cushion_all_2025"] = y25["cushion_all_pct"]
    out["cushion_sme_2025"] = y25["cushion_sme_pct"]
    out["debt_sme_2025_thb"] = y25["avg_household_debt_thb_sme"]
    out["income_sme_2025_thb"] = y25["monthly_income_thb_sme"]
    return out.reset_index()


def compare_clustering_feature_sets(struct_df: pd.DataFrame) -> dict[str, Any]:
    """Compare candidate 17 province clustering feature sets on VIF, condition number, and PCA variance."""
    core_6 = list(get_clustering_core_features())
    sets = {
        "core_6_canonical": core_6,
        "core_7_with_sme_exp": [*core_6, "expense_to_income_pct_sme"],
        "core_6_sme_debt_alt": [
            "debt_to_annual_income_sme" if c == "debt_to_annual_income_all" else c for c in core_6
        ],
    }
    report: dict[str, Any] = {}
    for name, cols in sets.items():
        vifs = _compute_vif_map(struct_df, cols)
        x = struct_df[cols].to_numpy(dtype=float)
        x_std = (x - x.mean(axis=0)) / np.where(x.std(axis=0) == 0, 1.0, x.std(axis=0))
        svals = np.linalg.svd(x_std, compute_uv=False)
        eig = (svals**2) / np.sum(svals**2)
        cond_num = float(svals[0] / max(svals[-1], 1e-12))
        report[name] = {
            "n_features": len(cols),
            "n_to_p_ratio": round(17.0 / len(cols), 2),
            "max_vif": round(max(vifs.values()), 2),
            "vifs": vifs,
            "condition_number": round(cond_num, 2),
            "pc1_pc2_var_pct": round(float((eig[0] + eig[1]) * 100.0), 1),
            "pc1_pc3_var_pct": round(float(np.sum(eig[:3]) * 100.0), 1),
        }
    return report


def check_macro_collinearity(panel: pd.DataFrame) -> dict[str, Any]:
    """Audit macro control series collinearity and volatility across the 34 month window."""
    macro_cols = [
        "th_cpi_yoy_pct",
        "oil_brent_yoy_pct",
        "oil_dubai_yoy_pct",
        "usdthb_yoy_pct",
        "th_reer_yoy_pct",
        "thai_rice_usd_yoy_pct",
    ]
    avail = [c for c in macro_cols if c in panel.columns]
    m_df = panel.drop_duplicates(subset=["period_date"]).sort_values("period_date")[["period_date"] + avail]
    corr = m_df[avail].corr(method="spearman")
    high_pairs = []
    for i, c1 in enumerate(avail):
        for c2 in avail[i + 1 :]:
            val = float(corr.loc[c1, c2])
            if abs(val) >= 0.70:
                high_pairs.append({"pair": f"{c1} vs {c2}", "spearman_r": round(val, 3)})
    return {
        "n_months": int(len(m_df)),
        "high_collinear_pairs": high_pairs,
        "summary": m_df[avail].describe().loc[["mean", "std", "min", "max"]].round(2).to_dict(),
    }


def plot_deep_eda_figures(
    panel: pd.DataFrame,
    struct_df: pd.DataFrame,
    nso_shift: pd.DataFrame,
    threshold_res: dict[str, Any],
    subregion_res: dict[str, Any] | None = None,
) -> list[Path]:
    """Generate four 300 DPI methodologically sound deep EDA figures with clean non overlapping layouts."""
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid", context="notebook")
    saved: list[Path] = []
    navy = "#0F2537"
    teal = "#0D9488"
    amber = "#D97706"
    crimson = "#DC2626"
    slate = "#64748B"

    sub_q_map = {
        r["feature"]: (r.get("mann_whitney_q_fdr"), r.get("cliffs_delta"))
        for r in (subregion_res or {}).get("upper_vs_lower_tests", [])
    }

    # Figure 02a monthly distributions, stacked before vs after log1p proof, and FDR subregion boxplots
    fig = plt.figure(figsize=(18.4, 8.8), dpi=300)
    gs = fig.add_gridspec(2, 4, hspace=0.38, wspace=0.26)
    top_axes = [fig.add_subplot(gs[0, i]) for i in range(4)]

    # Row 1 monthly panel distributions
    m_specs = [
        ("occupancy_rate", "Monthly Occupancy Rate (%)", navy, None, None),
        ("occupancy_deseason", "Deseasonalized Occupancy (pp)", teal, 0.0, "Zero Baseline"),
        ("pm25_mean", "Monthly Mean PM2.5 (ug/m3)", amber, 37.5, "PCD 37.5 Orange"),
        ("rainfall_sum_mm", "Monthly Rainfall Sum (mm)", "#2563EB", None, None),
    ]
    for ax, (col, title, color, vline, vlabel) in zip(top_axes, m_specs):
        s = panel[col].dropna()
        sns.histplot(s, bins=24, kde=True, color=color, alpha=0.55, edgecolor="white", ax=ax)
        med = float(s.median())
        sk = float(stats.skew(s))
        ax.axvline(med, color=navy, linestyle="-", linewidth=1.3, label=f"Median {med:.1f}")
        if vline is not None:
            ax.axvline(vline, color=crimson, linestyle="--", linewidth=1.3, label=vlabel)
        ax.set_title(f"{title}\n(Skew = {sk:+.2f}, n = {len(s)})", fontsize=9.6, fontweight="bold", color=navy)
        ax.set_xlabel("")
        ax.legend(fontsize=7.6, loc="upper right", frameon=True)

    # Row 2 panel 0 stacked before vs after log1p histograms with separate honest X axes
    raw_f = struct_df["foreign_visitor_share"].dropna()
    log_f = struct_df["log_foreign_visitor_share"].dropna()
    raw_sk = float(stats.skew(raw_f))
    log_sk = float(stats.skew(log_f))
    sub_gs = gs[1, 0].subgridspec(2, 1, hspace=0.62)
    ax_raw = fig.add_subplot(sub_gs[0, 0])
    ax_log = fig.add_subplot(sub_gs[1, 0])
    sns.histplot(raw_f, bins=9, kde=True, color=crimson, alpha=0.55, edgecolor="white", ax=ax_raw)
    ax_raw.set_title(f"Before: Raw Foreign Share % (Skew {raw_sk:+.2f})", fontsize=8.8, fontweight="bold", color=crimson)
    ax_raw.set_xlabel("")
    ax_raw.set_ylabel("Prov", fontsize=8.0)
    sns.histplot(log_f, bins=9, kde=True, color=teal, alpha=0.55, edgecolor="white", ax=ax_log)
    ax_log.set_title(f"After: log1p Foreign Share (Skew {log_sk:+.2f})", fontsize=8.8, fontweight="bold", color=teal)
    ax_log.set_xlabel("log1p(Foreign Share %)", fontsize=8.2)
    ax_log.set_ylabel("Prov", fontsize=8.0)

    # Row 2 panels 1..3 Upper vs Lower North boxplots annotated with BH FDR q and Cliffs delta
    bot_axes = [fig.add_subplot(gs[1, i]) for i in range(1, 4)]
    s_specs = [
        ("log_foreign_visitor_share", "log1p Foreign Visitor Share"),
        ("annual_pm25_days_over_37_5", "Annual PM2.5 Days > 37.5"),
        ("debt_to_annual_income_all", "Household Debt/Annual Income (2025)"),
    ]
    palette = {"Upper North": navy, "Lower North": teal}
    for ax, (col, title) in zip(bot_axes, s_specs):
        sns.boxplot(
            data=struct_df,
            x="subregion",
            y=col,
            hue="subregion",
            palette=palette,
            width=0.45,
            showfliers=False,
            boxprops={"alpha": 0.30},
            legend=False,
            ax=ax,
        )
        rng = np.random.default_rng(42)
        for idx_sub, sub_name in enumerate(["Upper North", "Lower North"]):
            sub = struct_df[struct_df["subregion"] == sub_name].sort_values(col, ascending=False)
            jitter = rng.uniform(-0.10, 0.10, size=len(sub))
            ax.scatter(
                np.full(len(sub), idx_sub) + jitter,
                sub[col],
                color=palette[sub_name],
                s=42,
                zorder=4,
                edgecolor="white",
                linewidth=0.6,
            )
            to_tag = pd.concat([sub.head(2), sub.tail(1)]).drop_duplicates(subset=["province_code"])
            offsets = [(8, 2), (8, -8), (8, 1)]
            for row_i, (_, r) in enumerate(to_tag.iterrows()):
                pos_idx = sub.index.get_loc(r.name)
                x_pt = idx_sub + jitter[pos_idx]
                dx, dy = offsets[row_i % len(offsets)]
                ax.annotate(
                    r["province_code"],
                    (x_pt, r[col]),
                    xytext=(dx, dy),
                    textcoords="offset points",
                    fontsize=7.8,
                    fontweight="bold",
                    color=navy,
                )
        ax.set_xlim(-0.52, 1.55)
        qv, dv = sub_q_map.get(col, (None, None))
        stat_tag = f"FDR q={qv:.3f}, delta={dv:+.2f}" if qv is not None else f"Skew={float(stats.skew(struct_df[col].dropna())):+.2f}"
        ax.set_title(f"{title}\n({stat_tag})", fontsize=9.4, fontweight="bold", color=navy)
        ax.set_xlabel("")
        ax.set_ylabel("")

    fig.suptitle(
        "Deep EDA Part 1 Distributions, log1p Skewness Reduction, and FDR Adjusted Subregion Audit",
        fontsize=13,
        fontweight="bold",
        color=navy,
        y=0.98,
    )
    p1 = FIGURES_DIR / "02a_distributions_and_outliers.png"
    fig.savefig(p1, dpi=300, bbox_inches="tight")
    plt.close(fig)
    saved.append(p1)

    # Figure 02b 12 month seasonality heatmaps plus AR(1) autocorrelation justification for Clustered SE
    meta_map = get_province_metadata()
    upper_codes = sorted([c for c, m in meta_map.items() if m["subregion"] == "Upper North"])
    lower_codes = sorted([c for c, m in meta_map.items() if m["subregion"] == "Lower North"])
    prov_order = upper_codes + lower_codes

    fig, axes = plt.subplots(1, 4, figsize=(21.5, 6.8), dpi=300, gridspec_kw={"width_ratios": [1.0, 1.0, 1.0, 0.85]})
    heat_specs = [
        ("occupancy_rate", "A. Occupancy Rate (%)", "YlGnBu", 30, 95),
        ("pm25_mean", "B. Monthly Mean PM2.5 (ug/m3)", "YlOrRd", 5, 75),
        ("rainfall_sum_mm", "C. Monthly Rainfall (mm)", "Blues", 0, 380),
    ]
    for ax, (col, title, cmap, vmin, vmax) in zip(axes[:3], heat_specs):
        piv = (
            panel.pivot_table(index="province_code", columns="cal_month", values=col, aggfunc="mean")
            .reindex(index=prov_order, columns=range(1, 13))
        )
        piv.columns = MONTH_LABELS
        sns.heatmap(
            piv,
            cmap=cmap,
            vmin=vmin,
            vmax=vmax,
            linewidths=0.4,
            linecolor="white",
            annot=False,
            cbar_kws={"shrink": 0.82},
            ax=ax,
        )
        ax.axhline(len(upper_codes), color=navy, linewidth=2.2)
        ax.set_title(title, fontsize=10.6, fontweight="bold", color=navy, pad=10)
        y_title = f"Upper North (Top {len(upper_codes)}) | Lower North (Bottom {len(lower_codes)})"
        ax.set_ylabel(y_title if ax is axes[0] else "")
        ax.set_xlabel("Calendar Month")

    # Panel D within province AR(1) persistence proving why clustered SE is mandatory
    ar1_map = threshold_res.get("within_province_ar1", {})
    if ar1_map:
        ar_items = sorted(ar1_map.items(), key=lambda kv: kv[1])
        ar_labels = [k for k, _ in ar_items]
        ar_vals = [v for _, v in ar_items]
        ar_colors = [crimson if abs(v) >= 0.30 else teal for v in ar_vals]
        axes[3].barh(ar_labels, ar_vals, color=ar_colors, height=0.52)
        axes[3].axvline(0.0, color=navy, linewidth=1.0)
        axes[3].axvline(0.30, color=amber, linestyle="--", linewidth=1.2, label="AR(1) >= 0.30")
        for idx, val in enumerate(ar_vals):
            axes[3].text(val + (0.02 if val >= 0 else -0.02), idx, f"{val:+.2f}", va="center", ha="left" if val >= 0 else "right", fontsize=8.5, fontweight="bold")
        axes[3].set_xlim(-0.25, 0.85)
        axes[3].set_xlabel("Lag-1 Within-Province Autocorrelation")
        axes[3].set_title("D. Panel AR(1) Persistence\n(Proves Need for Clustered SE)", fontsize=10.4, fontweight="bold", color=navy, pad=10)
        axes[3].legend(loc="lower right", fontsize=8.0, frameon=True)

    fig.suptitle(
        "Deep EDA Part 2 Seasonality Calendar and Panel Autocorrelation Audit Across 17 Provinces",
        fontsize=13,
        fontweight="bold",
        color=navy,
        y=1.01,
    )
    plt.tight_layout()
    p2 = FIGURES_DIR / "02b_seasonality_and_north_asymmetry.png"
    fig.savefig(p2, dpi=300, bbox_inches="tight")
    plt.close(fig)
    saved.append(p2)

    # Figure 02c same metric regime means, same metric crisis comparison, NSO 2023 to 2025 shift, compound risk
    fig, axes = plt.subplots(2, 2, figsize=(16.5, 11.2), dpi=300)

    # Panel A same metric descriptive regime means using train fitted rainfall thresholds and PCD PM2.5 rules
    rain_df = pd.DataFrame(threshold_res["rain_regimes"])
    pm_df = pd.DataFrame(threshold_res["pm25_regimes"])
    x_pos = np.arange(3)
    width = 0.35
    b1 = axes[0, 0].bar(
        x_pos - width / 2,
        rain_df["occ_deseason_mean"],
        width=width,
        color="#2563EB",
        label=f"Rain Excess Regimes (Train P75/P95 <= {threshold_res.get('train_threshold_cutoff', '')})",
    )
    b2 = axes[0, 0].bar(
        x_pos + width / 2,
        pm_df["occ_deseason_mean"],
        width=width,
        color=amber,
        label="PM2.5 PCD Regimes (Same Deseasonalized Occ Metric)",
    )
    axes[0, 0].axhline(0.0, color=navy, linewidth=1.0)
    for bars, n_list in ((b1, rain_df["n_obs"].tolist()), (b2, pm_df["n_obs"].tolist())):
        for bar, n_val in zip(bars, n_list):
            h = bar.get_height()
            va = "bottom" if h >= 0 else "top"
            offset = 0.08 if h >= 0 else -0.10
            axes[0, 0].text(
                bar.get_x() + bar.get_width() / 2.0,
                h + offset,
                f"{h:+.2f}\n(n={int(n_val)})",
                ha="center",
                va=va,
                fontsize=7.9,
                fontweight="bold",
                color=navy,
            )
    axes[0, 0].set_xticks(x_pos)
    axes[0, 0].set_xticklabels(["Normal Regime", "Elevated Regime", "Extreme / Red Regime"], fontsize=9.5)
    axes[0, 0].set_ylabel("Mean Deseasonalized Occupancy Impact (pp)")
    axes[0, 0].set_title(
        "A. Descriptive Regime Comparison on Unified Deseasonalized Metric\n(Train-Fitted Rain Cutoffs · No Cross-Metric Mixing)",
        fontsize=10.4,
        fontweight="bold",
        color=navy,
    )
    min_y = min(float(rain_df["occ_deseason_mean"].min()), float(pm_df["occ_deseason_mean"].min()))
    max_y = max(float(rain_df["occ_deseason_mean"].max()), float(pm_df["occ_deseason_mean"].max()))
    axes[0, 0].set_ylim(min_y - 1.4, max(max_y + 1.4, 2.0))
    axes[0, 0].legend(loc="lower left", fontsize=7.9, frameon=True)

    # Panel B all 17 provinces real crisis impact Sept 2024 flood vs Mar Apr 2026 haze on UNIFIED occupancy_deseason
    f_map = {r["province_code"]: r["occupancy_deseason"] for r in threshold_res["sept_2024_flood_17p"]}
    h_map = {r["province_code"]: r["occupancy_deseason"] for r in threshold_res["mar_apr_2026_haze_17p"]}
    crisis_df = pd.DataFrame(
        {
            "province_code": prov_order,
            "flood_2024": [f_map.get(c, 0.0) for c in prov_order],
            "haze_2026": [h_map.get(c, 0.0) for c in prov_order],
        }
    )
    crisis_df["worst"] = crisis_df[["flood_2024", "haze_2026"]].min(axis=1)
    crisis_df = crisis_df.sort_values("worst", ascending=True)
    y_pos = np.arange(len(crisis_df))
    h_bar = 0.38
    axes[0, 1].barh(y_pos - h_bar / 2, crisis_df["flood_2024"], height=h_bar, color=crimson, alpha=0.85, label="Sept 2024 Flood (Deseason Occ pp)")
    axes[0, 1].barh(y_pos + h_bar / 2, crisis_df["haze_2026"], height=h_bar, color=amber, alpha=0.88, label="Mar Apr 2026 Haze (Deseason Occ pp)")
    axes[0, 1].axvline(0.0, color=navy, linewidth=1.0)
    axes[0, 1].set_yticks(y_pos)
    axes[0, 1].set_yticklabels(crisis_df["province_code"], fontsize=8.8, fontweight="bold")
    axes[0, 1].set_xlabel("Deseasonalized Occupancy Deviation (percentage points)")
    axes[0, 1].set_title(
        "B. Heterogeneous Real Crisis Impact Across All 17 Provinces\n(Same Deseasonalized Metric -> Targeted Provincial Relief)",
        fontsize=10.4,
        fontweight="bold",
        color=navy,
    )
    axes[0, 1].legend(loc="upper left", fontsize=8.2, frameon=True)

    # Panel C NSO 2023 to 2025 Non farm SME debt to annual income dumbbell shift
    nso_plot = nso_shift.sort_values("dti_sme_2025", ascending=True).reset_index(drop=True)
    y_n = np.arange(len(nso_plot))
    for i, r in nso_plot.iterrows():
        line_c = crimson if r["dti_sme_delta"] > 0 else teal
        axes[1, 0].plot([r["dti_sme_2023"], r["dti_sme_2025"]], [i, i], color=line_c, linewidth=2.0, alpha=0.8)
    axes[1, 0].scatter(nso_plot["dti_sme_2023"], y_n, color=slate, s=42, zorder=4, label="NSO 2023 SME Debt/Income")
    axes[1, 0].scatter(nso_plot["dti_sme_2025"], y_n, color=navy, s=52, zorder=5, label="NSO 2025 SME Debt/Income")
    axes[1, 0].axvline(1.0, color=amber, linestyle="--", linewidth=1.1, label="1.0x Annual Income Mark")
    axes[1, 0].set_yticks(y_n)
    axes[1, 0].set_yticklabels(nso_plot["province_code"], fontsize=8.8, fontweight="bold")
    axes[1, 0].set_xlabel("Non Farm SME Debt to Annual Income Ratio (x)")
    axes[1, 0].set_title(
        "C. NSO Non Farm SME Leverage Shift 2023 to 2025\n(Red Line = Rising Leverage, Teal Line = Deleveraging)",
        fontsize=10.6,
        fontweight="bold",
        color=navy,
    )
    axes[1, 0].legend(loc="lower right", fontsize=8.2, frameon=True)

    # Panel D compound risk map chronic PM2.5 exposure vs 2025 household debt and cash cushion
    merged = struct_df.merge(
        nso_shift[["province_code", "cushion_all_2025", "dti_all_2025", "dti_sme_2025"]],
        on="province_code",
        how="left",
    )
    sc = axes[1, 1].scatter(
        merged["annual_pm25_days_over_37_5"],
        merged["dti_all_2025"],
        s=np.clip(np.sqrt(merged["avg_monthly_revenue_mthb"]) * 12.0, 45, 420),
        c=merged["expense_to_income_pct_all"],
        cmap="RdYlGn_r",
        vmin=65,
        vmax=95,
        alpha=0.88,
        edgecolor=navy,
        linewidth=0.8,
        zorder=4,
    )
    axes[1, 1].axvline(float(merged["annual_pm25_days_over_37_5"].median()), color=slate, linestyle="--", linewidth=1.0)
    axes[1, 1].axhline(float(merged["dti_all_2025"].median()), color=slate, linestyle="--", linewidth=1.0)
    for _, r in merged.iterrows():
        rad_pad = 10 if r["province_code"] in {"CM", "CR"} else 6
        axes[1, 1].annotate(
            r["province_code"],
            (r["annual_pm25_days_over_37_5"], r["dti_all_2025"]),
            xytext=(rad_pad, 4),
            textcoords="offset points",
            fontsize=8.3,
            fontweight="bold",
            color=navy,
        )
    axes[1, 1].set_xlim(12.0, 51.0)
    axes[1, 1].set_ylim(0.05, 1.15)
    cbar = fig.colorbar(sc, ax=axes[1, 1], shrink=0.85)
    cbar.set_label("Expense to Income Ratio (%)")
    axes[1, 1].set_xlabel("Annual PM2.5 Days Above 37.5 ug/m3 (3Y Annualized)")
    axes[1, 1].set_ylabel("All Household Debt to Annual Income Ratio (2025)")
    axes[1, 1].set_title(
        "D. Compound Vulnerability Chronic Haze vs Debt and Cash Buffer\n(Bubble Size = Tourism Revenue, Color = Expense/Income)",
        fontsize=10.6,
        fontweight="bold",
        color=navy,
    )

    fig.suptitle(
        "Deep EDA Part 3 Unified Crisis Impact and NSO Financial Vulnerability Across 17 Provinces",
        fontsize=13,
        fontweight="bold",
        color=navy,
        y=1.005,
    )
    plt.tight_layout()
    p3 = FIGURES_DIR / "02c_crisis_thresholds_and_nso_vulnerability.png"
    fig.savefig(p3, dpi=300, bbox_inches="tight")
    plt.close(fig)
    saved.append(p3)

    # Figure 02d structural Spearman correlation heatmap and 4 honest Small Multiples macro tracks (zero dual axis)
    fig = plt.figure(figsize=(18.5, 7.6), dpi=300)
    outer = fig.add_gridspec(1, 2, width_ratios=[1.18, 1.0], wspace=0.22)
    ax_corr = fig.add_subplot(outer[0])

    s_cols = [c for c, _ in STRUCTURAL_CANDIDATES if c in struct_df.columns]
    corr_mat = struct_df[s_cols].corr(method="spearman")
    short_labels = {
        "avg_occupancy_rate": "Avg Occ %",
        "occupancy_volatility": "Occ Vol",
        "log_foreign_visitor_share": "log1p Foreign",
        "foreign_revenue_share": "Foreign Rev %",
        "avg_monthly_revenue_mthb": "Monthly Rev",
        "pm25_mean_3y": "PM2.5 Mean",
        "pm25_p90_3y": "PM2.5 P90",
        "annual_pm25_days_over_37_5": "PM2.5 >37.5d",
        "annual_heavy_rain_days": "Heavy Rain d",
        "max_monthly_rainfall_mm": "Max Rain mm",
        "debt_to_annual_income_all": "Debt/Inc All",
        "debt_to_annual_income_sme": "Debt/Inc SME",
        "expense_to_income_pct_all": "Exp/Inc All",
        "expense_to_income_pct_sme": "Exp/Inc SME",
    }
    corr_disp = corr_mat.rename(index=short_labels, columns=short_labels)
    mask = np.triu(np.ones_like(corr_disp, dtype=bool), k=1)
    sns.heatmap(
        corr_disp,
        mask=mask,
        annot=True,
        fmt=".2f",
        annot_kws={"size": 7.5},
        cmap="RdBu_r",
        center=0.0,
        vmin=-1.0,
        vmax=1.0,
        linewidths=0.4,
        ax=ax_corr,
        cbar_kws={"shrink": 0.82, "label": "Spearman r"},
    )
    ax_corr.set_title(
        "A. 14x14 Structural Spearman Matrix (n = 17, log1p Foreign)\n(Visual Proof for |r|<0.85 Pruning & Canonical Core 6)",
        fontsize=10.6,
        fontweight="bold",
        color=navy,
    )

    # Right half 4 vertically stacked Small Multiples sharing time axis with independent honest Y axes
    macro_ts = (
        panel.groupby("period_date", as_index=False)
        .agg(
            north_occ_yoy=("occupancy_yoy_diff", "mean"),
            th_cpi_yoy=("th_cpi_yoy_pct", "first"),
            oil_brent_yoy=("oil_brent_yoy_pct", "first"),
            usdthb_yoy=("usdthb_yoy_pct", "first"),
        )
        .sort_values("period_date")
    )
    inner = outer[1].subgridspec(4, 1, hspace=0.28)
    tracks = [
        ("north_occ_yoy", "North 17P Avg Occupancy YoY (pp)", navy, "s"),
        ("th_cpi_yoy", "Thailand Headline CPI YoY (%)", crimson, "o"),
        ("oil_brent_yoy", "Brent Crude Oil YoY (%)", amber, "^"),
        ("usdthb_yoy", "USD / THB Exchange Rate YoY (%)", teal, "d"),
    ]
    shared_ax = None
    for idx_t, (col, label_t, color_t, mk) in enumerate(tracks):
        ax_m = fig.add_subplot(inner[idx_t], sharex=shared_ax)
        if shared_ax is None:
            shared_ax = ax_m
        ax_m.axhline(0.0, color=slate, linewidth=0.85, linestyle=":")
        ax_m.plot(macro_ts["period_date"], macro_ts[col], color=color_t, linewidth=1.8, marker=mk, markersize=2.8)
        ax_m.set_ylabel(label_t.split("(")[-1].rstrip(")"), fontsize=8.0, color=color_t, fontweight="bold")
        ax_m.set_title(label_t, loc="left", fontsize=9.0, fontweight="bold", color=navy, pad=3)
        if idx_t == 0:
            ax_m.text(
                1.0,
                1.18,
                "B. Macro Controls & Regional Occupancy (Small Multiples · No Dual-Axis Distortion)",
                transform=ax_m.transAxes,
                ha="right",
                fontsize=9.6,
                fontweight="bold",
                color=navy,
            )
        if idx_t < len(tracks) - 1:
            plt.setp(ax_m.get_xticklabels(), visible=False)
        else:
            ax_m.tick_params(axis="x", rotation=25, labelsize=8.3)

    fig.suptitle(
        "Deep EDA Part 4 Structural Collinearity Audit and Honest Small Multiples Macro Context",
        fontsize=13,
        fontweight="bold",
        color=navy,
        y=0.99,
    )
    p4 = FIGURES_DIR / "02d_structural_corr_and_macro_trends.png"
    fig.savefig(p4, dpi=300, bbox_inches="tight")
    plt.close(fig)
    saved.append(p4)

    return saved


def run_deep_eda() -> dict[str, Any]:
    """Execute complete deep EDA audit, generate 300 DPI insight figures, and log summary to Neon."""
    panel = build_monthly_analysis_panel()
    struct_df = build_provincial_structural_profile(panel)
    nso_shift = analyze_nso_vulnerability_shift()

    dist_res = audit_distributions_and_outliers(panel, struct_df)
    subregion_res = analyze_upper_vs_lower_north(panel, struct_df)
    threshold_res = analyze_threshold_effects_and_crises(panel)
    cluster_set_res = compare_clustering_feature_sets(struct_df)
    macro_res = check_macro_collinearity(panel)
    figures = plot_deep_eda_figures(panel, struct_df, nso_shift, threshold_res, subregion_res=subregion_res)

    summary_payload = {
        "revenue_concentration": dist_res["revenue_concentration"],
        "upper_vs_lower_sig_features_fdr": [
            r["feature"] for r in subregion_res["upper_vs_lower_tests"] if r.get("significant_005")
        ],
        "train_threshold_cutoff": threshold_res["train_threshold_cutoff"],
        "within_province_ar1": threshold_res["within_province_ar1"],
        "clustering_feature_sets": cluster_set_res,
        "macro_collinearity": macro_res["high_collinear_pairs"],
    }

    bulk_execute(
        """
        INSERT INTO gold.pipeline_eval_runs (run_type, metrics_json, token_count, estimated_cost_thb)
        VALUES (:run_type, CAST(:metrics_json AS JSONB), 0, 0.0)
        """,
        [
            {
                "run_type": "eda_deep_insights",
                "metrics_json": json.dumps(summary_payload, ensure_ascii=False),
            }
        ],
    )

    return {
        "distributions": dist_res,
        "subregion": subregion_res,
        "thresholds_and_crises": threshold_res,
        "nso_shift": nso_shift.round(3).to_dict(orient="records"),
        "clustering_sets": cluster_set_res,
        "macro_audit": macro_res,
        "figures": [str(p) for p in figures],
    }
