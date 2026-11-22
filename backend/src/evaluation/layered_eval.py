"""Four layer evaluation runners, freshness assertions, and baseline vs candidate tracking."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.config.feature_registry import (
    get_feature_spec_map,
    get_git_commit_short,
    get_spec_version,
    get_validation_policy,
)
from src.db.connection import bulk_execute, fetch_all

EVALUATOR_VERSION = "2.0.0"

LAYER_STALE_HOURS: dict[str, float] = {
    "code_tests": 168.0,
    "data_quality": 36.0,
    "statistical_validation": 336.0,
    "rag_evaluation": 336.0,
}

LAYER_RUN_TYPES: dict[str, str] = {
    "code_tests": "layer1_code_tests",
    "data_quality": "layer2_data_quality",
    "statistical_validation": "layer3_statistical_validation",
    "rag_evaluation": "layer4_rag_evaluation",
}


def _utc_now_iso() -> str:
    """Return current UTC ISO timestamp truncated to seconds."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _parse_iso_dt(raw: Any) -> datetime | None:
    """Parse PostgreSQL or ISO timestamp strings safely into timezone aware UTC datetime."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.astimezone(timezone.utc) if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    txt = str(raw).strip()
    if not txt:
        return None
    txt = txt.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(txt)
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def compute_clustering_perturbation_ari(
    x_scaled: np.ndarray,
    base_labels: np.ndarray,
    fit_fn: Any,
    ari_fn: Any,
    k: int = 4,
    n_trials: int = 12,
    noise_scale: float = 0.08,
    seed: int = 42,
) -> float:
    """Compute real mean Adjusted Rand Index under reproducible Gaussian feature perturbations."""
    rng = np.random.default_rng(seed)
    col_std = np.std(x_scaled, axis=0, ddof=0)
    col_std = np.where(col_std <= 1e-9, 1.0, col_std)
    scores: list[float] = []
    for trial in range(n_trials):
        noise = rng.normal(loc=0.0, scale=noise_scale * col_std, size=x_scaled.shape)
        pert_labels = fit_fn("KMeans", x_scaled + noise, k, seed=seed + trial + 1)
        scores.append(float(ari_fn(base_labels, pert_labels)))
    return round(float(np.mean(scores)), 4) if scores else 0.0


def persist_layer_evaluation(
    layer_key: str,
    payload: dict[str, Any],
    token_count: int = 0,
    estimated_cost_thb: float = 0.0,
) -> None:
    """Append a structured layer evaluation record into gold.pipeline_eval_runs."""
    run_type = LAYER_RUN_TYPES[layer_key]
    bulk_execute(
        """
        INSERT INTO gold.pipeline_eval_runs (run_type, metrics_json, token_count, estimated_cost_thb)
        VALUES (:run_type, CAST(:metrics_json AS JSONB), :token_count, :estimated_cost_thb)
        """,
        [
            {
                "run_type": run_type,
                "metrics_json": json.dumps(payload, ensure_ascii=False, default=str),
                "token_count": int(token_count),
                "estimated_cost_thb": float(estimated_cost_thb),
            }
        ],
    )


def run_layer1_code_tests(
    role: str = "baseline",
    persist: bool = True,
) -> dict[str, Any]:
    """Execute deterministic pytest unit and guardrail suite and return structured layer 1 report."""
    started_at = _utc_now_iso()
    run_id = f"l1_code_{uuid.uuid4().hex[:10]}"
    cmd = [sys.executable, "-m", "pytest", "-q", "tests/test_guardrails.py"]

    proc = subprocess.run(
        cmd,
        cwd=str(BACKEND_DIR),
        capture_output=True,
        text=True,
        timeout=120,
    )
    finished_at = _utc_now_iso()
    output_text = f"{proc.stdout}\n{proc.stderr}".strip()
    lines = [ln.strip() for ln in output_text.splitlines() if ln.strip()]

    passed_count = 0
    failed_count = 0
    for ln in reversed(lines):
        if " passed" in ln or " failed" in ln:
            parts = ln.replace(",", "").split()
            for idx, tok in enumerate(parts):
                if tok == "passed" and idx > 0 and parts[idx - 1].isdigit():
                    passed_count = int(parts[idx - 1])
                elif tok == "failed" and idx > 0 and parts[idx - 1].isdigit():
                    failed_count = int(parts[idx - 1])
            break

    total_cases = passed_count + failed_count
    failures: list[dict[str, Any]] = []
    if proc.returncode != 0:
        for ln in lines:
            if ln.startswith("FAILED ") or "AssertionError" in ln or "ERROR " in ln:
                failures.append({"case": ln[:180], "reason": "pytest_failure"})
        if not failures:
            failures.append({"case": "pytest_exit_nonzero", "reason": output_text[-240:]})

    status = "passed" if proc.returncode == 0 and total_cases > 0 else "failed"
    payload = {
        "layer": "code_tests",
        "run_id": run_id,
        "role": role,
        "review_mode": "deterministic",
        "status": status,
        "started_at": started_at,
        "finished_at": finished_at,
        "git_commit": get_git_commit_short(),
        "feature_spec_version": get_spec_version(),
        "evaluator_version": EVALUATOR_VERSION,
        "test_suite": "backend/tests/test_guardrails.py",
        "sample_size": total_cases,
        "passed_cases": passed_count,
        "failed_cases": failed_count,
        "threshold_summary": "100% deterministic unit, schema, PII, prompt defense, and tiering tests must pass",
        "metrics": {
            "pass_rate_pct": round((passed_count / max(total_cases, 1)) * 100.0, 2) if total_cases > 0 else 0.0,
            "passed_cases": passed_count,
            "failed_cases": failed_count,
        },
        "failures": failures[:20],
        "warnings": [],
    }
    if persist:
        persist_layer_evaluation("code_tests", payload)
    return payload


def run_layer2_data_quality(
    role: str = "baseline",
    persist: bool = True,
) -> dict[str, Any]:
    """Run dbt style schema, null rate, range, coverage, and source freshness assertions against Neon."""
    started_at = _utc_now_iso()
    run_id = f"l2_dq_{uuid.uuid4().hex[:10]}"
    spec_version = get_spec_version()
    spec_map = get_feature_spec_map()

    snap = fetch_all(
        """
        SELECT
            (SELECT count(*) FROM silver.dim_provinces) AS dim_provinces,
            (SELECT count(*) FROM gold.province_clusters) AS gold_clusters,
            (SELECT count(*) FROM gold.province_monthly_panel) AS gold_panel_rows,
            (SELECT count(DISTINCT province_code) FROM gold.province_monthly_panel) AS gold_panel_provinces,
            (SELECT max(month_date) FROM gold.province_monthly_panel) AS gold_panel_max_month,
            (SELECT count(*) FROM silver.air_daily) AS air_daily_rows,
            (SELECT max(obs_date) FROM silver.air_daily) AS air_latest_date,
            (SELECT count(DISTINCT province_code) FROM silver.air_daily WHERE obs_date >= CURRENT_DATE - INTERVAL '3 days') AS air_fresh_provinces,
            (SELECT count(*) FROM silver.news_events) AS news_event_rows,
            (SELECT max(event_date) FROM silver.news_events) AS news_latest_date,
            (SELECT count(*) FROM silver.quarantine) AS quarantine_rows,
            (SELECT count(*) FROM bronze.air4thai_raw) AS bronze_air_rows,
            (SELECT count(*) FROM silver.policy_chunks) AS policy_chunks,
            (SELECT count(DISTINCT doc_title) FROM silver.policy_chunks) AS policy_docs,
            (SELECT count(DISTINCT province_raw) FROM bronze.provincial_stats_raw WHERE dataset_name = 'nso_household_finance') AS nso_provinces,
            (SELECT max(period_date) FROM bronze.provincial_stats_raw WHERE dataset_name = 'nso_household_finance') AS nso_latest_date
        """
    )[0]

    # Check allowed range bounds on latest monthly panel features from feature_specs.yaml
    panel_bounds = fetch_all(
        """
        SELECT
            min((selected_features->>'pm25_mean')::double precision) AS pm25_min,
            max((selected_features->>'pm25_mean')::double precision) AS pm25_max,
            min((selected_features->>'rainfall_sum_mm')::double precision) AS rain_min,
            max((selected_features->>'rainfall_sum_mm')::double precision) AS rain_max,
            count(*) FILTER (WHERE composite_shock_idx IS NULL OR composite_shock_idx < 0 OR composite_shock_idx > 100) AS bad_shock_rows
        FROM gold.province_monthly_panel
        """
    )[0]

    checks: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    def _add_check(
        name: str,
        passed: bool,
        severity: str,
        observed: Any,
        expected: str,
        reason: str = "",
    ) -> None:
        item = {
            "check": name,
            "status": "passed" if passed else ("failed" if severity == "error" else "warn"),
            "observed": observed,
            "expected": expected,
        }
        checks.append(item)
        if not passed:
            entry = {"check": name, "observed": observed, "expected": expected, "reason": reason or f"Expected {expected}"}
            if severity == "error":
                failures.append(entry)
            else:
                warnings.append(entry)

    dim_p = int(snap["dim_provinces"] or 0)
    clust_p = int(snap["gold_clusters"] or 0)
    panel_p = int(snap["gold_panel_provinces"] or 0)
    panel_rows = int(snap["gold_panel_rows"] or 0)
    nso_p = int(snap["nso_provinces"] or 0)
    air_fresh = int(snap["air_fresh_provinces"] or 0)
    chunks = int(snap["policy_chunks"] or 0)
    docs = int(snap["policy_docs"] or 0)
    bad_shock = int(panel_bounds["bad_shock_rows"] or 0)

    _add_check("province_dimension_coverage", dim_p == 17, "error", dim_p, "17 provinces", "Missing northern provinces in silver.dim_provinces")
    _add_check("gold_cluster_coverage", clust_p == 17, "error", clust_p, "17 provinces", "Gold cluster table does not cover all 17 provinces")
    _add_check("gold_panel_coverage", panel_p == 17 and panel_rows >= 200, "error", f"{panel_p} prov / {panel_rows} rows", "17 provinces and >= 200 rows")
    _add_check("composite_shock_bounds", bad_shock == 0, "error", bad_shock, "0 rows outside [0, 100]")
    _add_check("nso_finance_province_coverage", nso_p >= 17, "warn", nso_p, "17 provinces", "Some provinces lack latest NSO finance metrics and will be flagged insufficient_data")
    _add_check("air4thai_sensor_freshness_3d", air_fresh >= 14, "warn", f"{air_fresh}/17", ">= 14/17 provinces updated within 3 days")
    _add_check("rag_policy_corpus_populated", chunks > 0 and docs >= 4, "error", f"{docs} docs / {chunks} chunks", ">= 4 official docs indexed")

    # Verify spec declared bounds for pm25_mean and rainfall_sum_mm
    pm_spec = spec_map.get("pm25_mean", {}).get("allowed_range", [0.0, 500.0])
    pm_min = panel_bounds.get("pm25_min")
    pm_max = panel_bounds.get("pm25_max")
    if pm_min is not None and pm_max is not None:
        pm_ok = float(pm_min) >= float(pm_spec[0]) and float(pm_max) <= float(pm_spec[1])
        _add_check("spec_range_pm25_mean", pm_ok, "warn", f"[{round(float(pm_min), 1)}, {round(float(pm_max), 1)}]", f"[{pm_spec[0]}, {pm_spec[1]}]")

    rain_spec = spec_map.get("rainfall_sum_mm", {}).get("allowed_range", [0.0, 2500.0])
    rain_min = panel_bounds.get("rain_min")
    rain_max = panel_bounds.get("rain_max")
    if rain_min is not None and rain_max is not None:
        rain_ok = float(rain_min) >= float(rain_spec[0]) and float(rain_max) <= float(rain_spec[1])
        _add_check("spec_range_rainfall_sum_mm", rain_ok, "warn", f"[{round(float(rain_min), 1)}, {round(float(rain_max), 1)}]", f"[{rain_spec[0]}, {rain_spec[1]}]")

    if failures:
        status = "failed"
    elif warnings:
        status = "warn"
    else:
        status = "passed"

    finished_at = _utc_now_iso()
    passed_checks = sum(1 for c in checks if c["status"] == "passed")
    payload = {
        "layer": "data_quality",
        "run_id": run_id,
        "role": role,
        "review_mode": "deterministic",
        "status": status,
        "started_at": started_at,
        "finished_at": finished_at,
        "git_commit": get_git_commit_short(),
        "feature_spec_version": spec_version,
        "dataset_cutoff": str(snap["gold_panel_max_month"]) if snap["gold_panel_max_month"] else None,
        "evaluator_version": EVALUATOR_VERSION,
        "sample_size": len(checks),
        "passed_cases": passed_checks,
        "failed_cases": len(failures),
        "warning_cases": len(warnings),
        "threshold_summary": "All critical schema, coverage, and bounds checks must pass; freshness gaps trigger warning",
        "freshness": {
            "gold_panel_max_month": str(snap["gold_panel_max_month"]) if snap["gold_panel_max_month"] else None,
            "air_latest_date": str(snap["air_latest_date"]) if snap["air_latest_date"] else None,
            "air_fresh_provinces_3d": air_fresh,
            "news_latest_date": str(snap["news_latest_date"]) if snap["news_latest_date"] else None,
            "nso_latest_date": str(snap["nso_latest_date"]) if snap["nso_latest_date"] else None,
            "quarantine_rows_caught": int(snap["quarantine_rows"] or 0),
        },
        "metrics": {
            "checks_passed": passed_checks,
            "checks_total": len(checks),
            "air_fresh_provinces_3d": air_fresh,
            "nso_provinces_covered": nso_p,
            "quarantine_rows_caught": int(snap["quarantine_rows"] or 0),
        },
        "checks": checks,
        "failures": failures,
        "warnings": warnings,
    }
    if persist:
        persist_layer_evaluation("data_quality", payload)
    return payload


def build_layer3_statistical_payload(
    shock_bt: dict[str, Any],
    clust_bt: dict[str, Any],
    sig_map: dict[str, int],
    perturbation_ari: float | None,
    cross_scaler_ari: float | None,
    km_vs_ward_ari: float | None,
    role: str = "baseline",
) -> dict[str, Any]:
    """Assemble structured Layer 3 statistical validation payload with explicit criteria and caveats."""
    now_iso = _utc_now_iso()
    policy = get_validation_policy()
    sil = clust_bt.get("silhouette")
    oos = shock_bt.get("out_of_time_validation") or {}
    oos_r = oos.get("out_of_sample_spearman_occ_yoy_r")
    oos_p = oos.get("out_of_sample_spearman_occ_yoy_p")
    kw_p = shock_bt.get("kruskal_occ_yoy_p")

    failures: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    if sil is None:
        warnings.append({"check": "clustering_silhouette", "reason": "No clustering benchmark recorded"})
    elif float(sil) < 0.25:
        failures.append({"check": "clustering_silhouette", "observed": sil, "expected": ">= 0.25"})
    elif float(sil) < 0.40:
        warnings.append({"check": "clustering_silhouette", "observed": sil, "expected": ">= 0.40 for strong separation", "reason": "Moderate cluster overlap across 17 provinces"})

    if perturbation_ari is not None and float(perturbation_ari) < 0.70:
        warnings.append({"check": "perturbation_ari", "observed": perturbation_ari, "expected": ">= 0.70"})

    if not oos:
        warnings.append({"check": "out_of_time_holdout", "reason": "Out of time chronological holdout metrics not yet recorded"})
    elif oos_r is not None and float(oos_r) >= 0.0:
        warnings.append({"check": "out_of_time_direction", "observed": oos_r, "expected": "< 0.0 negative alignment with occupancy YoY"})

    if not shock_bt and not clust_bt:
        status = "not_evaluated"
    elif failures:
        status = "failed"
    elif warnings:
        status = "warn"
    else:
        status = "passed"

    return {
        "layer": "statistical_validation",
        "run_id": f"l3_stat_{uuid.uuid4().hex[:10]}",
        "role": role,
        "review_mode": "deterministic",
        "status": status,
        "started_at": now_iso,
        "finished_at": now_iso,
        "git_commit": get_git_commit_short(),
        "feature_spec_version": get_spec_version(),
        "dataset_cutoff": shock_bt.get("dataset_cutoff"),
        "evaluator_version": EVALUATOR_VERSION,
        "validation_policy": policy,
        "sample_size": int(oos.get("n_train_rows", 0)) + int(oos.get("n_test_rows", 0)) or 17,
        "threshold_summary": "Silhouette >= 0.25 (warn < 0.40), Perturbation ARI >= 0.70, strict BH FDR q < 0.05, leak free chronological split",
        "metrics": {
            "silhouette_score": sil,
            "davies_bouldin_index": clust_bt.get("davies_bouldin"),
            "perturbation_ari": perturbation_ari,
            "cross_scaler_ari": cross_scaler_ari,
            "kmeans_vs_ward_ari": km_vs_ward_ari,
            "kruskal_occ_yoy_p": kw_p,
            "oos_spearman_occ_yoy_r": oos_r,
            "oos_spearman_occ_yoy_p": oos_p,
            "leakage_free_preprocessing": bool(shock_bt.get("leakage_free_preprocessing", False)),
            "fdr_selected_features_by_target": sig_map,
        },
        "failures": failures,
        "warnings": warnings,
    }


def _evaluate_freshness_status(
    raw_status: str,
    ran_at: Any,
    stale_hours: float,
) -> tuple[str, float | None, bool]:
    """Compute age in hours and promote expired results to stale unless not_evaluated or running."""
    if raw_status in {"not_evaluated", "running"}:
        return raw_status, None, False
    dt = _parse_iso_dt(ran_at)
    if dt is None:
        return "not_evaluated", None, False
    age_hours = round((datetime.now(timezone.utc) - dt).total_seconds() / 3600.0, 1)
    is_stale = age_hours > stale_hours
    if is_stale:
        return "stale", age_hours, True
    return raw_status, age_hours, False


def _compare_metric_dicts(
    baseline_metrics: dict[str, Any],
    candidate_metrics: dict[str, Any],
) -> list[dict[str, Any]]:
    """Compute numeric metric deltas between baseline and candidate evaluation snapshots."""
    diffs: list[dict[str, Any]] = []
    all_keys = sorted(set(baseline_metrics.keys()) | set(candidate_metrics.keys()))
    for key in all_keys:
        b_val = baseline_metrics.get(key)
        c_val = candidate_metrics.get(key)
        if isinstance(b_val, (int, float)) and isinstance(c_val, (int, float)) and not isinstance(b_val, bool):
            diffs.append(
                {
                    "metric": key,
                    "baseline": round(float(b_val), 4),
                    "candidate": round(float(c_val), 4),
                    "delta": round(float(c_val) - float(b_val), 4),
                }
            )
    return diffs


def build_layered_evaluation_summary(eval_history_rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Assemble 4 layer governance cards with 6 state status, staleness detection, and baseline vs candidate diff."""
    by_type: dict[str, list[dict[str, Any]]] = {}
    for row in eval_history_rows:
        rt = str(row.get("run_type") or "")
        by_type.setdefault(rt, []).append(row)

    legacy_7d_row = (by_type.get("full_7d_evaluation") or [None])[0]
    legacy_7d = (legacy_7d_row or {}).get("metrics_json") or {}
    legacy_7d_at = (legacy_7d_row or {}).get("ran_at")

    shock_row = (by_type.get("shock_index_backtest") or [None])[0]
    clust_row = (by_type.get("clustering_benchmark") or [None])[0]

    def _latest_for_role(run_type: str, target_role: str | None = None) -> dict[str, Any] | None:
        rows = by_type.get(run_type) or []
        if target_role is None:
            return rows[0] if rows else None
        for r in rows:
            mj = r.get("metrics_json") or {}
            if str(mj.get("role", "baseline")) == target_role:
                return r
        return None

    layers: list[dict[str, Any]] = []
    comparisons: list[dict[str, Any]] = []

    # Layer 1 Code Tests
    l1_row = _latest_for_role("layer1_code_tests")
    if l1_row:
        mj = l1_row["metrics_json"] or {}
        eff_status, age_h, is_stale = _evaluate_freshness_status(
            str(mj.get("status", "not_evaluated")), l1_row.get("ran_at"), LAYER_STALE_HOURS["code_tests"]
        )
        layers.append(
            {
                "layer": "code_tests",
                "title_th": "ชั้นที่ 1 การทดสอบโค้ดและเกณฑ์ความปลอดภัย (Code Tests)",
                "title_en": "Layer 1 Code & Guardrail Tests",
                "review_mode": "deterministic",
                "status": eff_status,
                "raw_status": str(mj.get("status", "not_evaluated")),
                "is_stale": is_stale,
                "age_hours": age_h,
                "stale_after_hours": LAYER_STALE_HOURS["code_tests"],
                "ran_at": str(l1_row.get("ran_at")),
                "run_id": mj.get("run_id"),
                "role": mj.get("role", "baseline"),
                "git_commit": mj.get("git_commit"),
                "feature_spec_version": mj.get("feature_spec_version"),
                "evaluator_version": mj.get("evaluator_version"),
                "sample_size": mj.get("sample_size"),
                "threshold_summary": mj.get("threshold_summary"),
                "metrics": mj.get("metrics") or {},
                "failures": mj.get("failures") or [],
                "warnings": mj.get("warnings") or [],
                "trigger_policy_th": "รันทุกครั้งที่แก้โค้ดหรือรอบ CI ประจำวัน หากตกต้องบล็อกการเผยแพร่",
                "trigger_policy_en": "Runs on every code change and daily CI; critical failures block release",
            }
        )
    elif legacy_7d.get("dim5_security_guardrails"):
        d5 = legacy_7d["dim5_security_guardrails"]
        raw_st = "passed" if d5.get("passed") else "failed"
        eff_status, age_h, is_stale = _evaluate_freshness_status(raw_st, legacy_7d_at, LAYER_STALE_HOURS["code_tests"])
        layers.append(
            {
                "layer": "code_tests",
                "title_th": "ชั้นที่ 1 การทดสอบโค้ดและเกณฑ์ความปลอดภัย (Code Tests)",
                "title_en": "Layer 1 Code & Guardrail Tests",
                "review_mode": "deterministic",
                "status": eff_status,
                "raw_status": raw_st,
                "is_stale": is_stale,
                "age_hours": age_h,
                "stale_after_hours": LAYER_STALE_HOURS["code_tests"],
                "ran_at": str(legacy_7d_at),
                "run_id": legacy_7d.get("run_id") or "legacy_7d_dim5",
                "role": "baseline",
                "git_commit": legacy_7d.get("git_commit") or "unrecorded",
                "feature_spec_version": legacy_7d.get("feature_spec_version") or get_spec_version(),
                "evaluator_version": legacy_7d.get("evaluator_version") or "1.0.0",
                "sample_size": int(d5.get("pii_cases_tested", 0)) + int(d5.get("injection_cases_tested", 0)),
                "threshold_summary": "100% curated PII redaction (20) & prompt injection block (10)",
                "metrics": {
                    "pii_redaction_recall_pct": d5.get("pii_redaction_recall_pct"),
                    "injection_block_rate_pct": d5.get("injection_block_rate_pct"),
                },
                "failures": [],
                "warnings": [{"check": "legacy_eval_source", "reason": "Derived from legacy 7D run before dedicated pytest CI logger"}],
                "trigger_policy_th": "รันทุกครั้งที่แก้โค้ดหรือรอบ CI ประจำวัน หากตกต้องบล็อกการเผยแพร่",
                "trigger_policy_en": "Runs on every code change and daily CI; critical failures block release",
            }
        )
    else:
        layers.append(
            {
                "layer": "code_tests",
                "title_th": "ชั้นที่ 1 การทดสอบโค้ดและเกณฑ์ความปลอดภัย (Code Tests)",
                "title_en": "Layer 1 Code & Guardrail Tests",
                "review_mode": "deterministic",
                "status": "not_evaluated",
                "raw_status": "not_evaluated",
                "is_stale": False,
                "age_hours": None,
                "stale_after_hours": LAYER_STALE_HOURS["code_tests"],
                "ran_at": None,
                "run_id": None,
                "role": "baseline",
                "git_commit": None,
                "feature_spec_version": get_spec_version(),
                "evaluator_version": EVALUATOR_VERSION,
                "sample_size": 0,
                "threshold_summary": "100% deterministic unit & guardrail tests must pass",
                "metrics": {},
                "failures": [],
                "warnings": [],
                "trigger_policy_th": "รันทุกครั้งที่แก้โค้ดหรือรอบ CI ประจำวัน หากตกต้องบล็อกการเผยแพร่",
                "trigger_policy_en": "Runs on every code change and daily CI; critical failures block release",
            }
        )

    # Layer 2 Data Quality and Freshness
    l2_row = _latest_for_role("layer2_data_quality")
    if l2_row:
        mj = l2_row["metrics_json"] or {}
        eff_status, age_h, is_stale = _evaluate_freshness_status(
            str(mj.get("status", "not_evaluated")), l2_row.get("ran_at"), LAYER_STALE_HOURS["data_quality"]
        )
        layers.append(
            {
                "layer": "data_quality",
                "title_th": "ชั้นที่ 2 คุณภาพและความสดใหม่ของข้อมูล (Data Quality)",
                "title_en": "Layer 2 Data Quality & Source Freshness",
                "review_mode": "deterministic",
                "status": eff_status,
                "raw_status": str(mj.get("status", "not_evaluated")),
                "is_stale": is_stale,
                "age_hours": age_h,
                "stale_after_hours": LAYER_STALE_HOURS["data_quality"],
                "ran_at": str(l2_row.get("ran_at")),
                "run_id": mj.get("run_id"),
                "role": mj.get("role", "baseline"),
                "git_commit": mj.get("git_commit"),
                "feature_spec_version": mj.get("feature_spec_version"),
                "dataset_cutoff": mj.get("dataset_cutoff"),
                "evaluator_version": mj.get("evaluator_version"),
                "sample_size": mj.get("sample_size"),
                "threshold_summary": mj.get("threshold_summary"),
                "metrics": mj.get("metrics") or {},
                "freshness": mj.get("freshness") or {},
                "failures": mj.get("failures") or [],
                "warnings": mj.get("warnings") or [],
                "trigger_policy_th": "รันทุกครั้งที่ ELT ดึงข้อมูล หากตกให้กักข้อมูลหรือหยุดเฉพาะขั้นตอนที่ใช้ตารางนั้น",
                "trigger_policy_en": "Runs on every ELT batch; failing assertions quarantine data or halt downstream stages",
            }
        )
    else:
        layers.append(
            {
                "layer": "data_quality",
                "title_th": "ชั้นที่ 2 คุณภาพและความสดใหม่ของข้อมูล (Data Quality)",
                "title_en": "Layer 2 Data Quality & Source Freshness",
                "review_mode": "deterministic",
                "status": "not_evaluated",
                "raw_status": "not_evaluated",
                "is_stale": False,
                "age_hours": None,
                "stale_after_hours": LAYER_STALE_HOURS["data_quality"],
                "ran_at": None,
                "run_id": None,
                "role": "baseline",
                "git_commit": None,
                "feature_spec_version": get_spec_version(),
                "dataset_cutoff": None,
                "evaluator_version": EVALUATOR_VERSION,
                "sample_size": 0,
                "threshold_summary": "Schema, 17-province coverage, spec bounds, and 36h freshness assertions",
                "metrics": {},
                "failures": [],
                "warnings": [{"check": "awaiting_first_dq_run", "reason": "Run python -m src.evaluation.layered_eval --layer data_quality or trigger daily ELT"}],
                "trigger_policy_th": "รันทุกครั้งที่ ELT ดึงข้อมูล หากตกให้กักข้อมูลหรือหยุดเฉพาะขั้นตอนที่ใช้ตารางนั้น",
                "trigger_policy_en": "Runs on every ELT batch; failing assertions quarantine data or halt downstream stages",
            }
        )

    # Layer 3 Statistical Validation
    l3_row = _latest_for_role("layer3_statistical_validation")
    if l3_row:
        mj = l3_row["metrics_json"] or {}
        eff_status, age_h, is_stale = _evaluate_freshness_status(
            str(mj.get("status", "not_evaluated")), l3_row.get("ran_at"), LAYER_STALE_HOURS["statistical_validation"]
        )
        layers.append(
            {
                "layer": "statistical_validation",
                "title_th": "ชั้นที่ 3 การตรวจสอบทางสถิติและเสถียรภาพโมเดล (Statistical Validation)",
                "title_en": "Layer 3 Statistical Validation & Holdout Stability",
                "review_mode": "deterministic",
                "status": eff_status,
                "raw_status": str(mj.get("status", "not_evaluated")),
                "is_stale": is_stale,
                "age_hours": age_h,
                "stale_after_hours": LAYER_STALE_HOURS["statistical_validation"],
                "ran_at": str(l3_row.get("ran_at")),
                "run_id": mj.get("run_id"),
                "role": mj.get("role", "baseline"),
                "git_commit": mj.get("git_commit"),
                "feature_spec_version": mj.get("feature_spec_version"),
                "dataset_cutoff": mj.get("dataset_cutoff"),
                "evaluator_version": mj.get("evaluator_version"),
                "sample_size": mj.get("sample_size"),
                "threshold_summary": mj.get("threshold_summary"),
                "metrics": mj.get("metrics") or {},
                "failures": mj.get("failures") or [],
                "warnings": mj.get("warnings") or [],
                "trigger_policy_th": "รันเมื่อเปลี่ยนสูตร/ตัวแปรใน feature_specs.yaml เก็บเป็น candidate เทียบ baseline ก่อนอนุมัติ",
                "trigger_policy_en": "Runs when changing feature_specs.yaml; kept as candidate until beating baseline",
            }
        )
    elif shock_row or clust_row:
        shock_mj = (shock_row or {}).get("metrics_json") or {}
        clust_mj = (clust_row or {}).get("metrics_json") or {}
        winner = clust_mj.get("winner") or {}
        latest_ts = (shock_row or clust_row or {}).get("ran_at")
        synthesized = build_layer3_statistical_payload(
            shock_bt=shock_mj,
            clust_bt=winner,
            sig_map=(legacy_7d.get("dim4_analytics") or {}).get("selected_features_by_target") or {},
            perturbation_ari=(legacy_7d.get("dim6_stability") or {}).get("kmeans_k4_perturbation_ari"),
            cross_scaler_ari=(legacy_7d.get("dim6_stability") or {}).get("kmeans_standard_vs_robust_k4_ari"),
            km_vs_ward_ari=(legacy_7d.get("dim6_stability") or {}).get("kmeans_vs_ward_robust_k4_ari"),
        )
        eff_status, age_h, is_stale = _evaluate_freshness_status(
            synthesized["status"], latest_ts, LAYER_STALE_HOURS["statistical_validation"]
        )
        layers.append(
            {
                "layer": "statistical_validation",
                "title_th": "ชั้นที่ 3 การตรวจสอบทางสถิติและเสถียรภาพโมเดล (Statistical Validation)",
                "title_en": "Layer 3 Statistical Validation & Holdout Stability",
                "review_mode": "deterministic",
                "status": eff_status,
                "raw_status": synthesized["status"],
                "is_stale": is_stale,
                "age_hours": age_h,
                "stale_after_hours": LAYER_STALE_HOURS["statistical_validation"],
                "ran_at": str(latest_ts),
                "run_id": shock_mj.get("run_id") or clust_mj.get("run_id") or "legacy_stat",
                "role": "baseline",
                "git_commit": shock_mj.get("git_commit") or clust_mj.get("git_commit") or "unrecorded",
                "feature_spec_version": shock_mj.get("feature_spec_version") or clust_mj.get("feature_spec_version") or get_spec_version(),
                "dataset_cutoff": shock_mj.get("dataset_cutoff"),
                "evaluator_version": EVALUATOR_VERSION,
                "sample_size": synthesized["sample_size"],
                "threshold_summary": synthesized["threshold_summary"],
                "metrics": synthesized["metrics"],
                "failures": synthesized["failures"],
                "warnings": synthesized["warnings"],
                "trigger_policy_th": "รันเมื่อเปลี่ยนสูตร/ตัวแปรใน feature_specs.yaml เก็บเป็น candidate เทียบ baseline ก่อนอนุมัติ",
                "trigger_policy_en": "Runs when changing feature_specs.yaml; kept as candidate until beating baseline",
            }
        )
    else:
        layers.append(
            {
                "layer": "statistical_validation",
                "title_th": "ชั้นที่ 3 การตรวจสอบทางสถิติและเสถียรภาพโมเดล (Statistical Validation)",
                "title_en": "Layer 3 Statistical Validation & Holdout Stability",
                "review_mode": "deterministic",
                "status": "not_evaluated",
                "raw_status": "not_evaluated",
                "is_stale": False,
                "age_hours": None,
                "stale_after_hours": LAYER_STALE_HOURS["statistical_validation"],
                "ran_at": None,
                "run_id": None,
                "role": "baseline",
                "git_commit": None,
                "feature_spec_version": get_spec_version(),
                "dataset_cutoff": None,
                "evaluator_version": EVALUATOR_VERSION,
                "sample_size": 0,
                "threshold_summary": "Silhouette >= 0.25, Perturbation ARI >= 0.70, strict BH FDR q < 0.05",
                "metrics": {},
                "failures": [],
                "warnings": [],
                "trigger_policy_th": "รันเมื่อเปลี่ยนสูตร/ตัวแปรใน feature_specs.yaml เก็บเป็น candidate เทียบ baseline ก่อนอนุมัติ",
                "trigger_policy_en": "Runs when changing feature_specs.yaml; kept as candidate until beating baseline",
            }
        )

    # Layer 4 RAG Evaluation (strictly separating deterministic retrieval/provenance vs AI assisted review)
    l4_row = _latest_for_role("layer4_rag_evaluation")
    if l4_row:
        mj = l4_row["metrics_json"] or {}
        eff_status, age_h, is_stale = _evaluate_freshness_status(
            str(mj.get("status", "not_evaluated")), l4_row.get("ran_at"), LAYER_STALE_HOURS["rag_evaluation"]
        )
        layers.append(
            {
                "layer": "rag_evaluation",
                "title_th": "ชั้นที่ 4 การประเมินระบบค้นเอกสารและผู้ช่วยนโยบาย (RAG Evaluation)",
                "title_en": "Layer 4 RAG Retrieval, Citation & Refusal Evaluation",
                "review_mode": "hybrid_deterministic_and_ai_assisted",
                "status": eff_status,
                "raw_status": str(mj.get("status", "not_evaluated")),
                "is_stale": is_stale,
                "age_hours": age_h,
                "stale_after_hours": LAYER_STALE_HOURS["rag_evaluation"],
                "ran_at": str(l4_row.get("ran_at")),
                "run_id": mj.get("run_id"),
                "role": mj.get("role", "baseline"),
                "git_commit": mj.get("git_commit"),
                "prompt_version": mj.get("prompt_version"),
                "rag_index_version": mj.get("rag_index_version"),
                "evaluator_version": mj.get("evaluator_version"),
                "sample_size": mj.get("sample_size"),
                "threshold_summary": mj.get("threshold_summary"),
                "metrics": mj.get("metrics") or {},
                "ai_assisted_review": mj.get("ai_assisted_review"),
                "failures": mj.get("failures") or [],
                "warnings": mj.get("warnings") or [],
                "trigger_policy_th": "รันเมื่อเปลี่ยน Prompt, โมเดล หรือคลังเอกสาร PDF ก่อนเปิดใช้งานรุ่นใหม่",
                "trigger_policy_en": "Runs whenever prompt, model, or PDF index changes prior to rollout",
            }
        )
    elif legacy_7d.get("dim1_retrieval") or legacy_7d.get("dim2_rag_qa"):
        d1 = legacy_7d.get("dim1_retrieval") or {}
        d2 = legacy_7d.get("dim2_rag_qa") or {}
        hyb = d1.get("hybrid_rrf") or {}
        hit5 = hyb.get("hit_rate_top5_pct")
        cite_acc = d2.get("citation_accuracy_pct")
        refusal_acc = d2.get("refusal_accuracy_pct")
        in_scope_n = int(d2.get("in_scope_tested") or 0)
        warnings_l4: list[dict[str, Any]] = [
            {
                "check": "semantic_entailment_human_review",
                "reason": f"Citation check verifies document/page provenance only; semantic factual entailment across {in_scope_n} sample Q&As requires human review",
            }
        ]
        failures_l4: list[dict[str, Any]] = []
        if hit5 is not None and float(hit5) < 85.0:
            failures_l4.append({"check": "retrieval_hit_at_5", "observed": hit5, "expected": ">= 85.0%"})
        if refusal_acc is not None and float(refusal_acc) < 100.0:
            failures_l4.append({"check": "trap_refusal_rate", "observed": refusal_acc, "expected": "100.0%"})
        raw_st = "failed" if failures_l4 else "warn"
        eff_status, age_h, is_stale = _evaluate_freshness_status(raw_st, legacy_7d_at, LAYER_STALE_HOURS["rag_evaluation"])
        layers.append(
            {
                "layer": "rag_evaluation",
                "title_th": "ชั้นที่ 4 การประเมินระบบค้นเอกสารและผู้ช่วยนโยบาย (RAG Evaluation)",
                "title_en": "Layer 4 RAG Retrieval, Citation & Refusal Evaluation",
                "review_mode": "hybrid_deterministic_and_ai_assisted",
                "status": eff_status,
                "raw_status": raw_st,
                "is_stale": is_stale,
                "age_hours": age_h,
                "stale_after_hours": LAYER_STALE_HOURS["rag_evaluation"],
                "ran_at": str(legacy_7d_at),
                "run_id": legacy_7d.get("run_id") or "legacy_7d_rag",
                "role": "baseline",
                "git_commit": legacy_7d.get("git_commit") or "unrecorded",
                "prompt_version": legacy_7d.get("prompt_version") or "v3.1",
                "rag_index_version": legacy_7d.get("rag_index_version") or "unrecorded",
                "evaluator_version": legacy_7d.get("evaluator_version") or "1.0.0",
                "sample_size": int(hyb.get("n_queries") or 0) + int(d2.get("traps_tested") or 0),
                "threshold_summary": "Hit@5 >= 85%, Citation Provenance 100%, Trap Refusal 100% (semantic accuracy requires human spot-check)",
                "metrics": {
                    "hit_rate_top5_pct": hit5,
                    "mrr": hyb.get("mrr"),
                    "citation_provenance_pct": cite_acc,
                    "refusal_accuracy_pct": refusal_acc,
                    "in_scope_answer_rate_pct": d2.get("in_scope_answer_rate_pct"),
                    "in_scope_tested": in_scope_n,
                    "traps_tested": d2.get("traps_tested"),
                    "median_latency_ms": d2.get("median_latency_ms"),
                },
                "ai_assisted_review": {
                    "label": "AI-assisted review (not a deterministic pass/fail gate)",
                    "claim_factual_entailment_verified": False,
                    "human_review_required": True,
                },
                "failures": failures_l4,
                "warnings": warnings_l4,
                "trigger_policy_th": "รันเมื่อเปลี่ยน Prompt, โมเดล หรือคลังเอกสาร PDF ก่อนเปิดใช้งานรุ่นใหม่",
                "trigger_policy_en": "Runs whenever prompt, model, or PDF index changes prior to rollout",
            }
        )
    else:
        layers.append(
            {
                "layer": "rag_evaluation",
                "title_th": "ชั้นที่ 4 การประเมินระบบค้นเอกสารและผู้ช่วยนโยบาย (RAG Evaluation)",
                "title_en": "Layer 4 RAG Retrieval, Citation & Refusal Evaluation",
                "review_mode": "hybrid_deterministic_and_ai_assisted",
                "status": "not_evaluated",
                "raw_status": "not_evaluated",
                "is_stale": False,
                "age_hours": None,
                "stale_after_hours": LAYER_STALE_HOURS["rag_evaluation"],
                "ran_at": None,
                "run_id": None,
                "role": "baseline",
                "git_commit": None,
                "prompt_version": "v3.1",
                "rag_index_version": None,
                "evaluator_version": EVALUATOR_VERSION,
                "sample_size": 0,
                "threshold_summary": "Hit@5 >= 85%, Citation Provenance 100%, Trap Refusal 100%",
                "metrics": {},
                "ai_assisted_review": {
                    "label": "AI-assisted review (not a deterministic pass/fail gate)",
                    "claim_factual_entailment_verified": False,
                    "human_review_required": True,
                },
                "failures": [],
                "warnings": [],
                "trigger_policy_th": "รันเมื่อเปลี่ยน Prompt, โมเดล หรือคลังเอกสาร PDF ก่อนเปิดใช้งานรุ่นใหม่",
                "trigger_policy_en": "Runs whenever prompt, model, or PDF index changes prior to rollout",
            }
        )

    # Build Baseline vs Candidate comparisons for any layer having candidate runs
    for layer_key, run_type in LAYER_RUN_TYPES.items():
        base_r = _latest_for_role(run_type, "baseline")
        cand_r = _latest_for_role(run_type, "candidate")
        if base_r and cand_r:
            b_mj = base_r.get("metrics_json") or {}
            c_mj = cand_r.get("metrics_json") or {}
            comparisons.append(
                {
                    "layer": layer_key,
                    "baseline_run_id": b_mj.get("run_id"),
                    "candidate_run_id": c_mj.get("run_id"),
                    "baseline_ran_at": str(base_r.get("ran_at")),
                    "candidate_ran_at": str(cand_r.get("ran_at")),
                    "baseline_status": b_mj.get("status"),
                    "candidate_status": c_mj.get("status"),
                    "baseline_spec_version": b_mj.get("feature_spec_version"),
                    "candidate_spec_version": c_mj.get("feature_spec_version"),
                    "metric_deltas": _compare_metric_dicts(b_mj.get("metrics") or {}, c_mj.get("metrics") or {}),
                    "promotion_ready": str(c_mj.get("status")) in {"passed", "warn"} and len(c_mj.get("failures") or []) == 0,
                }
            )

    return {
        "evaluator_version": EVALUATOR_VERSION,
        "feature_spec_version": get_spec_version(),
        "layers": layers,
        "baseline_vs_candidate": comparisons,
    }


def main() -> None:
    """CLI entrypoint for running individual deterministic evaluation layers."""
    parser = argparse.ArgumentParser(description="Run 4 layer deterministic evaluation checks.")
    parser.add_argument(
        "--layer",
        choices=["code_tests", "data_quality", "all_deterministic"],
        default="data_quality",
    )
    parser.add_argument(
        "--role",
        choices=["baseline", "candidate"],
        default="baseline",
    )
    parser.add_argument("--no-persist", action="store_true")
    args = parser.parse_args()

    out: dict[str, Any] = {}
    if args.layer in {"code_tests", "all_deterministic"}:
        out["code_tests"] = run_layer1_code_tests(role=args.role, persist=not args.no_persist)
    if args.layer in {"data_quality", "all_deterministic"}:
        out["data_quality"] = run_layer2_data_quality(role=args.role, persist=not args.no_persist)

    print(json.dumps(out, ensure_ascii=False, indent=2))
    failed_any = any(v.get("status") == "failed" for v in out.values())
    if failed_any:
        sys.exit(1)


if __name__ == "__main__":
    main()
