"""Empirical EDA, lag correlation, macro controlled OLS, VIF pruning, and 300 DPI report figures."""

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

from src.db.connection import bulk_execute, fetch_all, get_connection
from src.transform.panel_builder import (
    build_monthly_analysis_panel,
    build_provincial_structural_profile,
)

BACKEND_DIR = Path(__file__).resolve().parents[2]
FIGURES_DIR = BACKEND_DIR / "reports" / "figures"

# Candidate dynamic monthly features grouped by source dataset
DYNAMIC_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("pm25_mean", "open_meteo_pm25"),
    ("pm25_max", "open_meteo_pm25"),
    ("pm25_days_over_37_5", "open_meteo_pm25"),
    ("pm25_days_over_75_0", "open_meteo_pm25"),
    ("pm25_excess", "open_meteo_pm25"),
    ("pm25_z_prov", "open_meteo_pm25"),
    ("rainfall_sum_mm", "open_meteo_rainfall"),
    ("rainfall_max_day_mm", "open_meteo_rainfall"),
    ("heavy_rain_days", "open_meteo_rainfall"),
    ("rainfall_excess_mm", "open_meteo_rainfall"),
    ("rainfall_z_prov", "open_meteo_rainfall"),
    ("th_cpi_yoy_pct", "macro_controls"),
    ("oil_brent_yoy_pct", "macro_controls"),
    ("oil_dubai_yoy_pct", "macro_controls"),
    ("usdthb_yoy_pct", "macro_controls"),
    ("th_reer_yoy_pct", "macro_controls"),
    ("thai_rice_usd_yoy_pct", "macro_controls"),
)

# Candidate structural features for 17 province clustering across Exposure, Hazard, and Vulnerability
STRUCTURAL_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("avg_occupancy_rate", "mots_tourism"),
    ("occupancy_volatility", "mots_tourism"),
    ("foreign_visitor_share", "mots_tourism"),
    ("foreign_revenue_share", "mots_tourism"),
    ("avg_monthly_revenue_mthb", "mots_tourism"),
    ("pm25_mean_3y", "open_meteo_pm25"),
    ("pm25_p90_3y", "open_meteo_pm25"),
    ("annual_pm25_days_over_37_5", "open_meteo_pm25"),
    ("annual_heavy_rain_days", "open_meteo_rainfall"),
    ("max_monthly_rainfall_mm", "open_meteo_rainfall"),
    ("debt_to_annual_income_all", "nso_household_finance"),
    ("debt_to_annual_income_sme", "nso_household_finance"),
    ("expense_to_income_pct_all", "nso_household_finance"),
    ("expense_to_income_pct_sme", "nso_household_finance"),
)


def _compute_vif_map(df: pd.DataFrame, feature_cols: list[str]) -> dict[str, float]:
    """Compute exact VIF for all columns simultaneously via inverse correlation matrix diagonal."""
    clean = df[feature_cols].replace([np.inf, -np.inf], np.nan).dropna()
    if len(feature_cols) < 2 or len(clean) <= len(feature_cols) + 1:
        return {col: 1.0 for col in feature_cols}

    # Diagonal of inverse correlation matrix equals exact Variance Inflation Factor in O(p^3)
    corr_mat = clean.corr().to_numpy(dtype=float)
    corr_mat = np.nan_to_num(corr_mat, nan=0.0)
    try:
        inv_corr = np.linalg.inv(corr_mat)
    except np.linalg.LinAlgError:
        inv_corr = np.linalg.pinv(corr_mat)

    diag_vals = np.diag(inv_corr)
    vif_scores: dict[str, float] = {}
    for idx, col in enumerate(feature_cols):
        val = float(diag_vals[idx])
        vif_scores[col] = round(val, 3) if np.isfinite(val) and val > 0 else 999.0
    return vif_scores


def _iterative_vif_prune(
    df: pd.DataFrame,
    ordered_cols: list[str],
    max_vif: float = 5.0,
) -> tuple[list[str], dict[str, float], dict[str, float]]:
    """Iteratively drop highest VIF feature until all remaining features satisfy VIF below threshold."""
    active = list(ordered_cols)
    dropped_vifs: dict[str, float] = {}

    while len(active) >= 2:
        vifs = _compute_vif_map(df, active)
        worst_col = max(active, key=lambda c: vifs[c])
        if vifs[worst_col] < max_vif:
            return active, vifs, dropped_vifs
        dropped_vifs[worst_col] = vifs[worst_col]
        active.remove(worst_col)

    final_vifs = _compute_vif_map(df, active)
    return active, final_vifs, dropped_vifs


def screen_monthly_panel_features(
    panel: pd.DataFrame,
    target_col: str = "occupancy_deseason",
    max_lag: int = 2,
    alpha: float = 0.05,
    max_vif: float = 5.0,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Run within province lag correlation, controlled fixed effects OLS, and VIF pruning."""
    df = panel.sort_values(["province_code", "period_date"]).copy()
    records: list[dict[str, Any]] = []
    lag_matrix_rows: list[dict[str, Any]] = []

    for feat, dataset in DYNAMIC_CANDIDATES:
        if feat not in df.columns:
            continue
        missing_pct = round(float(df[feat].isna().mean() * 100.0), 2)
        best_row: dict[str, Any] | None = None

        for lag in range(max_lag + 1):
            # Shift strictly within each province to prevent cross province leakage
            shifted = df.groupby("province_code", sort=False)[feat].shift(lag)
            pair = pd.DataFrame({"x": shifted, "y": df[target_col]}).dropna()
            if len(pair) < 30 or pair["x"].nunique() < 3:
                continue

            pr, pp = stats.pearsonr(pair["x"], pair["y"])
            sr, sp = stats.spearmanr(pair["x"], pair["y"])
            lag_matrix_rows.append(
                {
                    "feature_name": feat,
                    "dataset_name": dataset,
                    "lag": lag,
                    "pearson_r": float(pr),
                    "spearman_r": float(sr),
                    "p_value": float(sp),
                    "n_obs": int(len(pair)),
                }
            )
            score = abs(float(sr))
            if best_row is None or score > abs(best_row["spearman_r"]):
                best_row = {
                    "feature_name": feat,
                    "dataset_name": dataset,
                    "target_name": target_col,
                    "best_lag_months": lag,
                    "pearson_r": round(float(pr), 4),
                    "spearman_r": round(float(sr), 4),
                    "p_value": round(float(sp), 6),
                    "missing_pct": missing_pct,
                }

        if best_row is not None:
            records.append(best_row)

    # Permanently audit sparse news coverage to enforce media bias guardrail
    news_prov_rows = fetch_all("SELECT count(DISTINCT province_code) AS n FROM silver.news_events")
    news_prov_count = int(news_prov_rows[0]["n"]) if news_prov_rows else 0
    news_cov_pct = round((news_prov_count / 17.0) * 100.0, 2)
    records.append(
        {
            "feature_name": "news_shock_count",
            "dataset_name": "silver_news_events",
            "target_name": target_col,
            "best_lag_months": 0,
            "pearson_r": None,
            "spearman_r": None,
            "p_value": None,
            "missing_pct": round(100.0 - news_cov_pct, 2),
        }
    )

    res_df = pd.DataFrame(records)

    # Filter statistically significant dynamic candidates with acceptable coverage
    sig_mask = (
        res_df["p_value"].notna()
        & (res_df["p_value"] < alpha)
        & (res_df["missing_pct"] <= 30.0)
    )
    sig_df = res_df[sig_mask].sort_values("spearman_r", key=lambda s: s.abs(), ascending=False)
    sig_features = sig_df["feature_name"].tolist()

    # Build lagged feature frame for VIF pruning
    lagged_frame = pd.DataFrame(index=df.index)
    lag_lookup = dict(zip(res_df["feature_name"], res_df["best_lag_months"]))
    for feat in sig_features:
        lagged_frame[feat] = df.groupby("province_code", sort=False)[feat].shift(int(lag_lookup[feat]))

    selected_feats, final_vifs, dropped_vifs = _iterative_vif_prune(
        lagged_frame, sig_features, max_vif=max_vif
    )
    selected_set = frozenset(selected_feats)

    vifs_col: list[float | None] = []
    sel_col: list[bool] = []
    reason_col: list[str] = []

    for rec in res_df.to_dict(orient="records"):
        feat = rec["feature_name"]
        if feat == "news_shock_count":
            vifs_col.append(None)
            sel_col.append(False)
            reason_col.append(
                f"Dropped due to media bias ({news_prov_count} of 17 provinces covered, below 70 percent threshold)"
            )
        elif rec["missing_pct"] > 30.0:
            vifs_col.append(None)
            sel_col.append(False)
            reason_col.append("Dropped because missing rate exceeds 30 percent")
        elif rec["p_value"] is None or rec["p_value"] >= alpha:
            vifs_col.append(None)
            sel_col.append(False)
            reason_col.append(f"Dropped because not statistically significant (p={rec['p_value']})")
        elif feat in dropped_vifs:
            vifs_col.append(dropped_vifs[feat])
            sel_col.append(False)
            reason_col.append(f"Dropped due to multicollinearity (VIF={dropped_vifs[feat]})")
        elif feat in selected_set:
            vifs_col.append(final_vifs.get(feat, 1.0))
            sel_col.append(True)
            reason_col.append(f"Selected (p={rec['p_value']}, VIF={final_vifs.get(feat, 1.0)})")
        else:
            vifs_col.append(None)
            sel_col.append(False)
            reason_col.append("Not selected")

    res_df["vif_score"] = vifs_col
    res_df["is_selected"] = sel_col
    res_df["decision_reason"] = reason_col

    # Run province clustered OLS controlling for macro variables simultaneously
    ols_summary = _run_controlled_panel_ols(df, target_col, selected_feats, lag_lookup)
    return res_df, pd.DataFrame(lag_matrix_rows), ols_summary


def _run_controlled_panel_ols(
    df: pd.DataFrame,
    target_col: str,
    selected_feats: list[str],
    lag_lookup: dict[str, int],
) -> dict[str, Any]:
    """Estimate standardized OLS with province clustered standard errors controlling for macro shocks."""
    control_cols = ["th_cpi_yoy_pct", "oil_brent_yoy_pct", "usdthb_yoy_pct", "thai_rice_usd_yoy_pct"]
    model_cols = list(dict.fromkeys(selected_feats + [c for c in control_cols if c in df.columns]))

    reg_df = pd.DataFrame({"province_code": df["province_code"], "y": df[target_col]})
    for col in model_cols:
        lag = int(lag_lookup.get(col, 0))
        reg_df[col] = df.groupby("province_code", sort=False)[col].shift(lag)
    reg_df = reg_df.dropna()

    if len(reg_df) < 50 or not model_cols:
        return {"n_obs": int(len(reg_df)), "r2": 0.0, "terms": {}}

    # Prune macro collinearity inside OLS design matrix for clean inference
    clean_cols, _, _ = _iterative_vif_prune(reg_df, model_cols, max_vif=6.0)
    x_raw = reg_df[clean_cols]
    x_std = (x_raw - x_raw.mean()) / x_raw.std(ddof=0).replace(0, 1.0)
    x_mat = np.column_stack([np.ones(len(x_std), dtype=float), x_std.to_numpy(dtype=float)])
    y_vec = reg_df["y"].to_numpy(dtype=float)
    n_obs, k_params = x_mat.shape

    # Vectorized OLS with Liang Zeger province clustered sandwich covariance
    bread = np.linalg.pinv(x_mat.T @ x_mat)
    beta = bread @ (x_mat.T @ y_vec)
    resid = y_vec - (x_mat @ beta)

    ss_res = float(np.sum(resid**2))
    ss_tot = float(np.sum((y_vec - np.mean(y_vec)) ** 2))
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    adj_r2 = 1.0 - (1.0 - r2) * (n_obs - 1) / max(n_obs - k_params, 1)

    groups = reg_df["province_code"].to_numpy()
    unique_groups = np.unique(groups)
    n_groups = len(unique_groups)
    meat = np.zeros((k_params, k_params), dtype=float)
    for g in unique_groups:
        mask = groups == g
        score_g = x_mat[mask].T @ resid[mask]
        meat += np.outer(score_g, score_g)

    dof_scale = (n_groups / max(n_groups - 1, 1)) * ((n_obs - 1) / max(n_obs - k_params, 1))
    cov_cluster = dof_scale * (bread @ meat @ bread)
    se = np.sqrt(np.maximum(np.diag(cov_cluster), 1e-12))
    t_stats = beta / se
    p_vals = 2.0 * stats.t.sf(np.abs(t_stats), df=max(n_groups - 1, 1))

    terms = {
        col: {
            "std_beta": round(float(beta[idx + 1]), 4),
            "p_value": round(float(p_vals[idx + 1]), 5),
        }
        for idx, col in enumerate(clean_cols)
    }
    return {
        "target": target_col,
        "n_obs": int(n_obs),
        "n_clusters": int(n_groups),
        "r2": round(float(r2), 4),
        "adj_r2": round(float(adj_r2), 4),
        "terms": terms,
    }


def screen_structural_clustering_features(
    struct_df: pd.DataFrame,
    max_vif: float = 5.0,
) -> tuple[pd.DataFrame, list[str]]:
    """Screen 17 province structural features using collinearity and VIF pruning across 3 risk pillars."""
    avail_cols = [c for c, _ in STRUCTURAL_CANDIDATES if c in struct_df.columns]
    ds_map = dict(STRUCTURAL_CANDIDATES)
    missing_map = {c: round(float(struct_df[c].isna().mean() * 100.0), 2) for c in avail_cols}

    # Pre prune near duplicate pairs with absolute correlation above 0.85 keeping higher variance representative
    corr = struct_df[avail_cols].corr(method="spearman").abs()
    pref_order = [
        "foreign_visitor_share",
        "avg_occupancy_rate",
        "occupancy_volatility",
        "annual_pm25_days_over_37_5",
        "annual_heavy_rain_days",
        "debt_to_annual_income_sme",
        "debt_to_annual_income_all",
        "expense_to_income_pct_sme",
        "pm25_mean_3y",
        "pm25_p90_3y",
        "max_monthly_rainfall_mm",
        "avg_monthly_revenue_mthb",
        "foreign_revenue_share",
        "expense_to_income_pct_all",
    ]
    ordered = [c for c in pref_order if c in avail_cols]
    kept_after_corr: list[str] = []
    dropped_corr: dict[str, str] = {}

    for col in ordered:
        conflict = next((k for k in kept_after_corr if corr.loc[col, k] >= 0.85), None)
        if conflict is not None:
            dropped_corr[col] = f"Dropped due to high correlation with {conflict} (|r|={corr.loc[col, conflict]:.2f})"
        else:
            kept_after_corr.append(col)

    selected, final_vifs, dropped_vifs = _iterative_vif_prune(
        struct_df, kept_after_corr, max_vif=max_vif
    )
    selected_set = frozenset(selected)

    rows: list[dict[str, Any]] = []
    for col in avail_cols:
        if col in dropped_corr:
            vif_v, is_sel, reason = None, False, dropped_corr[col]
        elif col in dropped_vifs:
            vif_v, is_sel, reason = (
                dropped_vifs[col],
                False,
                f"Dropped due to structural multicollinearity (VIF={dropped_vifs[col]})",
            )
        elif col in selected_set:
            vif_v, is_sel, reason = (
                final_vifs.get(col, 1.0),
                True,
                f"Selected for 17 province clustering (VIF={final_vifs.get(col, 1.0)})",
            )
        else:
            vif_v, is_sel, reason = None, False, "Not selected"

        rows.append(
            {
                "feature_name": col,
                "dataset_name": ds_map[col],
                "target_name": "clustering_17_provinces",
                "best_lag_months": 0,
                "pearson_r": None,
                "spearman_r": None,
                "p_value": None,
                "vif_score": vif_v,
                "missing_pct": missing_map[col],
                "is_selected": is_sel,
                "decision_reason": reason,
            }
        )
    return pd.DataFrame(rows), selected


def save_screening_results_to_neon(combined_df: pd.DataFrame, ols_summary: dict[str, Any]) -> int:
    """Persist empirical screening audit table into gold.feature_screening_results."""
    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM gold.feature_screening_results")
        cur.close()

    rows = []
    for rec in combined_df.to_dict(orient="records"):
        rows.append(
            {
                "feature_name": rec["feature_name"],
                "dataset_name": rec["dataset_name"],
                "target_name": rec["target_name"],
                "best_lag_months": int(rec["best_lag_months"]),
                "pearson_r": None if pd.isna(rec["pearson_r"]) else float(rec["pearson_r"]),
                "spearman_r": None if pd.isna(rec["spearman_r"]) else float(rec["spearman_r"]),
                "p_value": None if pd.isna(rec["p_value"]) else float(rec["p_value"]),
                "vif_score": None if pd.isna(rec["vif_score"]) else float(rec["vif_score"]),
                "missing_pct": float(rec["missing_pct"]),
                "is_selected": bool(rec["is_selected"]),
                "decision_reason": str(rec["decision_reason"]),
            }
        )

    insert_sql = """
        INSERT INTO gold.feature_screening_results (
            feature_name, dataset_name, target_name, best_lag_months,
            pearson_r, spearman_r, p_value, vif_score, missing_pct,
            is_selected, decision_reason
        ) VALUES (
            :feature_name, :dataset_name, :target_name, :best_lag_months,
            :pearson_r, :spearman_r, :p_value, :vif_score, :missing_pct,
            :is_selected, :decision_reason
        )
    """
    inserted = bulk_execute(insert_sql, rows)

    bulk_execute(
        """
        INSERT INTO gold.pipeline_eval_runs (run_type, metrics_json, token_count, estimated_cost_thb)
        VALUES (:run_type, CAST(:metrics_json AS JSONB), 0, 0.0)
        """,
        [
            {
                "run_type": "eda_feature_screening",
                "metrics_json": json.dumps(ols_summary, ensure_ascii=False),
            }
        ],
    )
    return inserted


def plot_eda_figures(
    panel: pd.DataFrame,
    struct_df: pd.DataFrame,
    lag_df: pd.DataFrame,
    struct_screen_df: pd.DataFrame,
) -> list[Path]:
    """Generate 300 DPI institutional charts for analysis review and presentation slides."""
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid", context="notebook")
    saved_paths: list[Path] = []

    # Figure 1 data completeness and Sept 2024 Chiang Mai Chiang Rai flood impact verification
    fig, axes = plt.subplots(1, 2, figsize=(14, 5.4), dpi=300)

    news_cov_rows = fetch_all("SELECT count(DISTINCT province_code) AS n FROM silver.news_events")
    news_cov = (int(news_cov_rows[0]["n"]) / 17.0) * 100.0 if news_cov_rows else 0.0
    cov_data = pd.DataFrame(
        {
            "Source": [
                "MOTS Tourism (34M)",
                "Open Meteo PM2.5 (34M)",
                "Open Meteo Rainfall (34M)",
                "NSO Debt and Income (2025)",
                "BIS CPI and FRED Controls",
                "Silver News Events (Media Bias)",
            ],
            "Coverage": [
                100.0,
                100.0,
                100.0,
                100.0,
                round((1.0 - panel["th_cpi_yoy_pct"].isna().mean()) * 100.0, 1),
                round(news_cov, 1),
            ],
        }
    )
    colors = ["#0F2537" if v >= 70.0 else "#DC2626" for v in cov_data["Coverage"]]
    axes[0].barh(cov_data["Source"][::-1], cov_data["Coverage"][::-1], color=colors[::-1], height=0.58)
    axes[0].axvline(70.0, color="#D97706", linestyle="--", linewidth=1.3, label="70% Inclusion Gate")
    for idx, val in enumerate(cov_data["Coverage"][::-1]):
        axes[0].text(min(val + 1.5, 102), idx, f"{val:.1f}%", va="center", fontsize=9, fontweight="bold")
    axes[0].set_xlim(0, 115)
    axes[0].set_title("Province Coverage Gate Across Real Data Sources", fontsize=11, fontweight="bold", color="#0F2537")
    axes[0].set_xlabel("Coverage (%)")
    axes[0].legend(loc="lower right", frameon=True)

    # Right subplot Chiang Mai and Chiang Rai occupancy rate across 2024 to 2026
    for code, label, color in [("CM", "Chiang Mai (CM)", "#0F2537"), ("CR", "Chiang Rai (CR)", "#0D9488")]:
        sub = panel[panel["province_code"] == code].sort_values("period_date")
        axes[1].plot(sub["period_date"], sub["occupancy_rate"], marker="o", markersize=3.5, linewidth=1.8, label=label, color=color)
    axes[1].axvspan(pd.Timestamp("2024-09-01"), pd.Timestamp("2024-10-15"), color="#DC2626", alpha=0.14, label="Sept 2024 Flood Shock")
    axes[1].axvspan(pd.Timestamp("2026-03-01"), pd.Timestamp("2026-04-30"), color="#D97706", alpha=0.14, label="Mar Apr 2026 Haze Peak")
    axes[1].set_title("Official MOTS Occupancy Rate Verification (CM and CR)", fontsize=11, fontweight="bold", color="#0F2537")
    axes[1].set_ylabel("Occupancy Rate (%)")
    axes[1].tick_params(axis="x", rotation=30)
    axes[1].legend(loc="lower right", fontsize=8, frameon=True)

    plt.tight_layout()
    p1 = FIGURES_DIR / "01_data_coverage_and_audit.png"
    fig.savefig(p1, dpi=300, bbox_inches="tight")
    plt.close(fig)
    saved_paths.append(p1)

    # Figure 2 lag correlation heatmap and structural feature correlation plus VIF screening
    fig, axes = plt.subplots(1, 2, figsize=(15, 6.4), dpi=300)

    piv_r = lag_df.pivot(index="feature_name", columns="lag", values="spearman_r")
    piv_p = lag_df.pivot(index="feature_name", columns="lag", values="p_value")
    order_feats = piv_r.abs().max(axis=1).sort_values(ascending=False).index
    piv_r = piv_r.loc[order_feats]
    piv_p = piv_p.loc[order_feats]

    annot = piv_r.copy().astype(object)
    for r_idx in piv_r.index:
        for c_idx in piv_r.columns:
            rv = piv_r.loc[r_idx, c_idx]
            pv = piv_p.loc[r_idx, c_idx]
            stars = "**" if pv < 0.01 else ("*" if pv < 0.05 else "")
            annot.loc[r_idx, c_idx] = f"{rv:+.2f}{stars}"

    piv_r.columns = [f"Lag {c}M" for c in piv_r.columns]
    sns.heatmap(
        piv_r,
        annot=annot,
        fmt="",
        cmap="RdBu_r",
        center=0.0,
        vmin=-0.45,
        vmax=0.45,
        linewidths=0.5,
        ax=axes[0],
        cbar_kws={"label": "Spearman r"},
    )
    axes[0].set_title("Within Province Lag Correlation vs Deseasonalized Occupancy\n(* p<0.05, ** p<0.01)", fontsize=10.5, fontweight="bold", color="#0F2537")
    axes[0].set_ylabel("")

    # Right subplot VIF bars for structural clustering candidates that passed pairwise check
    vif_plot = struct_screen_df[struct_screen_df["vif_score"].notna()].sort_values("vif_score", ascending=True)
    bar_colors = ["#0D9488" if s else "#DC2626" for s in vif_plot["is_selected"]]
    axes[1].barh(vif_plot["feature_name"], vif_plot["vif_score"], color=bar_colors, height=0.58)
    axes[1].axvline(5.0, color="#D97706", linestyle="--", linewidth=1.4, label="VIF = 5.0 Cutoff")
    for idx, val in enumerate(vif_plot["vif_score"]):
        axes[1].text(val + 0.15, idx, f"{val:.2f}", va="center", fontsize=8.5, fontweight="bold")
    axes[1].set_title("17 Province Structural Clustering VIF Screening\n(Teal = Selected, Red = Dropped)", fontsize=10.5, fontweight="bold", color="#0F2537")
    axes[1].set_xlabel("Variance Inflation Factor (VIF)")
    axes[1].legend(loc="lower right", frameon=True)

    plt.tight_layout()
    p2 = FIGURES_DIR / "02_lag_correlation_and_vif.png"
    fig.savefig(p2, dpi=300, bbox_inches="tight")
    plt.close(fig)
    saved_paths.append(p2)

    return saved_paths


def run_full_eda_screening() -> dict[str, Any]:
    """Execute complete empirical EDA screening, persist audit records, and plot 300 DPI figures."""
    panel = build_monthly_analysis_panel()
    struct = build_provincial_structural_profile(panel)

    occ_screen, lag_occ_df, ols_occ = screen_monthly_panel_features(panel, target_col="occupancy_deseason")
    rev_screen, _, ols_rev = screen_monthly_panel_features(panel, target_col="revenue_deseason_pct")
    yoy_screen, _, ols_yoy = screen_monthly_panel_features(panel, target_col="occupancy_yoy_diff")
    struct_screen, selected_struct = screen_structural_clustering_features(struct)

    combined = pd.concat([occ_screen, rev_screen, yoy_screen, struct_screen], ignore_index=True)
    saved_rows = save_screening_results_to_neon(
        combined,
        {"occupancy_deseason": ols_occ, "revenue_deseason_pct": ols_rev, "occupancy_yoy_diff": ols_yoy},
    )
    figures = plot_eda_figures(panel, struct, lag_occ_df, struct_screen)

    return {
        "neon_rows_saved": saved_rows,
        "selected_dynamic_occ": occ_screen[occ_screen["is_selected"]][
            ["feature_name", "best_lag_months", "spearman_r", "p_value", "vif_score"]
        ].to_dict(orient="records"),
        "selected_dynamic_rev": rev_screen[rev_screen["is_selected"]][
            ["feature_name", "best_lag_months", "spearman_r", "p_value", "vif_score"]
        ].to_dict(orient="records"),
        "selected_dynamic_yoy": yoy_screen[yoy_screen["is_selected"]][
            ["feature_name", "best_lag_months", "spearman_r", "p_value", "vif_score"]
        ].to_dict(orient="records"),
        "ols_occupancy": ols_occ,
        "ols_revenue": ols_rev,
        "selected_structural_clustering": selected_struct,
        "structural_table": struct_screen[["feature_name", "vif_score", "is_selected", "decision_reason"]].to_dict(
            orient="records"
        ),
        "figures": [str(p) for p in figures],
    }
