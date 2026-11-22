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
        "time_split_train_ratio": float(policy["time_split_train_ratio"]),
        "scope_classification": str(policy.get("scope_classification", "exploratory_within_province_screening")),
    }


def get_feature_spec_map() -> dict[str, dict[str, Any]]:
    """Return mapping of feature_id to its specification metadata."""
    specs = load_feature_specs()["features"]
    return {str(item["feature_id"]): dict(item) for item in specs}


def validate_dataframe_against_specs(df: pd.DataFrame) -> dict[str, Any]:
    """Check present columns against allowed_range bounds declared in feature_specs.yaml."""
    spec_map = get_feature_spec_map()
    checked_columns: list[str] = []
    violations: list[dict[str, Any]] = []

    alias_map = {
        "pm25_days_over_75": "pm25_days_over_75_0",
        "heavy_rain_days_35mm": "heavy_rain_days",
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


def get_git_commit_short() -> str:
    """Resolve current short git commit SHA from environment or local git repository."""
    for env_key in ("GITHUB_SHA", "RENDER_GIT_COMMIT", "VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT"):
        val = os.getenv(env_key, "").strip()
        if val:
            return val[:12]
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
