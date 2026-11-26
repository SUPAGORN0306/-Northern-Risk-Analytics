"""Empirical EDA, lag correlation, macro controlled OLS, VIF pruning, and 300 DPI report figures."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
import pandas as pd
import seaborn as sns
from scipy import stats

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from src.config.feature_registry import (
    get_clustering_core_features,
    get_eda_inference_policy,
    get_git_commit_short,
    get_spec_version,
    get_validation_policy,
)
from src.db.connection import atomic_replace_table, bulk_execute, fetch_all, get_connection
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
    ("log_foreign_visitor_share", "mots_tourism"),
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


def _within_province_block_permutation_p(
    pair: pd.DataFrame,
    observed_r: float,
    *,
    n_permutations: int = 299,
    block_length: int = 3,
    seed: int = 42,
) -> float:
    """Two-sided within-province circular block permutation preserving local serial runs."""
    rng = np.random.default_rng(seed)
    groups = [g[["x", "y"]].dropna() for _, g in pair.groupby("province_code", sort=True)]
    groups = [g for g in groups if len(g) >= block_length * 2]
    if not groups or not np.isfinite(observed_r):
        return 1.0
    exceed = 0
    valid = 0
    for _ in range(n_permutations):
        perm_x: list[float] = []
        perm_y: list[float] = []
        for group in groups:
            x = group["x"].to_numpy(dtype=float)
            y = group["y"].to_numpy(dtype=float)
            # Each observed value appears once; unlike bootstrap resampling, no rows are duplicated or dropped.
            shuffled = _circular_block_permutation(x, block_length, rng)
            perm_x.extend((shuffled - float(np.mean(shuffled))).tolist())
            perm_y.extend((y - float(np.mean(y))).tolist())
        if len(set(perm_x)) < 2 or len(set(perm_y)) < 2:
            continue
        statistic = float(stats.spearmanr(perm_x, perm_y).statistic)
        if np.isfinite(statistic):
            valid += 1
            exceed += int(abs(statistic) >= abs(observed_r))
    return round((exceed + 1) / (valid + 1), 6)


def _circular_block_permutation(values: np.ndarray, block_length: int, rng: np.random.Generator) -> np.ndarray:
    """Permute contiguous circular blocks once each, preserving the observed marginal values."""
    if block_length < 1 or len(values) < 1:
        raise ValueError("values and block_length must be non-empty and positive")
    rotated = np.roll(values, -int(rng.integers(0, len(values))))
    blocks = [rotated[i : i + block_length] for i in range(0, len(rotated), block_length)]
    return np.concatenate([blocks[int(i)] for i in rng.permutation(len(blocks))])


def screen_monthly_panel_features(
    panel: pd.DataFrame,
    target_col: str = "occupancy_deseason",
    max_lag: int = 2,
    alpha: float | None = None,
    max_vif: float | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    """Run within province lag correlation, controlled fixed effects OLS, and VIF pruning."""
    policy = get_validation_policy()
    inference_policy = get_eda_inference_policy()
    alpha = float(policy["alpha_threshold"]) if alpha is None else float(alpha)
    max_vif = float(policy["max_vif"]) if max_vif is None else float(max_vif)
    max_missing_pct = float(policy["max_missing_pct"])
    min_coverage_pct = round(100.0 - max_missing_pct, 1)
    df = panel.sort_values(["province_code", "period_date"]).copy()
    records: list[dict[str, Any]] = []
    lag_matrix_rows: list[dict[str, Any]] = []

    for feat, dataset in DYNAMIC_CANDIDATES:
        if feat not in df.columns:
            continue
        missing_pct = round(float(df[feat].isna().mean() * 100.0), 2)

        for lag in range(max_lag + 1):
            # Shift strictly within each province to prevent cross province leakage
            shifted = df.groupby("province_code", sort=False)[feat].shift(lag)
            pair = pd.DataFrame({"province_code": df["province_code"], "x": shifted, "y": df[target_col]}).dropna()
            if len(pair) < inference_policy["minimum_observations"] or pair["x"].nunique() < 3:
                continue

            # Within transform removes cross-province level differences before correlation inference.
            grouped = pair.groupby("province_code", sort=False)
            x_within = pair["x"] - grouped["x"].transform("mean")
            y_within = pair["y"] - grouped["y"].transform("mean")
            if x_within.nunique() < 3 or y_within.nunique() < 3:
                continue
            pr, _ = stats.pearsonr(x_within, y_within)
            sr, sp = stats.spearmanr(x_within, y_within)
            p_block = _within_province_block_permutation_p(
                pair,
                float(sr),
                n_permutations=inference_policy["block_permutation_replicates"],
                block_length=inference_policy["block_length_months"],
                seed=42 + lag + sum(ord(ch) for ch in f"{feat}:{target_col}"),
            )
            lag_matrix_rows.append(
                {
                    "feature_name": feat,
                    "dataset_name": dataset,
                    "lag": lag,
                    "pearson_r": float(pr),
                    "spearman_r": float(sr),
                    "p_value": float(sp),
                    "p_block_perm": p_block,
                    "missing_pct": missing_pct,
                    "n_obs": int(len(pair)),
                }
            )

    # Apply true Benjamini Hochberg FDR across ALL feature lag hypotheses BEFORE selecting best lag
    lag_df_all = pd.DataFrame(lag_matrix_rows)
    if not lag_df_all.empty:
        # The IID Spearman p-value is diagnostic only; selection uses the within-province block null.
        raw_p_all = lag_df_all["p_block_perm"].to_numpy(dtype=float)
        m_total = len(raw_p_all)
        order = np.argsort(raw_p_all)
        ranks = np.empty_like(order)
        ranks[order] = np.arange(1, m_total + 1)
        fdr_vals = np.minimum(1.0, raw_p_all * (float(m_total) / ranks))
        fdr_sorted = np.minimum.accumulate(fdr_vals[order][::-1])[::-1]
        fdr_final = np.empty_like(fdr_vals)
        fdr_final[order] = np.round(fdr_sorted, 6)
        lag_df_all["p_value_fdr"] = fdr_final

        for feat, grp_f in lag_df_all.groupby("feature_name", sort=False):
            best = grp_f.sort_values(
                by=["p_value_fdr", "spearman_r"],
                key=lambda col: col.abs() if col.name == "spearman_r" else col,
                ascending=[True, False],
            ).iloc[0]
            records.append(
                {
                    "feature_name": str(feat),
                    "dataset_name": str(best["dataset_name"]),
                    "target_name": target_col,
                    "best_lag_months": int(best["lag"]),
                    "pearson_r": round(float(best["pearson_r"]), 4),
                    "spearman_r": round(float(best["spearman_r"]), 4),
                    "p_value": round(float(best["p_value"]), 6),
                    "p_block_perm": round(float(best["p_block_perm"]), 6),
                    "p_value_fdr": round(float(best["p_value_fdr"]), 6),
                    "missing_pct": float(best["missing_pct"]),
                }
            )
    n_tests = len(lag_matrix_rows)

    # Permanently audit news distribution to enforce media concentration and coverage guardrail
    news_dist_rows = fetch_all(
        """
        SELECT province_code, count(*) AS n
        FROM silver.news_events
        GROUP BY province_code
        ORDER BY n DESC
        """
    )
    news_prov_count = len(news_dist_rows)
    news_cov_pct = round((news_prov_count / 17.0) * 100.0, 2)
    total_news_events = sum(int(r["n"]) for r in news_dist_rows)
    top3_news_share = (
        round((sum(int(r["n"]) for r in news_dist_rows[:3]) / float(total_news_events)) * 100.0, 1)
        if total_news_events > 0
        else 0.0
    )
    min_news_cnt = int(news_dist_rows[-1]["n"]) if news_dist_rows else 0
    max_news_cnt = int(news_dist_rows[0]["n"]) if news_dist_rows else 0
    news_ratio = round(max_news_cnt / float(max(min_news_cnt, 1)), 1) if max_news_cnt > 0 else 0.0
    records.append(
        {
            "feature_name": "news_shock_count",
            "dataset_name": "silver_news_events",
            "target_name": target_col,
            "best_lag_months": 0,
            "pearson_r": None,
            "spearman_r": None,
            "p_value": None,
            "p_value_fdr": None,
            "missing_pct": round(100.0 - news_cov_pct, 2),
        }
    )

    res_df = pd.DataFrame(records)

    # Strictly require Benjamini Hochberg FDR pass across all feature lag hypotheses
    sig_mask = (
        res_df["p_value_fdr"].notna()
        & (res_df["p_value_fdr"] < alpha)
        & (res_df["missing_pct"] <= max_missing_pct)
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
        p_fdr = rec.get("p_value_fdr")
        if feat == "news_shock_count":
            vifs_col.append(None)
            sel_col.append(False)
            if news_cov_pct < min_coverage_pct:
                reason_col.append(
                    f"Dropped due to sparse coverage ({news_prov_count} of 17 provinces covered, {news_cov_pct:.1f}% below {min_coverage_pct:.0f} percent gate)"
                )
            else:
                reason_col.append(
                    f"Excluded from quantitative modeling due to media concentration bias ({news_prov_count} of 17 provinces covered, top 3 hold {top3_news_share:.1f}% of {total_news_events} events, {news_ratio:.1f}x max to min gap); routed to qualitative alerts only"
                )
        elif rec["missing_pct"] > max_missing_pct:
            vifs_col.append(None)
            sel_col.append(False)
            reason_col.append(f"Dropped because missing rate exceeds {max_missing_pct:.0f} percent")
        elif rec["p_value"] is None or rec["p_value"] >= alpha:
            vifs_col.append(None)
            sel_col.append(False)
            reason_col.append(f"Exploratory screen dropped (raw p={rec['p_value']}, FDR q={p_fdr})")
        elif p_fdr is None or p_fdr >= alpha:
            vifs_col.append(None)
            sel_col.append(False)
            reason_col.append(
                f"Exploratory only passed raw p ({rec['p_value']}) but failed Benjamini Hochberg FDR (q={p_fdr})"
            )
        elif feat in dropped_vifs:
            vifs_col.append(dropped_vifs[feat])
            sel_col.append(False)
            reason_col.append(f"Dropped due to multicollinearity (VIF={dropped_vifs[feat]}, FDR q={p_fdr})")
        elif feat in selected_set:
            vifs_col.append(final_vifs.get(feat, 1.0))
            sel_col.append(True)
            reason_col.append(f"Exploratory selected (raw p={rec['p_value']}, FDR q={p_fdr}, VIF={final_vifs.get(feat, 1.0)})")
        else:
            vifs_col.append(None)
            sel_col.append(False)
            reason_col.append(f"Exploratory screen not selected (FDR q={p_fdr})")

    res_df["vif_score"] = vifs_col
    res_df["is_selected"] = sel_col
    res_df["decision_reason"] = reason_col

    # Run true within province fixed effects OLS controlling for macro variables simultaneously
    ols_summary = _run_controlled_panel_ols(df, target_col, selected_feats, lag_lookup)
    ols_summary["analysis_scope"] = "exploratory_within_province_screening_not_causal"
    ols_summary["target_domain_scope"] = (
        "Tourism demand and provincial service sector indicators only "
        "(occupancy_deseason, revenue_deseason_pct, occupancy_yoy_diff)"
    )
    ols_summary["debt_interpretation_guardrail"] = (
        "NSO household and SME debt ratios are cross sectional provincial context features used only "
        "for 17 province structural clustering; do not use this monthly EDA to claim proof of debt relief "
        "effectiveness, individual default probability, or ranking of personal debt distress"
    )
    ols_summary["multiple_testing_correction"] = "benjamini_hochberg_fdr_all_feature_lag_hypotheses"
    inference_policy = get_eda_inference_policy()
    ols_summary["autocorrelation_caveat"] = (
        "Feature screening uses within-province circular block permutation to preserve local serial dependence. "
        "Fixed-effects OLS p-values use province-clustered covariance and restricted Rademacher wild-cluster "
        f"bootstrap ({inference_policy['wild_cluster_bootstrap_replicates']} replicates); only "
        f"{ols_summary.get('n_clusters', 0)} province clusters are available, below the configured "
        f"{inference_policy['minimum_province_clusters_for_confirmatory_inference']} cluster threshold, "
        "so all results remain exploratory and are not causal evidence."
    )
    ols_summary["total_lag_hypotheses_tested"] = int(n_tests)
    return res_df, lag_df_all, ols_summary


def _run_controlled_panel_ols(
    df: pd.DataFrame,
    target_col: str,
    selected_feats: list[str],
    lag_lookup: dict[str, int],
) -> dict[str, Any]:
    """Estimate within province fixed effects OLS with small sample province clustered standard errors."""
    control_cols = ["th_cpi_yoy_pct", "oil_brent_yoy_pct", "usdthb_yoy_pct", "thai_rice_usd_yoy_pct"]
    model_cols = list(dict.fromkeys(selected_feats + [c for c in control_cols if c in df.columns]))

    reg_df = pd.DataFrame({"province_code": df["province_code"], "y": df[target_col]})
    for col in model_cols:
        lag = int(lag_lookup.get(col, 0))
        reg_df[col] = df.groupby("province_code", sort=False)[col].shift(lag)
    reg_df = reg_df.dropna()

    if len(reg_df) < 50 or not model_cols:
        return {"n_obs": int(len(reg_df)), "r2_within": 0.0, "province_fixed_effects": True, "terms": {}}

    # Prune macro collinearity inside OLS design matrix for clean inference
    clean_cols, _, _ = _iterative_vif_prune(
        reg_df, model_cols, max_vif=get_validation_policy()["ols_max_vif"]
    )
    if not clean_cols:
        return {"n_obs": int(len(reg_df)), "r2_within": 0.0, "province_fixed_effects": True, "terms": {}}

    # Apply within province entity demeaning to absorb all time invariant province fixed effects
    fe_grp = reg_df.groupby("province_code", sort=False)
    y_within = (reg_df["y"] - fe_grp["y"].transform("mean")).to_numpy(dtype=float)
    x_within_df = pd.DataFrame(index=reg_df.index)
    for col in clean_cols:
        demeaned = reg_df[col] - fe_grp[col].transform("mean")
        std_val = float(demeaned.std(ddof=0))
        x_within_df[col] = demeaned / (std_val if std_val > 1e-9 else 1.0)

    x_mat = x_within_df.to_numpy(dtype=float)
    n_obs, k_slopes = x_mat.shape

    groups = reg_df["province_code"].to_numpy()
    unique_groups = np.unique(groups)
    n_groups = len(unique_groups)

    # Vectorized within estimator with Liang Zeger province clustered sandwich covariance
    bread = np.linalg.pinv(x_mat.T @ x_mat)
    beta = bread @ (x_mat.T @ y_within)
    resid = y_within - (x_mat @ beta)

    ss_res = float(np.sum(resid**2))
    ss_tot = float(np.sum(y_within**2))
    r2_within = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    dof_denom = max(n_obs - k_slopes - n_groups, 1)
    adj_r2_within = 1.0 - (1.0 - r2_within) * max(n_obs - n_groups, 1) / dof_denom

    meat = np.zeros((k_slopes, k_slopes), dtype=float)
    for g in unique_groups:
        mask = groups == g
        score_g = x_mat[mask].T @ resid[mask]
        meat += np.outer(score_g, score_g)

    # Small sample cluster correction accounting for absorbed province fixed effects
    dof_scale = (n_groups / max(n_groups - 1, 1)) * ((n_obs - 1) / dof_denom)
    cov_cluster = dof_scale * (bread @ meat @ bread)
    se = np.sqrt(np.maximum(np.diag(cov_cluster), 1e-12))
    t_stats = beta / se
    p_vals = 2.0 * stats.t.sf(np.abs(t_stats), df=max(n_groups - 1, 1))

    inference_policy = get_eda_inference_policy()

    def wild_cluster_pvalue(term_idx: int, n_boot: int) -> float:
        """Restricted Rademacher wild-cluster bootstrap p-value for one coefficient."""
        keep = [i for i in range(k_slopes) if i != term_idx]
        x0 = x_mat[:, keep] if keep else np.empty((n_obs, 0), dtype=float)
        beta0 = np.linalg.pinv(x0.T @ x0) @ (x0.T @ y_within) if keep else np.empty(0)
        fitted0 = x0 @ beta0 if keep else np.zeros(n_obs, dtype=float)
        resid0 = y_within - fitted0
        rng = np.random.default_rng(109 + term_idx)
        observed_t = abs(float(t_stats[term_idx]))
        exceed = 0
        valid = 0
        for _ in range(n_boot):
            signs = {g: float(rng.choice((-1.0, 1.0))) for g in unique_groups}
            y_star = fitted0 + np.asarray([signs[g] for g in groups]) * resid0
            beta_star = bread @ (x_mat.T @ y_star)
            resid_star = y_star - x_mat @ beta_star
            meat_star = np.zeros((k_slopes, k_slopes), dtype=float)
            for g in unique_groups:
                mask = groups == g
                score_g = x_mat[mask].T @ resid_star[mask]
                meat_star += np.outer(score_g, score_g)
            cov_star = dof_scale * (bread @ meat_star @ bread)
            se_star = float(np.sqrt(max(float(cov_star[term_idx, term_idx]), 1e-12)))
            t_star = abs(float(beta_star[term_idx]) / se_star)
            if np.isfinite(t_star):
                valid += 1
                exceed += int(t_star >= observed_t)
        return round((exceed + 1) / (valid + 1), 6)

    wild_replicates = inference_policy["wild_cluster_bootstrap_replicates"]
    wild_p = [wild_cluster_pvalue(idx, wild_replicates) for idx in range(k_slopes)]

    terms = {
        col: {
            "std_beta": round(float(beta[idx]), 4),
            "se_cluster": round(float(se[idx]), 4),
            "p_value": round(float(p_vals[idx]), 5),
            "p_wild_bootstrap": wild_p[idx],
        }
        for idx, col in enumerate(clean_cols)
    }
    return {
        "target": target_col,
        "estimator": "within_province_fixed_effects_ols",
        "province_fixed_effects": True,
        "n_obs": int(n_obs),
        "n_clusters": int(n_groups),
        "small_cluster_count_warning": n_groups < inference_policy["minimum_province_clusters_for_confirmatory_inference"],
        "wild_cluster_bootstrap": {"method": "restricted_rademacher_wild_cluster_t", "replicates": wild_replicates},
        "r2": round(float(r2_within), 4),
        "r2_within": round(float(r2_within), 4),
        "adj_r2": round(float(adj_r2_within), 4),
        "terms": terms,
    }


def screen_structural_clustering_features(
    struct_df: pd.DataFrame,
    max_vif: float | None = None,
) -> tuple[pd.DataFrame, list[str]]:
    """Screen 17 province structural features using collinearity, small sample parsimony, and VIF pruning."""
    policy = get_validation_policy()
    max_vif = float(policy["max_vif"]) if max_vif is None else float(max_vif)
    max_corr = float(policy["max_pairwise_spearman"])
    avail_cols = [c for c, _ in STRUCTURAL_CANDIDATES if c in struct_df.columns]
    ds_map = dict(STRUCTURAL_CANDIDATES)
    missing_map = {c: round(float(struct_df[c].isna().mean() * 100.0), 2) for c in avail_cols}

    # Stage 1 pre prune near duplicate pairs with absolute Spearman correlation at or above policy cutoff
    corr = struct_df[avail_cols].corr(method="spearman").abs()
    core_tuple = get_clustering_core_features()
    pref_order = list(core_tuple) + [
        c
        for c in [
            "annual_heavy_rain_days",
            "debt_to_annual_income_sme",
            "expense_to_income_pct_sme",
            "expense_to_income_pct_all",
            "avg_monthly_revenue_mthb",
            "pm25_mean_3y",
            "pm25_p90_3y",
            "foreign_revenue_share",
        ]
        if c not in core_tuple
    ]
    ordered = [c for c in pref_order if c in avail_cols]
    kept_after_corr: list[str] = []
    dropped_corr: dict[str, str] = {}

    for col in ordered:
        conflict = next((k for k in kept_after_corr if corr.loc[col, k] >= max_corr), None)
        if conflict is not None:
            dropped_corr[col] = f"Dropped due to high correlation with {conflict} (|r|={corr.loc[col, conflict]:.2f})"
        else:
            kept_after_corr.append(col)

    # Stage 2 validate canonical Core 6 features from feature_specs.yaml directly via VIF
    core_candidates = [c for c in core_tuple if c in kept_after_corr]
    selected, final_vifs, dropped_vifs = _iterative_vif_prune(
        struct_df, core_candidates, max_vif=max_vif
    )
    selected_set = frozenset(selected)

    # Stage 3 test every remaining non duplicate candidate marginally against the selected Core 6
    extra_pool = [c for c in kept_after_corr if c not in selected_set and c not in dropped_vifs]
    marginal_vifs: dict[str, float] = {}
    for extra_col in extra_pool:
        marg = _compute_vif_map(struct_df, selected + [extra_col])
        mv = marg.get(extra_col, 1.0)
        if mv >= max_vif:
            dropped_vifs[extra_col] = mv
        else:
            marginal_vifs[extra_col] = mv

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
                f"Selected canonical core feature for 17 province clustering (VIF={final_vifs.get(col, 1.0)})",
            )
        elif col in marginal_vifs:
            vif_v = marginal_vifs[col]
            is_sel = False
            reason = (
                f"Secondary context excluded from Core 6 to preserve N/p=2.83 parsimony "
                f"(marginal VIF={vif_v}; available for drilldown or optional Lab toggle)"
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


def save_screening_results_to_neon(
    combined_df: pd.DataFrame,
    ols_summary: dict[str, Any],
    run_id: str | None = None,
    data_cutoff: pd.Timestamp | None = None,
    connection: Any | None = None,
) -> int:
    """Persist empirical screening audit table atomically into gold.feature_screening_results with run lineage."""
    resolved_run_id = run_id or f"eda_{uuid.uuid4().hex[:12]}"
    cutoff = data_cutoff.date() if data_cutoff is not None else None
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
                "run_id": resolved_run_id,
                "feature_spec_version": get_spec_version(),
                "data_cutoff": cutoff,
                "p_block_perm": None if pd.isna(rec.get("p_block_perm")) else float(rec.get("p_block_perm")),
            }
        )

    insert_sql = """
        INSERT INTO gold.feature_screening_results (
            feature_name, dataset_name, target_name, best_lag_months,
            pearson_r, spearman_r, p_value, vif_score, missing_pct,
            is_selected, decision_reason, run_id, feature_spec_version, data_cutoff, p_block_perm
        ) VALUES (
            :feature_name, :dataset_name, :target_name, :best_lag_months,
            :pearson_r, :spearman_r, :p_value, :vif_score, :missing_pct,
            :is_selected, :decision_reason, :run_id, :feature_spec_version, :data_cutoff, :p_block_perm
        )
    """
    # Preserve prior screening runs for audit and run-to-run comparison.
    inserted = bulk_execute(insert_sql, rows, connection=connection)

    lineage_payload = {
        "run_id": resolved_run_id,
        "git_commit": get_git_commit_short(),
        "feature_spec_version": get_spec_version(),
        "validation_policy": get_validation_policy(),
        "analysis_scope": "exploratory_within_province_screening_not_causal",
        "strict_fdr_enforced": True,
        **ols_summary,
    }
    bulk_execute(
        """
        INSERT INTO gold.pipeline_eval_runs (run_type, metrics_json, token_count, estimated_cost_thb)
        VALUES (:run_type, CAST(:metrics_json AS JSONB), 0, 0.0)
        """,
        [
            {
                "run_type": "eda_feature_screening",
                "metrics_json": json.dumps(lineage_payload, ensure_ascii=False),
            }
        ],
        connection=connection,
    )
    return inserted


def plot_eda_figures(
    panel: pd.DataFrame,
    struct_df: pd.DataFrame,
    lag_df: pd.DataFrame,
    struct_screen_df: pd.DataFrame,
    ols_occ: dict[str, Any] | None = None,
) -> list[Path]:
    """Generate 300 DPI methodologically sound charts for analysis review and presentation slides."""
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid", context="notebook")
    saved_paths: list[Path] = []
    navy = "#0F2537"
    teal = "#0D9488"
    amber = "#D97706"
    crimson = "#DC2626"

    # Figure 1 computed real completeness audit, media concentration proof, and MOTS shock check
    fig, axes = plt.subplots(1, 3, figsize=(18.5, 5.4), dpi=300)

    n_months = int(panel["period_date"].nunique()) if not panel.empty else 0
    mots_cov = round((1.0 - float(panel["occupancy_rate"].isna().mean())) * 100.0, 1) if "occupancy_rate" in panel.columns else 0.0
    pm25_cov = round((1.0 - float(panel["pm25_mean"].isna().mean())) * 100.0, 1) if "pm25_mean" in panel.columns else 0.0
    rain_cov = round((1.0 - float(panel["rainfall_sum_mm"].isna().mean())) * 100.0, 1) if "rainfall_sum_mm" in panel.columns else 0.0
    nso_cov = (
        round((int(struct_df["debt_to_annual_income_all"].notna().sum()) / 17.0) * 100.0, 1)
        if "debt_to_annual_income_all" in struct_df.columns
        else 0.0
    )
    cpi_cov = round((1.0 - float(panel["th_cpi_yoy_pct"].isna().mean())) * 100.0, 1) if "th_cpi_yoy_pct" in panel.columns else 0.0
    oil_cov = round((1.0 - float(panel["oil_brent_yoy_pct"].isna().mean())) * 100.0, 1) if "oil_brent_yoy_pct" in panel.columns else 0.0

    cov_data = pd.DataFrame(
        {
            "Source": [
                f"MOTS Occupancy ({n_months}M)",
                f"Open Meteo PM2.5 ({n_months}M)",
                f"Open Meteo Rain ({n_months}M)",
                "NSO Debt & Income (2025)",
                "FRED Brent Oil YoY",
                "BIS Thailand CPI YoY",
            ],
            "Coverage": [mots_cov, pm25_cov, rain_cov, nso_cov, oil_cov, cpi_cov],
        }
    )
    bar_c = [navy if v >= 70.0 else crimson for v in cov_data["Coverage"]]
    axes[0].barh(cov_data["Source"][::-1], cov_data["Coverage"][::-1], color=bar_c[::-1], height=0.58)
    axes[0].axvline(70.0, color=amber, linestyle="--", linewidth=1.3, label="70% Inclusion Gate")
    for idx, val in enumerate(cov_data["Coverage"][::-1]):
        axes[0].text(min(val + 1.2, 102), idx, f"{val:.1f}%", va="center", fontsize=8.5, fontweight="bold")
    axes[0].set_xlim(0, 116)
    axes[0].set_title("A. Computed Data Completeness Audit\n(Measured Live from Panel and DB)", fontsize=10.4, fontweight="bold", color=navy)
    axes[0].set_xlabel("Observed Completeness (%)")
    axes[0].legend(loc="lower right", fontsize=8.0, frameon=True)

    # Panel B real media concentration distribution proving why news is excluded from numeric models
    news_rows = fetch_all(
        """
        SELECT province_code, count(*) AS n
        FROM silver.news_events
        GROUP BY province_code
        ORDER BY n DESC
        """
    )
    if news_rows:
        ndf = pd.DataFrame(news_rows)
        total_ev = int(ndf["n"].sum())
        top3_pct = round((float(ndf.head(3)["n"].sum()) / max(total_ev, 1)) * 100.0, 1)
        ratio_mm = round(float(ndf["n"].max()) / max(float(ndf["n"].min()), 1.0), 1)
        n_colors = [crimson if i < 3 else "#64748B" for i in range(len(ndf))]
        axes[1].bar(ndf["province_code"], ndf["n"], color=n_colors, width=0.68)
        axes[1].axhline(total_ev / 17.0, color=amber, linestyle="--", linewidth=1.2, label=f"Uniform Mean ({total_ev / 17.0:.1f})")
        axes[1].set_title(
            f"B. Media Concentration Bias Audit (n = {total_ev})\n(Top 3 Hold {top3_pct}%, {ratio_mm}x Max/Min -> Alerts Only)",
            fontsize=10.2,
            fontweight="bold",
            color=navy,
        )
        axes[1].set_ylabel("Verified Silver News Events")
        axes[1].tick_params(axis="x", labelsize=8.0, rotation=45)
        axes[1].legend(loc="upper right", fontsize=8.0, frameon=True)
    else:
        axes[1].text(0.5, 0.5, "No silver.news_events records", ha="center", va="center")
        axes[1].set_title("B. Media Concentration Bias Audit", fontsize=10.4, fontweight="bold", color=navy)

    # Panel C Chiang Mai and Chiang Rai occupancy rate across 2024 to 2026
    for code, label, color in [("CM", "Chiang Mai (CM)", navy), ("CR", "Chiang Rai (CR)", teal)]:
        sub = panel[panel["province_code"] == code].sort_values("period_date")
        axes[2].plot(sub["period_date"], sub["occupancy_rate"], marker="o", markersize=3.2, linewidth=1.8, label=label, color=color)
    axes[2].axvspan(pd.Timestamp("2024-09-01"), pd.Timestamp("2024-10-15"), color=crimson, alpha=0.14, label="Sept 2024 Flood Shock")
    axes[2].axvspan(pd.Timestamp("2026-03-01"), pd.Timestamp("2026-04-30"), color=amber, alpha=0.14, label="Mar Apr 2026 Haze Peak")
    axes[2].set_title("C. Official MOTS Occupancy Verification\n(Chiang Mai & Chiang Rai)", fontsize=10.4, fontweight="bold", color=navy)
    axes[2].set_ylabel("Occupancy Rate (%)")
    axes[2].tick_params(axis="x", rotation=30, labelsize=8.5)
    axes[2].legend(loc="lower right", fontsize=7.8, frameon=True)

    plt.tight_layout()
    p1 = FIGURES_DIR / "01_data_coverage_and_audit.png"
    fig.savefig(p1, dpi=300, bbox_inches="tight")
    plt.close(fig)
    saved_paths.append(p1)

    # Figure 2 FDR adjusted lag heatmap, controlled FE OLS forest plot, and structural VIF screening
    fig, axes = plt.subplots(1, 3, figsize=(20.5, 6.6), dpi=300, gridspec_kw={"width_ratios": [1.05, 1.0, 1.0]})

    piv_r = lag_df.pivot(index="feature_name", columns="lag", values="spearman_r")
    piv_q = lag_df.pivot(index="feature_name", columns="lag", values="p_value_fdr")
    order_feats = piv_r.abs().max(axis=1).sort_values(ascending=False).index
    piv_r = piv_r.loc[order_feats]
    piv_q = piv_q.loc[order_feats]

    annot = piv_r.copy().astype(object)
    for r_idx in piv_r.index:
        for c_idx in piv_r.columns:
            rv = piv_r.loc[r_idx, c_idx]
            qv = piv_q.loc[r_idx, c_idx]
            stars = "**" if qv < 0.01 else ("*" if qv < 0.05 else "")
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
    axes[0].set_title("A. Exploratory Lag Correlation vs Deseason Occ\n(Stars Strictly BH-FDR: * q<0.05, ** q<0.01)", fontsize=10.0, fontweight="bold", color=navy)
    axes[0].set_ylabel("")

    # Panel B within province fixed effects OLS coefficient forest plot (Clustered SE)
    ols_terms = (ols_occ or {}).get("terms", {})
    if ols_terms:
        t_rows = [
            {
                "term": k,
                "beta": float(v["std_beta"]),
                "se": float(v["se_cluster"]),
                "p": float(v["p_value"]),
            }
            for k, v in ols_terms.items()
        ]
        tdf = pd.DataFrame(t_rows).sort_values("beta", ascending=True).reset_index(drop=True)
        y_i = np.arange(len(tdf))
        ci_half = 1.96 * tdf["se"]
        pt_colors = [teal if pv < 0.05 else "#64748B" for pv in tdf["p"]]
        axes[1].axvline(0.0, color=crimson, linestyle="--", linewidth=1.2)
        for idx, row in tdf.iterrows():
            axes[1].errorbar(
                row["beta"],
                idx,
                xerr=float(ci_half.iloc[idx]),
                fmt="o",
                color=pt_colors[idx],
                ecolor=pt_colors[idx],
                elinewidth=1.8,
                capsize=4,
                markersize=6.5,
            )
        axes[1].set_yticks(y_i)
        axes[1].set_yticklabels(tdf["term"], fontsize=8.8)
        axes[1].set_xlabel("Standardized Beta (95% Province-Clustered CI)")
        r2_w = float((ols_occ or {}).get("r2_within", 0.0))
        n_obs = int((ols_occ or {}).get("n_obs", 0))
        axes[1].set_title(
            f"B. Within-Province FE OLS (Clustered SE, n={n_obs})\n(R2_within = {r2_w:.3f}; Teal = p<0.05, Gray = NS)",
            fontsize=10.0,
            fontweight="bold",
            color=navy,
        )
    else:
        axes[1].text(0.5, 0.5, "No FE OLS terms available", ha="center", va="center")
        axes[1].set_title("B. Within-Province FE OLS (Clustered SE)", fontsize=10.0, fontweight="bold", color=navy)

    # Panel C VIF bars for structural clustering candidates distinguishing Core 6, Secondary Context, and Dropped
    vif_plot = struct_screen_df[struct_screen_df["vif_score"].notna()].sort_values("vif_score", ascending=True).reset_index(drop=True)
    bar_colors = []
    for _, r in vif_plot.iterrows():
        if bool(r["is_selected"]):
            bar_colors.append(teal)
        elif float(r["vif_score"]) >= 5.0:
            bar_colors.append(crimson)
        else:
            bar_colors.append("#94A3B8")
    axes[2].barh(vif_plot["feature_name"], vif_plot["vif_score"], color=bar_colors, height=0.58)
    axes[2].axvline(5.0, color=amber, linestyle="--", linewidth=1.4)
    for idx, val in enumerate(vif_plot["vif_score"]):
        axes[2].text(val + 0.35, idx, f"{val:.2f}", va="center", fontsize=8.4, fontweight="bold")
    axes[2].set_xlim(0, max(float(vif_plot["vif_score"].max()) * 1.15, 7.0))
    axes[2].set_title(
        "C. Structural 17P VIF Screening (Canonical Core 6)\n(Teal = Core 6, Gray = Secondary, Red = Dropped VIF>=5)",
        fontsize=9.8,
        fontweight="bold",
        color=navy,
    )
    axes[2].set_xlabel("Variance Inflation Factor (VIF)")
    vif_legend = [
        plt.Rectangle((0, 0), 1, 1, color=teal, label="Core 6 Selected (VIF<5)"),
        plt.Rectangle((0, 0), 1, 1, color="#94A3B8", label="Secondary Context (N/p Guard)"),
        plt.Rectangle((0, 0), 1, 1, color=crimson, label="Dropped (VIF >= 5.0)"),
        plt.Line2D([0], [0], color=amber, linestyle="--", linewidth=1.4, label="VIF = 5.0 Cutoff"),
    ]
    axes[2].legend(handles=vif_legend, loc="lower right", fontsize=7.6, frameon=True)

    fig.suptitle(
        "Exploratory Tourism Macro Lag Screening & 17 Province Structural VIF Audit\n"
        "(Monthly Targets Are Tourism Occupancy/Revenue Only · NSO Debt Is Provincial Clustering Context, Not Debt Relief Proof)",
        fontsize=11.2,
        fontweight="bold",
        color=navy,
        y=1.03,
    )
    plt.tight_layout()
    p2 = FIGURES_DIR / "02_lag_correlation_and_vif.png"
    fig.savefig(p2, dpi=300, bbox_inches="tight")
    plt.close(fig)
    saved_paths.append(p2)

    return saved_paths


def run_full_eda_screening(run_id: str | None = None, persist: bool = True) -> dict[str, Any]:
    """Execute EDA screening and optionally defer its Gold writes to a shared publish transaction."""
    panel = build_monthly_analysis_panel()
    struct = build_provincial_structural_profile(panel)

    occ_screen, lag_occ_df, ols_occ = screen_monthly_panel_features(panel, target_col="occupancy_deseason")
    rev_screen, _, ols_rev = screen_monthly_panel_features(panel, target_col="revenue_deseason_pct")
    yoy_screen, _, ols_yoy = screen_monthly_panel_features(panel, target_col="occupancy_yoy_diff")
    struct_screen, selected_struct = screen_structural_clustering_features(struct)

    combined = pd.concat([occ_screen, rev_screen, yoy_screen, struct_screen], ignore_index=True)
    ols_summary = {"occupancy_deseason": ols_occ, "revenue_deseason_pct": ols_rev, "occupancy_yoy_diff": ols_yoy}
    data_cutoff = pd.to_datetime(panel["period_date"]).max() if not panel.empty else None
    saved_rows = save_screening_results_to_neon(
        combined, ols_summary, run_id=run_id, data_cutoff=data_cutoff
    ) if persist else 0
    figures = plot_eda_figures(panel, struct, lag_occ_df, struct_screen, ols_occ=ols_occ)

    def json_records(frame: pd.DataFrame) -> list[dict[str, Any]]:
        """Return records with missing pandas values represented as JSON null, not NaN."""
        clean = frame.astype(object).where(pd.notna(frame), None)
        return clean.to_dict(orient="records")

    return {
        "neon_rows_saved": saved_rows,
        "_publish_screening_rows": combined,
        "_publish_ols_summary": ols_summary,
        "_publish_data_cutoff": data_cutoff,
        "selected_dynamic_occ": json_records(
            occ_screen[occ_screen["is_selected"]][
                ["feature_name", "best_lag_months", "spearman_r", "p_value", "vif_score"]
            ]
        ),
        "selected_dynamic_rev": json_records(
            rev_screen[rev_screen["is_selected"]][
                ["feature_name", "best_lag_months", "spearman_r", "p_value", "vif_score"]
            ]
        ),
        "selected_dynamic_yoy": json_records(
            yoy_screen[yoy_screen["is_selected"]][
                ["feature_name", "best_lag_months", "spearman_r", "p_value", "vif_score"]
            ]
        ),
        "ols_occupancy": ols_occ,
        "ols_revenue": ols_rev,
        "selected_structural_clustering": selected_struct,
        "structural_table": json_records(
            struct_screen[["feature_name", "vif_score", "is_selected", "decision_reason"]]
        ),
        "figures": [str(p) for p in figures],
    }
