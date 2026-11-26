"""Validated feature specification registry loaded directly from feature_specs.yaml."""

from __future__ import annotations

import os
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

BACKEND_DIR = Path(__file__).resolve().parents[2]
FEATURE_SPECS_PATH = BACKEND_DIR / "config" / "feature_specs.yaml"

REQUIRED_POLICY_KEYS = (
    "multiple_testing_correction",
    "alpha_threshold",
    "max_vif",
    "max_pairwise_spearman",
    "max_missing_pct",
    "time_split_train_ratio",
)
REQUIRED_FEATURE_KEYS = (
    "feature_id",
    "version",
    "source",
    "grain",
    "unit",
    "missing_policy",
    "allowed_range",
    "candidate_lags_months",
)


@lru_cache(maxsize=1)
def load_feature_specs(path: Path | None = None) -> dict[str, Any]:
    """Load and validate feature_specs.yaml so analytics pipelines share one source of truth."""
    target = path or FEATURE_SPECS_PATH
    if not target.exists():
        raise FileNotFoundError(f"Feature specification file not found at {target}")

    raw = yaml.safe_load(target.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("feature_specs.yaml must parse to a mapping object")

    spec_version = str(raw.get("spec_version") or "").strip()
    if not spec_version:
        raise ValueError("feature_specs.yaml must define a non empty spec_version")

    policy = raw.get("validation_policy")
    if not isinstance(policy, dict):
        raise ValueError("feature_specs.yaml must define validation_policy")
    for key in REQUIRED_POLICY_KEYS:
        if key not in policy:
            raise ValueError(f"validation_policy missing required key {key}")

    alpha = float(policy["alpha_threshold"])
    max_vif = float(policy["max_vif"])
    train_ratio = float(policy["time_split_train_ratio"])
    if not (0.0 < alpha < 0.5):
        raise ValueError(f"alpha_threshold out of valid bounds ({alpha})")
    if max_vif <= 1.0:
        raise ValueError(f"max_vif must exceed 1.0 ({max_vif})")
    if not (0.5 <= train_ratio <= 0.9):
        raise ValueError(f"time_split_train_ratio must sit between 0.5 and 0.9 ({train_ratio})")

    features = raw.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("feature_specs.yaml must define a non empty features list")

    seen_ids: set[str] = set()
    for item in features:
        if not isinstance(item, dict):
            raise ValueError("Each feature entry in feature_specs.yaml must be a mapping")
        for key in REQUIRED_FEATURE_KEYS:
            if key not in item:
                raise ValueError(f"Feature entry missing required key {key}")
        fid = str(item["feature_id"])
        if fid in seen_ids:
            raise ValueError(f"Duplicate feature_id in feature_specs.yaml ({fid})")
        seen_ids.add(fid)
        rng = item["allowed_range"]
        if not isinstance(rng, list) or len(rng) != 2 or float(rng[0]) >= float(rng[1]):
            raise ValueError(f"Invalid allowed_range for feature {fid}")

    return raw


def get_spec_version() -> str:
    """Return active feature specification version string from feature_specs.yaml."""
    return str(load_feature_specs()["spec_version"])


def get_validation_policy() -> dict[str, Any]:
    """Return validated statistical policy thresholds from feature_specs.yaml."""
    policy = load_feature_specs()["validation_policy"]
    return {
        "multiple_testing_correction": str(policy["multiple_testing_correction"]),
        "alpha_threshold": float(policy["alpha_threshold"]),
        "max_vif": float(policy["max_vif"]),
        "ols_max_vif": float(policy.get("ols_max_vif", 6.0)),
        "max_pairwise_spearman": float(policy["max_pairwise_spearman"]),
        "max_missing_pct": float(policy["max_missing_pct"]),
        "time_split_train_ratio": float(policy["time_split_train_ratio"]),
        "scope_classification": str(policy.get("scope_classification", "exploratory_within_province_screening")),
    }


def get_data_quality_policy() -> dict[str, Any]:
    """Return configured pre-publish freshness and coverage limits."""
    raw = load_feature_specs().get("data_quality_policy")
    if not isinstance(raw, dict):
        raise ValueError("feature_specs.yaml must define data_quality_policy")
    expected_provinces = int(raw.get("expected_northern_provinces", 0))
    air_min_coverage = int(raw.get("air_daily_min_coverage_provinces", 0))
    air_age_hours = float(raw.get("air_daily_max_age_hours", 0))
    max_age_days = raw.get("provincial_max_age_days")
    macro_age_days = float(raw.get("macro_controls_max_age_days", 0))
    if expected_provinces <= 0 or not (1 <= air_min_coverage <= expected_provinces) or air_age_hours <= 0 or macro_age_days <= 0:
        raise ValueError("data_quality_policy must define positive coverage and freshness limits")
    if not isinstance(max_age_days, dict) or not max_age_days:
        raise ValueError("data_quality_policy.provincial_max_age_days must be a non-empty mapping")
    if any(float(days) <= 0 for days in max_age_days.values()):
        raise ValueError("All provincial source freshness limits must be positive")
    return {
        "expected_northern_provinces": expected_provinces,
        "air_daily_min_coverage_provinces": air_min_coverage,
        "air_daily_max_age_hours": air_age_hours,
        "provincial_max_age_days": {str(key): float(value) for key, value in max_age_days.items()},
        "macro_controls_max_age_days": macro_age_days,
    }


def get_eda_inference_policy() -> dict[str, Any]:
    """Return inference resampling settings from the canonical feature spec."""
    raw = load_feature_specs().get("eda_inference_policy")
    if not isinstance(raw, dict):
        raise ValueError("feature_specs.yaml must define eda_inference_policy")
    policy = {
        "block_permutation_replicates": int(raw.get("block_permutation_replicates", 0)),
        "block_length_months": int(raw.get("block_length_months", 0)),
        "wild_cluster_bootstrap_replicates": int(raw.get("wild_cluster_bootstrap_replicates", 0)),
        "minimum_observations": int(raw.get("minimum_observations", 0)),
        "minimum_province_clusters_for_confirmatory_inference": int(
            raw.get("minimum_province_clusters_for_confirmatory_inference", 0)
        ),
    }
    if any(value <= 0 for value in policy.values()):
        raise ValueError("eda_inference_policy values must all be positive")
    return policy


def get_scoring_policy() -> dict[str, Any]:
    """Return descriptive screening index weights and tier cutoffs from feature_specs.yaml."""
    raw = load_feature_specs()
    scoring = dict(raw.get("scoring_policy") or {})
    for group_name in ("composite_weights", "cashflow_subweights", "demand_subweights", "hazard_subweights"):
        group = scoring.get(group_name)
        if not isinstance(group, dict) or not group:
            raise ValueError(f"scoring_policy.{group_name} must be a non-empty weight mapping")
        values = [float(value) for value in group.values()]
        if any(value < 0 for value in values) or abs(sum(values) - 1.0) > 1e-6:
            raise ValueError(f"scoring_policy.{group_name} weights must be non-negative and sum to 1")
    tiers = scoring.get("tier_thresholds") or {}
    tier_values = [float(tiers[key]) for key in ("tier1_min_score", "tier2_min_score", "tier3_min_score")]
    if not (100.0 >= tier_values[0] >= tier_values[1] >= tier_values[2] >= 0.0):
        raise ValueError("scoring_policy.tier_thresholds must descend within the 0–100 score range")
    scales = scoring.get("score_scales") or {}
    if any(float(value) <= 0 for value in scales.values()):
        raise ValueError("scoring_policy.score_scales must be positive")
    scenarios = scoring.get("sensitivity_scenarios")
    baseline = scenarios.get("baseline_55_25_20") if isinstance(scenarios, dict) else None
    composite = scoring["composite_weights"]
    expected_baseline = [
        float(composite["cashflow_debt"]),
        float(composite["tourism_exposure"]),
        float(composite["hazard_news"]),
    ]
    if not isinstance(baseline, list) or len(baseline) != 3 or any(
        abs(float(actual) - expected) > 1e-6 for actual, expected in zip(baseline, expected_baseline)
    ):
        raise ValueError("The baseline sensitivity scenario must match scoring_policy.composite_weights")
    return scoring


def get_shock_index_policy() -> dict[str, Any]:
    """Return composite shock index calibration parameters from feature_specs.yaml."""
    raw = load_feature_specs()
    policy = dict(raw.get("shock_index_policy") or {})
    for group_name in ("flood_component_weights", "macro_component_weights"):
        group = policy.get(group_name)
        values = [float(value) for value in group.values()] if isinstance(group, dict) else []
        if not values or any(value < 0 for value in values) or abs(sum(values) - 1.0) > 1e-6:
            raise ValueError(f"shock_index_policy.{group_name} weights must be non-negative and sum to 1")
    haze_weights = policy.get("haze_component_weights")
    haze_values = [float(value) for value in haze_weights.values()] if isinstance(haze_weights, dict) else []
    if not haze_values or any(value < 0 for value in haze_values) or sum(haze_values) > 1.0:
        raise ValueError("shock_index_policy.haze_component_weights must be non-negative and sum to <= 1")
    quantile = float(policy.get("flood_tail_quantile", 0))
    if not (0.0 < quantile < 1.0):
        raise ValueError("shock_index_policy.flood_tail_quantile must be between 0 and 1")
    report_quantile = float(policy.get("flood_tail_report_quantile", 0))
    if not (quantile <= report_quantile < 1.0):
        raise ValueError("shock_index_policy.flood_tail_report_quantile must be >= flood_tail_quantile and < 1")
    bounds = policy.get("macro_weight_bounds") or []
    if len(bounds) != 2 or not (0 <= float(bounds[0]) <= float(bounds[1]) <= 1):
        raise ValueError("shock_index_policy.macro_weight_bounds must be an ordered pair within [0, 1]")
    return policy


def get_feature_spec_map() -> dict[str, dict[str, Any]]:
    """Return mapping of feature_id to its specification metadata."""
    specs = load_feature_specs()["features"]
    return {str(item["feature_id"]): dict(item) for item in specs}


def get_clustering_core_features() -> tuple[str, ...]:
    """Return validated canonical clustering feature tuple shared across EDA, batch clustering, and web lab."""
    raw = load_feature_specs()
    core = raw.get("clustering_core_features")
    if not isinstance(core, list) or len(core) < 3:
        raise ValueError("feature_specs.yaml must define clustering_core_features with at least 3 features")
    spec_map = get_feature_spec_map()
    missing = [str(fid) for fid in core if str(fid) not in spec_map]
    if missing:
        raise ValueError(f"clustering_core_features references unregistered feature_ids {missing}")
    return tuple(str(fid) for fid in core)


def get_clustering_policy() -> dict[str, Any]:
    """Return clustering score weights and model-selection guardrails from the canonical feature spec."""
    policy = load_feature_specs().get("clustering_policy")
    if not isinstance(policy, dict):
        raise ValueError("feature_specs.yaml must define clustering_policy")
    cluster_counts = policy.get("actionable_cluster_counts")
    if not isinstance(cluster_counts, list) or not cluster_counts or any(int(k) < 2 for k in cluster_counts):
        raise ValueError("clustering_policy.actionable_cluster_counts must contain values >= 2")
    for group_name in ("shock_intensity_weights", "exposure_weights", "benchmark_rank_weights"):
        group = policy.get(group_name)
        if not isinstance(group, dict) or not group:
            raise ValueError(f"clustering_policy.{group_name} must be a non-empty weight mapping")
        values = [float(value) for value in group.values()]
        if any(value < 0 for value in values) or abs(sum(values) - 1.0) > 1e-6:
            raise ValueError(f"clustering_policy.{group_name} weights must be non-negative and sum to 1")
    return dict(policy)


def validate_dataframe_against_specs(df: pd.DataFrame) -> dict[str, Any]:
    """Check present columns against allowed_range bounds declared in feature_specs.yaml."""
    spec_map = get_feature_spec_map()
    checked_columns: list[str] = []
    violations: list[dict[str, Any]] = []

    alias_map = {
        "pm25_days_over_75": "pm25_days_over_75_0",
        "pm25_days_over_75_0": "pm25_days_over_75",
        "heavy_rain_days_35mm": "heavy_rain_days",
        "heavy_rain_days": "heavy_rain_days_35mm",
    }

    for fid, spec in spec_map.items():
        col_name = fid if fid in df.columns else alias_map.get(fid)
        if not col_name or col_name not in df.columns:
            continue
        checked_columns.append(col_name)
        lo, hi = float(spec["allowed_range"][0]), float(spec["allowed_range"][1])
        series = pd.to_numeric(df[col_name], errors="coerce").dropna()
        if series.empty:
            continue
        out_of_bounds = series[(series < lo) | (series > hi)]
        if not out_of_bounds.empty:
            violations.append(
                {
                    "feature_id": fid,
                    "column": col_name,
                    "allowed_range": [lo, hi],
                    "violation_count": int(len(out_of_bounds)),
                    "min_observed": round(float(out_of_bounds.min()), 4),
                    "max_observed": round(float(out_of_bounds.max()), 4),
                }
            )

    return {
        "spec_version": get_spec_version(),
        "checked_columns": checked_columns,
        "violation_count": len(violations),
        "violations": violations,
        "passed": len(violations) == 0,
    }


def _read_git_head_sha(repo_root: Path) -> str | None:
    """Read short commit SHA directly from .git metadata without requiring a git binary on PATH."""
    git_dir = repo_root / ".git"
    if git_dir.is_file():
        pointer = git_dir.read_text(encoding="utf-8", errors="ignore").strip()
        if pointer.startswith("gitdir:"):
            git_dir = (repo_root / pointer.split(":", 1)[1].strip()).resolve()
    head_file = git_dir / "HEAD"
    if not head_file.is_file():
        return None
    head_val = head_file.read_text(encoding="utf-8", errors="ignore").strip()
    if not head_val:
        return None
    if not head_val.startswith("ref:"):
        return head_val[:12]
    ref_rel = head_val.split(":", 1)[1].strip()
    ref_file = git_dir / ref_rel
    if ref_file.is_file():
        sha = ref_file.read_text(encoding="utf-8", errors="ignore").strip()
        if sha:
            return sha[:12]
    packed = git_dir / "packed-refs"
    if packed.is_file():
        for line in packed.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line and not line.startswith("#") and not line.startswith("^"):
                parts = line.split()
                if len(parts) >= 2 and parts[1] == ref_rel:
                    return parts[0][:12]
    return None


def get_git_commit_short() -> str:
    """Resolve current short git commit SHA from environment, .git files, or git CLI."""
    for env_key in ("GITHUB_SHA", "RENDER_GIT_COMMIT", "VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT"):
        val = os.getenv(env_key, "").strip()
        if val:
            return val[:12]
    direct_sha = _read_git_head_sha(BACKEND_DIR.parent)
    if direct_sha:
        return direct_sha
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=str(BACKEND_DIR.parent),
            stderr=subprocess.DEVNULL,
            timeout=2,
        )
        sha = out.decode("utf-8", errors="ignore").strip()
        if sha:
            return sha
    except Exception:
        pass
    return "unknown"
