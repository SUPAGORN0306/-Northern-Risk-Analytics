"""Three family 17 province clustering benchmark in pure NumPy and SciPy with gold persistence and 300 DPI plots."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
import pandas as pd
import seaborn as sns
from scipy.cluster.hierarchy import dendrogram, fcluster, linkage
from scipy.spatial.distance import cdist
from scipy.special import logsumexp

matplotlib.use("Agg")
import matplotlib.pyplot as plt

from src.analytics.eda_deep_insights import analyze_nso_vulnerability_shift
from src.analytics.shock_index import compute_composite_shock_panel
from src.db.connection import bulk_execute, get_connection
from src.transform.panel_builder import (
    build_monthly_analysis_panel,
    build_provincial_structural_profile,
)

BACKEND_DIR = Path(__file__).resolve().parents[2]
FIGURES_DIR = BACKEND_DIR / "reports" / "figures"

CORE_6_FEATURES: tuple[str, ...] = (
    "avg_occupancy_rate",
    "occupancy_volatility",
    "log_foreign_visitor_share",
    "annual_pm25_days_over_37_5",
    "max_monthly_rainfall_mm",
    "debt_to_annual_income_all",
)


def _minmax_0_100(series: pd.Series) -> pd.Series:
    """Scale a numeric series linearly onto 0 to 100 range."""
    lo = float(series.min())
    hi = float(series.max())
    if hi - lo <= 1e-9:
        return pd.Series(50.0, index=series.index)
    return ((series - lo) / (hi - lo)) * 100.0


def _scale_matrix(x_raw: np.ndarray, scaler_name: str) -> np.ndarray:
    """Apply vectorized RobustScaler or StandardScaler without Cython dependencies."""
    if scaler_name == "RobustScaler":
        med = np.median(x_raw, axis=0)
        q75, q25 = np.percentile(x_raw, [75, 25], axis=0)
        iqr = np.where((q75 - q25) <= 1e-9, 1.0, q75 - q25)
        return (x_raw - med) / iqr
    if scaler_name == "StandardScaler":
        mean = np.mean(x_raw, axis=0)
        std = np.std(x_raw, axis=0, ddof=0)
        std = np.where(std <= 1e-9, 1.0, std)
        return (x_raw - mean) / std
    raise ValueError(f"Unsupported scaler {scaler_name}")


def _kmeans_pp_init(x_mat: np.ndarray, k: int, rng: np.random.Generator) -> np.ndarray:
    """Select k initial centroids using KMeans plus plus squared distance probability weighting."""
    n_samples = x_mat.shape[0]
    centroids = np.empty((k, x_mat.shape[1]), dtype=float)
    first_idx = int(rng.integers(0, n_samples))
    centroids[0] = x_mat[first_idx]
    for c_idx in range(1, k):
        dists_sq = np.min(cdist(x_mat, centroids[:c_idx], metric="sqeuclidean"), axis=1)
        total = float(np.sum(dists_sq))
        if total <= 1e-12:
            next_idx = int(rng.integers(0, n_samples))
        else:
            probs = dists_sq / total
            next_idx = int(rng.choice(n_samples, p=probs))
        centroids[c_idx] = x_mat[next_idx]
    return centroids


def _fit_kmeans(x_mat: np.ndarray, k: int, n_init: int = 50, seed: int = 42) -> np.ndarray:
    """Run vectorized KMeans plus plus across multiple random restarts and return lowest inertia labels."""
    rng = np.random.default_rng(seed)
    best_labels = np.zeros(x_mat.shape[0], dtype=int)
    best_inertia = np.inf

    for _ in range(n_init):
        centroids = _kmeans_pp_init(x_mat, k, rng)
        labels = np.zeros(x_mat.shape[0], dtype=int)
        for _step in range(200):
            dists = cdist(x_mat, centroids, metric="sqeuclidean")
            new_labels = np.argmin(dists, axis=1)
            if np.array_equal(new_labels, labels):
                break
            labels = new_labels
            for c_idx in range(k):
                mask = labels == c_idx
                if np.any(mask):
                    centroids[c_idx] = x_mat[mask].mean(axis=0)
                else:
                    # Reassign empty centroid to sample farthest from current centroids
                    min_d = np.min(cdist(x_mat, centroids, metric="sqeuclidean"), axis=1)
                    centroids[c_idx] = x_mat[int(np.argmax(min_d))]
        final_dists = cdist(x_mat, centroids, metric="sqeuclidean")
        inertia = float(np.sum(final_dists[np.arange(x_mat.shape[0]), labels]))
        if inertia < best_inertia:
            best_inertia = inertia
            best_labels = labels.copy()
    return best_labels


def _fit_gmm_diag(
    x_mat: np.ndarray,
    k: int,
    n_init: int = 20,
    reg_covar: float = 1e-3,
    seed: int = 42,
) -> np.ndarray:
    """Run vectorized diagonal Gaussian Mixture EM with log sum exp numerical stability."""
    rng = np.random.default_rng(seed)
    n_samples, n_feats = x_mat.shape
    base_var = np.var(x_mat, axis=0) + reg_covar
    best_labels = np.zeros(n_samples, dtype=int)
    best_ll = -np.inf
    log_2pi = float(np.log(2.0 * np.pi))

    for _ in range(n_init):
        means = _kmeans_pp_init(x_mat, k, rng)
        variances = np.tile(base_var, (k, 1))
        weights = np.full(k, 1.0 / float(k), dtype=float)
        prev_ll = -np.inf

        for _iter in range(150):
            # Vectorized E step computing log Gaussian densities across all k components
            log_prob = np.empty((n_samples, k), dtype=float)
            for c_idx in range(k):
                diff = x_mat - means[c_idx]
                var_c = np.maximum(variances[c_idx], reg_covar)
                log_det = float(np.sum(np.log(var_c)))
                maha = np.sum((diff**2) / var_c, axis=1)
                log_prob[:, c_idx] = (
                    np.log(max(weights[c_idx], 1e-12))
                    - 0.5 * (n_feats * log_2pi + log_det + maha)
                )
            log_norm = logsumexp(log_prob, axis=1, keepdims=True)
            ll = float(np.sum(log_norm))
            resp = np.exp(log_prob - log_norm)

            # Vectorized M step updating mixture weights, means, and diagonal variances
            nk = np.sum(resp, axis=0) + 1e-10
            weights = nk / float(n_samples)
            means = (resp.T @ x_mat) / nk[:, None]
            for c_idx in range(k):
                diff = x_mat - means[c_idx]
                variances[c_idx] = (resp[:, c_idx] @ (diff**2)) / nk[c_idx] + reg_covar

            if abs(ll - prev_ll) < 1e-5:
                break
            prev_ll = ll

        if prev_ll > best_ll:
            best_ll = prev_ll
            best_labels = np.argmax(resp, axis=1)
    return best_labels


def _fit_labels(algo: str, x_mat: np.ndarray, k: int, seed: int = 42) -> np.ndarray:
    """Fit clustering algorithm in pure NumPy and SciPy and return zero indexed integer labels."""
    if algo == "Hierarchical Ward":
        z_mat = linkage(x_mat, method="ward")
        return fcluster(z_mat, t=k, criterion="maxclust") - 1
    if algo == "KMeans":
        return _fit_kmeans(x_mat, k, n_init=50, seed=seed)
    if algo == "GMM Diag":
        return _fit_gmm_diag(x_mat, k, n_init=20, seed=seed)
    raise ValueError(f"Unsupported clustering algorithm {algo}")


def _silhouette_exact(x_mat: np.ndarray, labels: np.ndarray) -> float:
    """Compute exact Euclidean Silhouette score across all samples."""
    unique = np.unique(labels)
    if len(unique) < 2 or len(unique) >= len(labels):
        return 0.0
    dist_mat = cdist(x_mat, x_mat, metric="euclidean")
    scores = np.zeros(len(labels), dtype=float)
    for i in range(len(labels)):
        same_mask = labels == labels[i]
        same_count = int(np.sum(same_mask))
        if same_count <= 1:
            scores[i] = 0.0
            continue
        a_i = float(np.sum(dist_mat[i, same_mask])) / float(same_count - 1)
        b_i = np.inf
        for c_val in unique:
            if c_val == labels[i]:
                continue
            other_mean = float(np.mean(dist_mat[i, labels == c_val]))
            if other_mean < b_i:
                b_i = other_mean
        denom = max(a_i, b_i)
        scores[i] = (b_i - a_i) / denom if denom > 1e-12 else 0.0
    return float(np.mean(scores))


def _davies_bouldin_exact(x_mat: np.ndarray, labels: np.ndarray) -> float:
    """Compute exact Davies Bouldin Index where lower values indicate tighter cluster separation."""
    unique = np.unique(labels)
    k = len(unique)
    if k < 2:
        return 99.0
    centroids = np.array([x_mat[labels == c].mean(axis=0) for c in unique])
    scatters = np.array(
        [float(np.mean(np.linalg.norm(x_mat[labels == c] - centroids[idx], axis=1))) for idx, c in enumerate(unique)]
    )
    c_dists = cdist(centroids, centroids, metric="euclidean")
    db_vals: list[float] = []
    for i in range(k):
        max_r = 0.0
        for j in range(k):
            if i == j:
                continue
            denom = max(float(c_dists[i, j]), 1e-12)
            ratio = (scatters[i] + scatters[j]) / denom
            if ratio > max_r:
                max_r = ratio
        db_vals.append(max_r)
    return float(np.mean(db_vals))


def _calinski_harabasz_exact(x_mat: np.ndarray, labels: np.ndarray) -> float:
    """Compute exact Calinski Harabasz variance ratio criterion."""
    unique = np.unique(labels)
    k = len(unique)
    n = len(labels)
    if k < 2 or k >= n:
        return 0.0
    overall_mean = x_mat.mean(axis=0)
    between = 0.0
    within = 0.0
    for c in unique:
        pts = x_mat[labels == c]
        c_mean = pts.mean(axis=0)
        between += float(len(pts)) * float(np.sum((c_mean - overall_mean) ** 2))
        within += float(np.sum((pts - c_mean) ** 2))
    if within <= 1e-12:
        return 0.0
    return (between / float(k - 1)) / (within / float(n - k))


def _adjusted_rand_exact(labels_a: np.ndarray, labels_b: np.ndarray) -> float:
    """Compute exact Adjusted Rand Index measuring agreement between two cluster partitions."""
    n = len(labels_a)
    if n < 2:
        return 1.0
    _, inv_a = np.unique(labels_a, return_inverse=True)
    _, inv_b = np.unique(labels_b, return_inverse=True)
    n_a = int(inv_a.max()) + 1
    n_b = int(inv_b.max()) + 1
    cont = np.zeros((n_a, n_b), dtype=np.int64)
    np.add.at(cont, (inv_a, inv_b), 1)

    def _comb2(arr: np.ndarray) -> float:
        return float(np.sum(arr * (arr - 1) // 2))

    sum_comb = _comb2(cont)
    sum_a = _comb2(cont.sum(axis=1))
    sum_b = _comb2(cont.sum(axis=0))
    total_pairs = float(n * (n - 1) // 2)
    expected = (sum_a * sum_b) / total_pairs if total_pairs > 0 else 0.0
    max_idx = 0.5 * (sum_a + sum_b)
    if abs(max_idx - expected) <= 1e-12:
        return 1.0 if sum_comb == max_idx else 0.0
    return (sum_comb - expected) / (max_idx - expected)


def _perturbation_stability_ari(
    algo: str,
    x_mat: np.ndarray,
    base_labels: np.ndarray,
    k: int,
    n_trials: int = 30,
    noise_std: float = 0.15,
) -> float:
    """Measure partition stability via mean Adjusted Rand Index under feature perturbation."""
    rng = np.random.default_rng(42)
    aris: list[float] = []
    for trial in range(n_trials):
        perturbed = x_mat + rng.normal(0.0, noise_std, size=x_mat.shape)
        try:
            trial_labels = _fit_labels(algo, perturbed, k, seed=100 + trial)
            aris.append(_adjusted_rand_exact(base_labels, trial_labels))
        except Exception:
            continue
    return float(np.mean(aris)) if aris else 0.0


def prepare_clustering_matrix() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Build 17 province feature table enriched with shock intensity, exposure score, and NSO shifts."""
    panel = build_monthly_analysis_panel()
    shock_df, _ = compute_composite_shock_panel(panel)
    struct = build_provincial_structural_profile(panel)
    nso_shift = analyze_nso_vulnerability_shift()

    # Aggregate 34 month empirical shock intensity per province
    shock_agg = shock_df.groupby("province_code", as_index=False).agg(
        mean_shock_idx=("composite_shock_idx", "mean"),
        p90_shock_idx=("composite_shock_idx", lambda s: float(np.nanpercentile(s, 90))),
        peak_shock_idx=("composite_shock_idx", "max"),
    )
    df = struct.merge(shock_agg, on="province_code", how="left").merge(
        nso_shift[["province_code", "dti_sme_delta", "cushion_all_2025", "cushion_sme_2025"]],
        on="province_code",
        how="left",
    )

    # Apply log1p transform validated by Step 5B skewness audit reducing skew from 1.59 to 0.49
    df["log_foreign_visitor_share"] = np.log1p(df["foreign_visitor_share"].clip(lower=0.0))

    # Construct 0 to 100 quadrant axes separating physical hazard intensity from exposure and fragility
    df["shock_intensity"] = (
        0.35 * _minmax_0_100(df["annual_pm25_days_over_37_5"])
        + 0.25 * _minmax_0_100(df["annual_pm25_days_over_75_0"])
        + 0.20 * _minmax_0_100(df["max_monthly_rainfall_mm"])
        + 0.20 * _minmax_0_100(df["p90_shock_idx"])
    ).round(2)

    df["exposure_score"] = (
        0.25 * _minmax_0_100(df["avg_occupancy_rate"])
        + 0.25 * _minmax_0_100(df["occupancy_volatility"])
        + 0.20 * _minmax_0_100(df["log_foreign_visitor_share"])
        + 0.20 * _minmax_0_100(df["debt_to_annual_income_all"])
        + 0.10 * _minmax_0_100(df["expense_to_income_pct_all"])
    ).round(2)

    return df.sort_values("province_code").reset_index(drop=True), shock_df


def benchmark_clustering_models(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any], np.ndarray, np.ndarray]:
    """Benchmark Ward, KMeans, and diagonal GMM across scalers and k from 2 to 5."""
    x_raw = df[list(CORE_6_FEATURES)].to_numpy(dtype=float)
    scaler_names = ["RobustScaler", "StandardScaler"]
    algos = ["Hierarchical Ward", "KMeans", "GMM Diag"]

    records: list[dict[str, Any]] = []
    cached_outputs: dict[tuple[str, str, int], tuple[np.ndarray, np.ndarray]] = {}

    for scaler_name in scaler_names:
        x_scaled = _scale_matrix(x_raw, scaler_name)
        for algo in algos:
            for k in range(2, 6):
                labels = _fit_labels(algo, x_scaled, k, seed=42)
                unique_c, counts = np.unique(labels, return_counts=True)
                actual_k = len(unique_c)
                min_sz = int(counts.min())
                sil = _silhouette_exact(x_scaled, labels) if actual_k >= 2 else 0.0
                dbi = _davies_bouldin_exact(x_scaled, labels) if actual_k >= 2 else 99.0
                ch = _calinski_harabasz_exact(x_scaled, labels) if actual_k >= 2 else 0.0
                ari = _perturbation_stability_ari(algo, x_scaled, labels, k)
                records.append(
                    {
                        "algorithm": algo,
                        "scaler": scaler_name,
                        "k": k,
                        "actual_k": actual_k,
                        "silhouette": round(sil, 4),
                        "davies_bouldin": round(dbi, 4),
                        "calinski_harabasz": round(ch, 2),
                        "stability_ari": round(ari, 4),
                        "min_cluster_size": min_sz,
                        "cluster_sizes": [int(c) for c in sorted(counts, reverse=True)],
                    }
                )
                cached_outputs[(algo, scaler_name, k)] = (labels, x_scaled)

    bench_df = pd.DataFrame(records)

    # Select winner among actionable multi group tiers k in 3 or 4 with no singleton cluster preferred
    eligible = bench_df[
        (bench_df["k"].isin([3, 4])) & (bench_df["actual_k"] == bench_df["k"]) & (bench_df["min_cluster_size"] >= 2)
    ].copy()
    if eligible.empty:
        eligible = bench_df[(bench_df["k"].isin([3, 4])) & (bench_df["actual_k"] == bench_df["k"])].copy()

    eligible["rank_sil"] = eligible["silhouette"].rank(ascending=False)
    eligible["rank_dbi"] = eligible["davies_bouldin"].rank(ascending=True)
    eligible["rank_ch"] = eligible["calinski_harabasz"].rank(ascending=False)
    eligible["rank_ari"] = eligible["stability_ari"].rank(ascending=False)
    eligible["composite_rank"] = (
        0.35 * eligible["rank_sil"]
        + 0.25 * eligible["rank_dbi"]
        + 0.15 * eligible["rank_ch"]
        + 0.25 * eligible["rank_ari"]
    )
    winner_row = eligible.sort_values(["composite_rank", "silhouette"], ascending=[True, False]).iloc[0]
    winner_dict = winner_row.to_dict()
    win_key = (str(winner_dict["algorithm"]), str(winner_dict["scaler"]), int(winner_dict["k"]))
    win_labels, win_x_scaled = cached_outputs[win_key]
    return bench_df, winner_dict, win_labels, win_x_scaled


def assign_domain_labels_and_policies(df: pd.DataFrame, labels: np.ndarray) -> pd.DataFrame:
    """Assign clean policy labels and tailored relief prescriptions from empirical cluster centroids."""
    out = df.copy()
    out["raw_cluster"] = labels

    # Summarize centroids in interpretable physical and financial units
    cent = out.groupby("raw_cluster", as_index=False).agg(
        n_prov=("province_code", "count"),
        occ=("avg_occupancy_rate", "mean"),
        vol=("occupancy_volatility", "mean"),
        foreign=("foreign_visitor_share", "mean"),
        pm25=("annual_pm25_days_over_37_5", "mean"),
        rain=("max_monthly_rainfall_mm", "mean"),
        debt_all=("debt_to_annual_income_all", "mean"),
        debt_sme=("debt_to_annual_income_sme", "mean"),
        exp_all=("expense_to_income_pct_all", "mean"),
        shock_int=("shock_intensity", "mean"),
        exp_sc=("exposure_score", "mean"),
    )

    # Order cluster IDs deterministically from highest combined exposure plus shock risk downward
    cent["risk_rank_score"] = cent["shock_int"] + cent["exp_sc"]
    cent = cent.sort_values("risk_rank_score", ascending=False).reset_index(drop=True)
    id_remap = {int(r["raw_cluster"]): int(idx + 1) for idx, r in cent.iterrows()}
    out["cluster_id"] = out["raw_cluster"].map(id_remap)
    cent["cluster_id"] = cent["raw_cluster"].map(id_remap)

    label_map: dict[int, str] = {}
    policy_map: dict[int, str] = {}
    used_labels: set[str] = set()

    for _, r in cent.iterrows():
        cid = int(r["cluster_id"])
        if r["foreign"] >= 10.0 and r["occ"] >= 58.0 and "International Tourism Hub" not in used_labels:
            lbl = "International Tourism Hub"
            pol = (
                "Deploy rapid working capital liquidity bridges during March to April severe haze "
                "and flash flood peaks, paired with short term principal grace periods for hotels and service operators."
            )
        elif r["debt_all"] >= 0.70 and r["pm25"] >= 30.0 and "High Debt Chronic Haze Belt" not in used_labels:
            lbl = "High Debt Chronic Haze Belt"
            pol = (
                "Prioritize structural debt restructuring, interest rate reduction, and responsible lending clinics "
                "for leveraged households and SMEs facing prolonged orange level PM2.5 exposure."
            )
        elif r["vol"] >= 7.5 and "Secondary Domestic Tourism Corridor" not in used_labels:
            lbl = "Secondary Domestic Tourism Corridor"
            pol = (
                "Provide seasonal cash flow smoothing facilities and standby post flood SME rehabilitation credit "
                "for domestic tourism operators facing winter to summer occupancy swings and localized runoff."
            )
        elif r["debt_all"] >= 0.58 and "Elevated Debt Domestic Basin" not in used_labels:
            lbl = "Elevated Debt Domestic Basin"
            pol = (
                "Target preventive household debt consolidation and SME liquidity cushions to protect thin cash margins "
                "against inflation, energy cost spikes, and chronic orange level haze."
            )
        else:
            lbl = f"Moderate Exposure Domestic Basin {cid}"
            pol = (
                "Maintain baseline hazard monitoring, financial literacy outreach, and standby micro liquidity lines "
                "for domestic service businesses during peak haze and monsoon windows."
            )
        used_labels.add(lbl)
        label_map[cid] = lbl
        policy_map[cid] = pol

    out["cluster_label"] = out["cluster_id"].map(label_map)

    # Append province specific verified NSO financial fragility alerts with zero hyphens or restricted acronyms
    policies: list[str] = []
    for _, r in out.iterrows():
        base_pol = policy_map[int(r["cluster_id"])]
        code = str(r["province_code"])
        notes: list[str] = []
        if float(r["debt_to_annual_income_sme"]) >= 1.0:
            notes.append(
                f"Urgent SME alert in {r['name_en']} with SME debt at {r['debt_to_annual_income_sme']:.2f}x annual income "
                f"and {r['expense_to_income_pct_sme']:.0f} percent expense ratio."
            )
        elif float(r["expense_to_income_pct_sme"]) >= 88.0:
            notes.append(
                f"Thin SME cash buffer in {r['name_en']} with {r['expense_to_income_pct_sme']:.0f} percent expense ratio "
                f"and {r['annual_pm25_days_over_37_5']:.0f} orange haze days per year."
            )
        elif float(r["expense_to_income_pct_all"]) >= 84.0:
            notes.append(
                f"Thin household cash cushion in {r['name_en']} at {r['expense_to_income_pct_all']:.0f} percent expense ratio "
                f"requiring fast temporary liquidity relief during shocks."
            )
        elif code == "CR":
            notes.append(
                "High acute shock sensitivity to both September river flooding and March to April red level PM2.5."
            )
        policies.append(" ".join([base_pol] + notes))

    out["recommended_policy"] = policies
    return out


def save_clusters_to_neon(
    clustered_df: pd.DataFrame,
    bench_df: pd.DataFrame,
    winner: dict[str, Any],
) -> int:
    """Persist winning 17 province cluster assignments into gold.province_clusters and log benchmark."""
    model_str = f"{winner['algorithm']} (k={int(winner['k'])}, {winner['scaler']})"
    sil_val = float(winner["silhouette"])

    with get_connection() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM gold.province_clusters")
        cur.close()

    rows = [
        {
            "province_code": str(r["province_code"]),
            "model_used": model_str,
            "cluster_id": int(r["cluster_id"]),
            "cluster_label": str(r["cluster_label"]),
            "shock_intensity": float(r["shock_intensity"]),
            "exposure_score": float(r["exposure_score"]),
            "silhouette_score": sil_val,
            "recommended_policy": str(r["recommended_policy"]),
        }
        for _, r in clustered_df.iterrows()
    ]

    insert_sql = """
        INSERT INTO gold.province_clusters (
            province_code, model_used, cluster_id, cluster_label,
            shock_intensity, exposure_score, silhouette_score, recommended_policy
        ) VALUES (
            :province_code, :model_used, :cluster_id, :cluster_label,
            :shock_intensity, :exposure_score, :silhouette_score, :recommended_policy
        )
    """
    saved = bulk_execute(insert_sql, rows)

    eval_payload = {
        "winner": winner,
        "features": list(CORE_6_FEATURES),
        "all_24_benchmarks": bench_df.to_dict(orient="records"),
    }
    bulk_execute(
        """
        INSERT INTO gold.pipeline_eval_runs (run_type, metrics_json, token_count, estimated_cost_thb)
        VALUES (:run_type, CAST(:metrics_json AS JSONB), 0, 0.0)
        """,
        [
            {
                "run_type": "clustering_benchmark",
                "metrics_json": json.dumps(eval_payload, ensure_ascii=False),
            }
        ],
    )
    return saved


def plot_clustering_figures(
    clustered_df: pd.DataFrame,
    bench_df: pd.DataFrame,
    winner: dict[str, Any],
    win_x_scaled: np.ndarray,
) -> Path:
    """Generate 300 DPI 4 panel clustering benchmark, dendrogram, PCA projection, and risk quadrant."""
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid", context="notebook")
    navy = "#0F2537"
    cluster_palette = {1: "#DC2626", 2: "#D97706", 3: "#0D9488", 4: "#2563EB", 5: "#7C3AED"}

    fig, axes = plt.subplots(2, 2, figsize=(17.2, 11.4), dpi=300)

    # Panel A benchmark silhouette score comparison across 3 model families using winning scaler
    win_scaler = str(winner["scaler"])
    b_sub = bench_df[bench_df["scaler"] == win_scaler]
    algo_colors = {"Hierarchical Ward": navy, "KMeans": "#0D9488", "GMM Diag": "#D97706"}
    for algo, col in algo_colors.items():
        sub = b_sub[b_sub["algorithm"] == algo].sort_values("k")
        axes[0, 0].plot(
            sub["k"],
            sub["silhouette"],
            marker="o",
            linewidth=2.2,
            markersize=7,
            color=col,
            label=f"{algo} (Silhouette)",
        )
        axes[0, 0].plot(
            sub["k"],
            sub["stability_ari"] * 0.5,
            linestyle="--",
            marker="s",
            linewidth=1.3,
            markersize=4.5,
            color=col,
            alpha=0.55,
            label=f"{algo} (0.5 x Stability ARI)",
        )
    axes[0, 0].scatter(
        [int(winner["k"])],
        [float(winner["silhouette"])],
        s=220,
        facecolor="none",
        edgecolor="#DC2626",
        linewidth=2.4,
        zorder=6,
        label=f"Winner {winner['algorithm']} k={int(winner['k'])}",
    )
    axes[0, 0].set_xticks([2, 3, 4, 5])
    axes[0, 0].set_xlabel("Number of Clusters (k)")
    axes[0, 0].set_ylabel("Score (Silhouette / 0.5 x ARI)")
    axes[0, 0].set_title(
        f"A. 3 Family Clustering Benchmark ({win_scaler})\n"
        f"(Winner Sil={winner['silhouette']:.3f}, DBI={winner['davies_bouldin']:.3f}, ARI={winner['stability_ari']:.3f})",
        fontsize=10.5,
        fontweight="bold",
        color=navy,
    )
    axes[0, 0].legend(loc="lower left", fontsize=7.4, ncol=2, frameon=True)

    # Panel B Hierarchical Ward dendrogram on winning scaled space
    z_mat = linkage(win_x_scaled, method="ward")
    win_k = int(winner["k"])
    cut_dist = 0.5 * (z_mat[-(win_k), 2] + z_mat[-(win_k - 1), 2]) if win_k >= 2 else z_mat[-1, 2]
    dendrogram(
        z_mat,
        labels=clustered_df["province_code"].tolist(),
        color_threshold=cut_dist,
        above_threshold_color="#64748B",
        leaf_font_size=9.2,
        ax=axes[0, 1],
    )
    axes[0, 1].axhline(cut_dist, color="#DC2626", linestyle="--", linewidth=1.4, label=f"k = {win_k} Cut Threshold")
    axes[0, 1].set_title(
        f"B. Hierarchical Ward Dendrogram of 17 Northern Provinces\n({win_scaler}, log1p Foreign Share)",
        fontsize=10.5,
        fontweight="bold",
        color=navy,
    )
    axes[0, 1].set_ylabel("Ward Linkage Distance")
    axes[0, 1].legend(loc="upper right", fontsize=8.4, frameon=True)

    # Panel C PCA 2D projection via SVD showing real geometric separation
    x_cent = win_x_scaled - win_x_scaled.mean(axis=0)
    u_mat, s_vals, _ = np.linalg.svd(x_cent, full_matrices=False)
    coords = u_mat[:, :2] * s_vals[:2]
    var_pct = ((s_vals**2) / np.sum(s_vals**2)) * 100.0
    plot_df = clustered_df.copy()
    plot_df["pc1"] = coords[:, 0]
    plot_df["pc2"] = coords[:, 1]

    for cid, grp in plot_df.groupby("cluster_id"):
        col = cluster_palette.get(int(cid), navy)
        lbl = f"C{int(cid)} {grp['cluster_label'].iloc[0]} (n={len(grp)})"
        axes[1, 0].scatter(
            grp["pc1"],
            grp["pc2"],
            s=115,
            color=col,
            alpha=0.88,
            edgecolor="white",
            linewidth=1.0,
            label=lbl,
            zorder=4,
        )
        axes[1, 0].scatter(
            [grp["pc1"].mean()],
            [grp["pc2"].mean()],
            marker="X",
            s=175,
            color=col,
            edgecolor=navy,
            linewidth=1.0,
            zorder=5,
        )
    for _, r in plot_df.iterrows():
        axes[1, 0].annotate(
            r["province_code"],
            (r["pc1"], r["pc2"]),
            xytext=(6, 4),
            textcoords="offset points",
            fontsize=8.6,
            fontweight="bold",
            color=navy,
        )
    axes[1, 0].axhline(0.0, color="#94A3B8", linestyle=":", linewidth=0.9)
    axes[1, 0].axvline(0.0, color="#94A3B8", linestyle=":", linewidth=0.9)
    axes[1, 0].set_xlabel(f"PC1 ({var_pct[0]:.1f}% Variance)")
    axes[1, 0].set_ylabel(f"PC2 ({var_pct[1]:.1f}% Variance)")
    axes[1, 0].set_title(
        f"C. PCA 2D Cluster Separation ({var_pct[0] + var_pct[1]:.1f}% Total Variance Captured)\n"
        f"(Model {winner['algorithm']}, k={win_k}, {win_scaler})",
        fontsize=10.5,
        fontweight="bold",
        color=navy,
    )
    axes[1, 0].legend(loc="best", fontsize=7.8, frameon=True, framealpha=0.92)

    # Panel D 4 quadrant policy monitor risk map shock intensity vs exposure score
    med_x = float(plot_df["shock_intensity"].median())
    med_y = float(plot_df["exposure_score"].median())
    axes[1, 1].axvline(med_x, color="#64748B", linestyle="--", linewidth=1.1)
    axes[1, 1].axhline(med_y, color="#64748B", linestyle="--", linewidth=1.1)

    legend_handles = []
    for cid, grp in plot_df.groupby("cluster_id"):
        col = cluster_palette.get(int(cid), navy)
        sizes = np.clip(np.sqrt(grp["avg_monthly_revenue_mthb"]) * 12.5, 65, 430)
        axes[1, 1].scatter(
            grp["shock_intensity"],
            grp["exposure_score"],
            s=sizes,
            color=col,
            alpha=0.84,
            edgecolor=navy,
            linewidth=0.9,
            zorder=4,
        )
        legend_handles.append(
            plt.Line2D(
                [0],
                [0],
                marker="o",
                color="w",
                markerfacecolor=col,
                markeredgecolor=navy,
                markersize=7.5,
                label=f"C{int(cid)} {grp['cluster_label'].iloc[0]}",
            )
        )
    custom_offsets = {
        "CM": (11, 4),
        "CR": (11, 4),
        "TK": (-22, 6),
        "PR": (8, 5),
        "PB": (8, -11),
        "UN": (7, 6),
        "UT": (7, -10),
        "PL": (-26, 4),
    }
    for _, r in plot_df.iterrows():
        code = str(r["province_code"])
        dx, dy = custom_offsets.get(code, (7, 4))
        tag = f"{code}*" if code in {"PL", "KP", "CM"} else code
        axes[1, 1].annotate(
            tag,
            (r["shock_intensity"], r["exposure_score"]),
            xytext=(dx, dy),
            textcoords="offset points",
            fontsize=8.5,
            fontweight="bold",
            color=navy,
        )

    axes[1, 1].set_xlim(max(0.0, plot_df["shock_intensity"].min() - 10.0), min(105.0, plot_df["shock_intensity"].max() + 12.0))
    axes[1, 1].set_ylim(max(0.0, plot_df["exposure_score"].min() - 10.0), min(105.0, plot_df["exposure_score"].max() + 12.0))
    axes[1, 1].text(0.98, 0.96, "Priority Relief Zone", transform=axes[1, 1].transAxes, ha="right", va="top", fontsize=8.5, fontweight="bold", color="#DC2626")
    axes[1, 1].text(0.02, 0.04, "Monitor Zone", transform=axes[1, 1].transAxes, ha="left", va="bottom", fontsize=8.5, fontweight="bold", color="#64748B")
    axes[1, 1].set_xlabel("Physical Hazard and Shock Intensity Score (0 to 100)")
    axes[1, 1].set_ylabel("Tourism Exposure and Debt Vulnerability Score (0 to 100)")
    axes[1, 1].set_title(
        "D. 4 Quadrant Policy Risk Map Across 17 Northern Provinces\n"
        "(Bubble = Revenue, * = NSO Thin Cash Buffer Alert PL, KP, CM)",
        fontsize=10.5,
        fontweight="bold",
        color=navy,
    )
    axes[1, 1].legend(handles=legend_handles, loc="lower right", fontsize=7.6, frameon=True, framealpha=0.94)

    fig.suptitle(
        "Step 6B 17 Province Risk Clustering Benchmark, Dendrogram, and Policy Quadrant",
        fontsize=13,
        fontweight="bold",
        color=navy,
        y=1.005,
    )
    plt.tight_layout()
    out_path = FIGURES_DIR / "04_clustering_dendrogram_quadrant.png"
    fig.savefig(out_path, dpi=300, bbox_inches="tight")
    plt.close(fig)
    return out_path


def run_clustering_pipeline() -> dict[str, Any]:
    """Execute 3 family clustering benchmark, persist gold.province_clusters, and plot 300 DPI summary."""
    df, _ = prepare_clustering_matrix()
    bench_df, winner, win_labels, win_x_scaled = benchmark_clustering_models(df)
    clustered_df = assign_domain_labels_and_policies(df, win_labels)
    saved = save_clusters_to_neon(clustered_df, bench_df, winner)
    fig_path = plot_clustering_figures(clustered_df, bench_df, winner, win_x_scaled)

    cluster_summary = (
        clustered_df.groupby(["cluster_id", "cluster_label"], as_index=False)
        .agg(
            n_provinces=("province_code", "count"),
            provinces=("province_code", lambda s: ", ".join(sorted(s))),
            avg_occ=("avg_occupancy_rate", "mean"),
            avg_vol=("occupancy_volatility", "mean"),
            avg_foreign=("foreign_visitor_share", "mean"),
            avg_pm25_days=("annual_pm25_days_over_37_5", "mean"),
            avg_max_rain=("max_monthly_rainfall_mm", "mean"),
            avg_debt_all=("debt_to_annual_income_all", "mean"),
            avg_debt_sme=("debt_to_annual_income_sme", "mean"),
            avg_shock_intensity=("shock_intensity", "mean"),
            avg_exposure_score=("exposure_score", "mean"),
        )
        .round(2)
    )

    return {
        "rows_saved_gold_clusters": saved,
        "winner": winner,
        "top8_benchmarks": bench_df.sort_values(["silhouette", "stability_ari"], ascending=False)
        .head(8)
        .to_dict(orient="records"),
        "all_24_benchmarks": bench_df.to_dict(orient="records"),
        "cluster_summary": cluster_summary.to_dict(orient="records"),
        "province_assignments": clustered_df[
            [
                "province_code",
                "name_en",
                "subregion",
                "cluster_id",
                "cluster_label",
                "shock_intensity",
                "exposure_score",
                "recommended_policy",
            ]
        ].to_dict(orient="records"),
        "figure": str(fig_path),
    }
