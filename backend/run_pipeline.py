"""End to end Medallion ELT batch orchestrator for scheduled daily or full refresh into Neon."""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.analytics.clustering import run_clustering_pipeline, save_clusters_to_neon
from src.analytics.eda_deep_insights import run_deep_eda
from src.analytics.eda_feature_selection import run_full_eda_screening, save_screening_results_to_neon
from src.analytics.shock_index import run_shock_index_pipeline, save_monthly_panel_to_neon
from src.config.feature_registry import get_data_quality_policy, get_git_commit_short, get_spec_version
from src.db.connection import bulk_execute, fetch_all, get_connection
from src.evaluation.layered_eval import run_drift_monitoring, run_layer2_data_quality
from src.guardrails.schemas import resolve_northern_province
from src.extract.air4thai_client import load_air4thai_to_bronze
from src.extract.historical_hazard_client import load_historical_hazards_to_bronze
from src.extract.macro_controls_client import load_macro_controls_to_bronze
from src.extract.mots_nso_loader import (
    load_mots_to_bronze,
    load_nso_household_finance_to_bronze,
)
from src.extract.news_scraper import load_news_to_bronze
from src.rag.indexer import index_all_official_pdfs
from src.transform.llm_shock_extractor import run_silver_news_extraction
from src.transform.panel_builder import resolve_provincial_stats
from src.transform.silver_clean import transform_air4thai_bronze_to_silver

ICT_TZ = timezone(timedelta(hours=7))


def _json_safe(value: Any) -> Any:
    """Convert pipeline results to strict JSON values (PostgreSQL JSONB rejects NaN/Infinity)."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if value.__class__.__name__ in {"NAType", "NaTType"}:
        return None
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]

    # Handle NumPy/Pandas scalar and array values without importing their libraries here.
    if hasattr(value, "tolist"):
        try:
            return _json_safe(value.tolist())
        except (TypeError, ValueError):
            pass
    if hasattr(value, "item"):
        try:
            return _json_safe(value.item())
        except (TypeError, ValueError):
            pass
    return str(value)


def _execute_stage(
    stage_name: str,
    fn: Callable[[], dict[str, Any]],
    critical: bool = False,
) -> dict[str, Any]:
    """Run one pipeline stage with timing, structured summary, and optional fault isolation."""
    t0 = time.perf_counter()
    try:
        output = fn()
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        return {
            "stage": stage_name,
            "status": "ok",
            "elapsed_ms": elapsed_ms,
            "result": output,
        }
    except Exception as exc:
        elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 1)
        if critical:
            raise
        return {
            "stage": stage_name,
            "status": "error",
            "elapsed_ms": elapsed_ms,
            "error": f"{type(exc).__name__} ({exc})",
        }


def _collect_db_health_snapshot() -> dict[str, Any]:
    """Read post run Medallion row counts and Neon storage size for governance logging."""
    row = fetch_all(
        """
        SELECT
            (SELECT count(*) FROM bronze.air4thai_raw) AS bronze_air4thai,
            (SELECT count(*) FROM bronze.news_raw) AS bronze_news,
            (SELECT count(*) FROM bronze.provincial_stats_raw) AS bronze_stats,
            (SELECT count(*) FROM bronze.bot_docs_raw) AS bronze_pdf_pages,
            (SELECT count(*) FROM silver.air_daily) AS silver_air_daily,
            (SELECT count(*) FROM silver.news_events) AS silver_news_events,
            (SELECT count(*) FROM silver.policy_chunks) AS silver_policy_chunks,
            (SELECT count(*) FROM silver.quarantine) AS silver_quarantine,
            (SELECT count(*) FROM gold.province_monthly_panel) AS gold_monthly_panel,
            (SELECT count(*) FROM gold.province_clusters) AS gold_clusters,
            round((pg_database_size(current_database()) / 1048576.0)::numeric, 2) AS total_neon_db_mb
        """
    )[0]
    return {
        k: (float(v) if k == "total_neon_db_mb" else int(v))
        for k, v in row.items()
    }


def _persist_pipeline_run(run_type: str, report: dict[str, Any]) -> None:
    """Persist structured batch pipeline summary into gold.pipeline_eval_runs."""
    news_stage = next((s for s in report["stages"] if s["stage"] == "silver_news_llm"), None)
    tokens_used = 0
    if news_stage and news_stage["status"] == "ok":
        tokens_used = int(news_stage["result"].get("total_tokens", 0))
    est_cost_thb = round((tokens_used / 1_000_000.0) * 12.0, 4)

    bulk_execute(
        """
        INSERT INTO gold.pipeline_eval_runs (run_type, metrics_json, token_count, estimated_cost_thb)
        VALUES (:run_type, CAST(:metrics_json AS JSONB), :token_count, :estimated_cost_thb)
        """,
        [
            {
                "run_type": run_type,
                "metrics_json": json.dumps(
                    _json_safe(report), ensure_ascii=False, allow_nan=False, default=str
                ),
                "token_count": tokens_used,
                "estimated_cost_thb": est_cost_thb,
            }
        ],
    )


def _check_pre_gold_readiness(upstream_stages: list[dict[str, Any]]) -> dict[str, Any]:
    """Verify all required Bronze/Silver refreshes and minimum coverage before rebuilding Gold."""
    quality = get_data_quality_policy()
    province_n = quality["expected_northern_provinces"]
    ages = quality["provincial_max_age_days"]
    failed_upstream = [s["stage"] for s in upstream_stages if s.get("status") != "ok"]
    counts = fetch_all(
        """
        SELECT
            (SELECT count(*) FROM silver.dim_provinces) AS dim_provinces,
            (SELECT max(period_date) FROM bronze.provincial_stats_raw WHERE dataset_name = 'nso_household_finance') AS nso_latest_period,
            (SELECT count(DISTINCT province_code) FROM silver.provincial_stats_resolved WHERE dataset_name = 'mots_tourism'
                AND period_date >= CURRENT_DATE - (:mots_max_age_days * INTERVAL '1 day')) AS mots_fresh_provinces,
            (SELECT max(period_date) FROM silver.provincial_stats_resolved WHERE dataset_name = 'mots_tourism') AS mots_latest_period,
            (SELECT count(DISTINCT province_code) FROM silver.provincial_stats_resolved WHERE dataset_name = 'open_meteo_pm25'
                AND period_date >= CURRENT_DATE - (:pm25_max_age_days * INTERVAL '1 day')) AS pm25_fresh_provinces,
            (SELECT max(period_date) FROM silver.provincial_stats_resolved WHERE dataset_name = 'open_meteo_pm25') AS pm25_latest_period,
            (SELECT count(DISTINCT province_code) FROM silver.provincial_stats_resolved WHERE dataset_name = 'open_meteo_rainfall'
                AND period_date >= CURRENT_DATE - (:rainfall_max_age_days * INTERVAL '1 day')) AS rainfall_fresh_provinces,
            (SELECT max(period_date) FROM silver.provincial_stats_resolved WHERE dataset_name = 'open_meteo_rainfall') AS rainfall_latest_period,
            (SELECT count(DISTINCT metric_name) FROM bronze.provincial_stats_raw WHERE dataset_name = 'macro_controls'
                AND metric_name IN ('th_cpi_yoy_pct', 'oil_brent_yoy_pct')
                AND period_date >= CURRENT_DATE - (:macro_max_age_days * INTERVAL '1 day')) AS fresh_macro_metrics,
            (SELECT max(period_date) FROM bronze.provincial_stats_raw WHERE dataset_name = 'macro_controls'
                AND metric_name IN ('th_cpi_yoy_pct', 'oil_brent_yoy_pct')) AS macro_latest_period,
            (SELECT count(*) FROM silver.provincial_stats_resolved WHERE has_conflict = TRUE) AS resolved_conflict_keys,
            (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'silver' AND table_name = 'provincial_stats_resolved'
                AND column_name IN ('dataset_name', 'province_code', 'period_date', 'metric_name', 'metric_value', 'source_bronze_id', 'revision_count', 'has_conflict')) AS resolved_schema_columns
        """,
        {
            "nso_max_age_days": ages["nso_household_finance"],
            "mots_max_age_days": ages["mots_tourism"],
            "pm25_max_age_days": ages["open_meteo_pm25"],
            "rainfall_max_age_days": ages["open_meteo_rainfall"],
            "macro_max_age_days": quality["macro_controls_max_age_days"],
        },
    )[0]
    nso_province_rows = fetch_all(
        """
        SELECT DISTINCT province_raw
        FROM bronze.provincial_stats_raw
        WHERE dataset_name = 'nso_household_finance'
          AND period_date >= CURRENT_DATE - (:nso_max_age_days * INTERVAL '1 day')
        """,
        {"nso_max_age_days": ages["nso_household_finance"]},
    )
    dim_p = int(counts["dim_provinces"] or 0)
    mots_fresh_p = int(counts["mots_fresh_provinces"] or 0)
    nso_fresh_p = len({
        province for row in nso_province_rows
        if (province := resolve_northern_province(row.get("province_raw"))) is not None
    })
    pm25_fresh_p = int(counts["pm25_fresh_provinces"] or 0)
    rainfall_fresh_p = int(counts["rainfall_fresh_provinces"] or 0)
    fresh_macro_metrics = int(counts["fresh_macro_metrics"] or 0)
    resolved_conflicts = int(counts["resolved_conflict_keys"] or 0)
    resolved_schema_columns = int(counts["resolved_schema_columns"] or 0)
    reasons: list[str] = []
    if failed_upstream:
        reasons.append(f"Upstream Bronze stages failed ({', '.join(failed_upstream)})")
    if dim_p != province_n:
        reasons.append(f"silver.dim_provinces has {dim_p} rows instead of {province_n}")
    for label, coverage, minimum in (
        ("MOTS", mots_fresh_p, province_n),
        ("NSO finance", nso_fresh_p, province_n),
        ("PM2.5", pm25_fresh_p, province_n),
        ("Rainfall", rainfall_fresh_p, province_n),
    ):
        if coverage < minimum:
            reasons.append(f"{label} fresh provincial coverage is {coverage}/{minimum}")
    if fresh_macro_metrics < 2:
        reasons.append(f"Fresh macro controls are {fresh_macro_metrics}/2 required series")
    if resolved_schema_columns != 8:
        reasons.append(f"Resolved Silver schema has {resolved_schema_columns}/8 required columns")
    if reasons:
        raise RuntimeError("Pre Gold quality gate blocked Gold rebuild (" + "; ".join(reasons) + ")")
    return {
        "gate_passed": True,
        "resolved_coverage": {
            "mots_fresh": mots_fresh_p,
            "nso_fresh": nso_fresh_p,
            "pm25_fresh": pm25_fresh_p,
            "rainfall_fresh": rainfall_fresh_p,
            "expected_provinces": province_n,
        },
        "fresh_macro_metrics": fresh_macro_metrics,
        "latest_periods": {
            "mots": str(counts["mots_latest_period"]) if counts["mots_latest_period"] else None,
            "nso": str(counts["nso_latest_period"]) if counts["nso_latest_period"] else None,
            "pm25": str(counts["pm25_latest_period"]) if counts["pm25_latest_period"] else None,
            "rainfall": str(counts["rainfall_latest_period"]) if counts["rainfall_latest_period"] else None,
            "macro": str(counts["macro_latest_period"]) if counts["macro_latest_period"] else None,
        },
        "resolved_conflict_keys": resolved_conflicts,
        "resolved_conflict_policy": "latest_revision_published_conflicts_reported",
        "resolved_schema_columns": resolved_schema_columns,
    }


def _run_stage_captured(stage_name: str, fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    """Capture an operational stage failure so the batch report can still be persisted."""
    return _execute_stage(stage_name, fn, critical=False)


def _check_daily_readiness(air_stage: dict[str, Any]) -> dict[str, Any]:
    """Gate Silver refresh on a successful source pull and sufficiently broad fresh air coverage."""
    quality = get_data_quality_policy()
    rows = fetch_all(
        """
        SELECT province_raw, recorded_at, pm25_raw
        FROM bronze.air4thai_raw
        WHERE recorded_at >= NOW() - (:max_age_hours * INTERVAL '1 hour')
          AND pm25_raw IS NOT NULL AND pm25_raw >= 0
        """,
        {"max_age_hours": quality["air_daily_max_age_hours"]},
    )
    fresh_provinces = {resolve_northern_province(row.get("province_raw")) for row in rows}
    fresh_provinces.discard(None)
    fresh = len(fresh_provinces)
    minimum_coverage = quality["air_daily_min_coverage_provinces"]
    if air_stage.get("status") != "ok" or fresh < minimum_coverage:
        details = [f"fresh sensor coverage is {fresh}/{minimum_coverage}"]
        if air_stage.get("status") != "ok":
            details.insert(0, "Air4Thai Bronze load failed")
        raise RuntimeError("Pre-Silver gate blocked publish (" + "; ".join(details) + ")")
    return {"gate_passed": True, "fresh_air_provinces": fresh, "minimum_coverage": minimum_coverage}


def run_elt_pipeline(
    mode: str = "daily",
    skip_news_llm: bool = False,
    skip_pdf_sync: bool = False,
    news_limit: int = 30,
) -> dict[str, Any]:
    """Orchestrate incremental daily or full Medallion ELT refresh into Neon PostgreSQL."""
    run_id = f"elt_{mode}_{uuid.uuid4().hex[:10]}"
    started_at = datetime.now(ICT_TZ).isoformat(timespec="seconds")
    t_all = time.perf_counter()
    stages: list[dict[str, Any]] = []

    # Fetch both sources first, then gate transformations so a failed/partial pull cannot replace Silver.
    air_stage = _execute_stage("bronze_air4thai", load_air4thai_to_bronze)
    news_stage = _execute_stage("bronze_news_rss", load_news_to_bronze)
    stages.extend([air_stage, news_stage])
    daily_gate = _run_stage_captured("pre_silver_readiness_gate", lambda: _check_daily_readiness(air_stage))
    stages.append(daily_gate)
    if daily_gate["status"] == "ok":
        silver_air_stage = _execute_stage("silver_air_daily", transform_air4thai_bronze_to_silver)
        stages.append(silver_air_stage)
    else:
        silver_air_stage = {"stage": "silver_air_daily", "status": "skipped_upstream_failed", "elapsed_ms": 0.0}
        stages.append(silver_air_stage)

    # Incremental news extraction runs only when its Bronze source stage succeeded.
    news_silver_stage = None
    if not skip_news_llm and news_stage["status"] == "ok":
        news_silver_stage = _execute_stage(
            "silver_news_llm",
            lambda: run_silver_news_extraction(limit=news_limit, batch_size=10),
        )
        stages.append(news_silver_stage)

    # Step 3 slow moving official monthly and annual statistics refreshed in full mode
    if mode == "full":
        bronze_full_stages = [
            _execute_stage("bronze_mots_tourism", load_mots_to_bronze),
            _execute_stage("bronze_nso_finance", load_nso_household_finance_to_bronze),
            _execute_stage("bronze_open_meteo_hazards", load_historical_hazards_to_bronze),
            _execute_stage("bronze_macro_controls", load_macro_controls_to_bronze),
        ]
        stages.extend(bronze_full_stages)
        required_gold_upstream_stages = [
            air_stage,
            daily_gate,
            silver_air_stage,
            news_stage,
            *bronze_full_stages,
        ]
        if news_silver_stage is not None:
            required_gold_upstream_stages.append(news_silver_stage)
        resolved_stage = _execute_stage("silver_resolve_provincial_stats", resolve_provincial_stats)
        stages.append(resolved_stage)
        required_gold_upstream_stages.append(resolved_stage)

        # Pre Gold fail fast gate prevents publishing Gold marts built from failed or partial Bronze loads
        pre_gold_gate = _run_stage_captured(
            "pre_gold_readiness_gate",
            lambda: _check_pre_gold_readiness(required_gold_upstream_stages),
        )
        stages.append(pre_gold_gate)

        # Step 4 rebuild Gold marts ONLY when Pre Gold readiness gate passed
        if pre_gold_gate["status"] == "ok":
            stages.append(_execute_stage("gold_deep_eda", run_deep_eda))
            stages.append(_execute_stage("gold_feature_screening", lambda: run_full_eda_screening(run_id=run_id, persist=False)))
            shock_stage = _execute_stage("gold_shock_index", lambda: run_shock_index_pipeline(run_id=run_id, persist=False))
            stages.append(shock_stage)
            if shock_stage["status"] == "ok":
                new_panel = shock_stage["result"]["_publish_panel"]
                stages.append(_execute_stage(
                    "gold_clustering",
                    lambda: run_clustering_pipeline(run_id=run_id, persist=False, panel=new_panel, shock_df=new_panel),
                ))
            else:
                stages.append({"stage": "gold_clustering", "status": "skipped_upstream_failed", "elapsed_ms": 0.0})

            screening_stage = next((s for s in stages if s["stage"] == "gold_feature_screening"), None)
            cluster_stage = next((s for s in stages if s["stage"] == "gold_clustering"), None)
            if all(s is not None and s.get("status") == "ok" for s in (screening_stage, shock_stage, cluster_stage)):
                def publish_gold_atomically() -> dict[str, Any]:
                    screen = screening_stage["result"]
                    shock = shock_stage["result"]
                    cluster = cluster_stage["result"]
                    screening_rows = screen["_publish_screening_rows"]
                    panel_rows = shock["_publish_panel"]
                    cluster_rows = cluster["_publish_clusters"]
                    expected_provinces = get_data_quality_policy()["expected_northern_provinces"]
                    if screening_rows.empty or panel_rows.empty or cluster_rows.empty:
                        raise RuntimeError("Atomic Gold publish blocked because one or more computed outputs are empty")
                    if panel_rows["province_code"].nunique() != expected_provinces:
                        raise RuntimeError(
                            f"Atomic Gold publish blocked: monthly panel does not cover {expected_provinces} provinces"
                        )
                    if cluster_rows["province_code"].nunique() != expected_provinces:
                        raise RuntimeError(
                            f"Atomic Gold publish blocked: cluster output does not cover {expected_provinces} provinces"
                        )

                    # All public Gold tables and their lineage/evaluation records share one PostgreSQL transaction.
                    with get_connection() as conn:
                        saved_screen = save_screening_results_to_neon(
                            screening_rows,
                            screen["_publish_ols_summary"],
                            run_id=run_id,
                            data_cutoff=screen["_publish_data_cutoff"],
                            connection=conn,
                        )
                        saved_panel = save_monthly_panel_to_neon(
                            panel_rows, shock["backtest"], run_id=run_id, connection=conn,
                        )
                        saved_clusters = save_clusters_to_neon(
                            cluster_rows,
                            cluster["_publish_benchmarks"],
                            cluster["winner"],
                            run_id=run_id,
                            data_cutoff=cluster["_publish_data_cutoff"],
                            connection=conn,
                        )
                        if saved_panel <= 0 or saved_clusters != expected_provinces or saved_screen <= 0:
                            raise RuntimeError(
                                f"Atomic Gold publish row-count check failed (screen={saved_screen}, panel={saved_panel}, clusters={saved_clusters})"
                            )
                        cur = conn.cursor()
                        try:
                            cur.execute(
                                """
                                SELECT
                                    (SELECT count(*) FROM gold.province_monthly_panel WHERE run_id = %s),
                                    (SELECT count(*) FROM gold.province_clusters WHERE run_id = %s),
                                    (SELECT count(*) FROM gold.feature_screening_results WHERE run_id = %s),
                                    (SELECT count(*) FROM gold.cluster_run_history WHERE run_id = %s)
                                """,
                                (run_id, run_id, run_id, run_id),
                            )
                            lineage_counts = cur.fetchone()
                        finally:
                            cur.close()
                        if (
                            not lineage_counts
                            or int(lineage_counts[0]) != saved_panel
                            or int(lineage_counts[1]) != expected_provinces
                            or int(lineage_counts[2]) != saved_screen
                            or int(lineage_counts[3]) != expected_provinces
                        ):
                            raise RuntimeError(
                                "Atomic Gold publish blocked: panel, screening, cluster, and history rows do not share the expected run_id and row counts"
                            )
                    return {
                        "run_id": run_id,
                        "feature_screening_rows": saved_screen,
                        "monthly_panel_rows": saved_panel,
                        "cluster_rows": saved_clusters,
                        "province_coverage": expected_provinces,
                        "run_id_lineage_verified": True,
                        "transaction": "single_postgresql_commit",
                    }

                stages.append(_run_stage_captured("gold_atomic_publish", publish_gold_atomically))
            else:
                stages.append({
                    "stage": "gold_atomic_publish",
                    "status": "skipped_upstream_failed",
                    "elapsed_ms": 0.0,
                    "error": "One or more Gold computations failed; previous published Gold snapshot remains active",
                })
        else:
            for skipped_name in (
                "gold_deep_eda",
                "gold_feature_screening",
                "gold_shock_index",
                "gold_clustering",
            ):
                stages.append(
                    {
                        "stage": skipped_name,
                        "status": "skipped_upstream_failed",
                        "elapsed_ms": 0.0,
                        "error": pre_gold_gate.get("error"),
                    }
                )

    # Step 5 SHA256 incremental official PDF sync (skips unchanged documents at zero API cost)
    if not skip_pdf_sync:
        stages.append(
            _execute_stage(
                "rag_pdf_sync",
                lambda: index_all_official_pdfs(force_download=False, force_reindex=False),
            )
        )

    # Step 6 deterministic Layer 2 data quality and freshness assertions
    stages.append(
        _execute_stage(
            "layer2_data_quality",
            lambda: run_layer2_data_quality(role="baseline", persist=True),
        )
    )
    stages.append(_execute_stage("drift_monitoring", lambda: run_drift_monitoring(persist=True)))

    db_snapshot = _collect_db_health_snapshot()
    failed_stages = [s["stage"] for s in stages if s["status"] != "ok"]
    critical_stage_names = {
        "silver_air_daily",
        "pre_silver_readiness_gate",
        "bronze_mots_tourism",
        "bronze_nso_finance",
        "pre_gold_readiness_gate",
        "silver_resolve_provincial_stats",
        "gold_feature_screening",
        "gold_shock_index",
        "gold_clustering",
        "gold_atomic_publish",
        "rag_pdf_sync",
        "layer2_data_quality",
    }
    failed_critical_stages = [st for st in failed_stages if st in critical_stage_names]
    total_elapsed_s = round(time.perf_counter() - t_all, 2)

    # Private in-memory DataFrames are used only between the compute and atomic-publish stages.
    for stage in stages:
        result = stage.get("result")
        if isinstance(result, dict):
            for private_key in [key for key in result if key.startswith("_publish_")]:
                result.pop(private_key, None)

    report = {
        "run_id": run_id,
        "mode": mode,
        "git_commit": get_git_commit_short(),
        "feature_spec_version": get_spec_version(),
        "started_at_ict": started_at,
        "finished_at_ict": datetime.now(ICT_TZ).isoformat(timespec="seconds"),
        "total_elapsed_sec": total_elapsed_s,
        "failed_stages": failed_stages,
        "failed_critical_stages": failed_critical_stages,
        "status": "ok" if not failed_stages else ("failed" if failed_critical_stages else "partial_warning"),
        "stages": stages,
        "post_run_db_snapshot": db_snapshot,
    }

    _persist_pipeline_run(f"elt_batch_{mode}", report)
    return report


def _parse_args() -> argparse.Namespace:
    """Parse command line arguments for scheduled or manual ELT pipeline runs."""
    parser = argparse.ArgumentParser(
        description="Run Medallion ELT refresh pipeline for Northern Thailand Risk Analytics."
    )
    parser.add_argument(
        "--mode",
        choices=("daily", "full"),
        default="daily",
        help="Daily refreshes live sensors, news, and SHA256 PDF sync. Full rebuilds macro, MOTS, NSO, and Gold.",
    )
    parser.add_argument(
        "--skip-news-llm",
        action="store_true",
        help="Skip Gemini news extraction when running offline or sensor only checks.",
    )
    parser.add_argument(
        "--skip-pdf-sync",
        action="store_true",
        help="Skip official PDF download and incremental pgvector sync.",
    )
    parser.add_argument(
        "--news-limit",
        type=int,
        default=30,
        help="Maximum pending Bronze news articles to extract per scheduled batch.",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    summary = run_elt_pipeline(
        mode=args.mode,
        skip_news_llm=args.skip_news_llm,
        skip_pdf_sync=args.skip_pdf_sync,
        news_limit=args.news_limit,
    )
    print(json.dumps(_json_safe(summary), ensure_ascii=False, indent=2, allow_nan=False, default=str))
    if summary["failed_stages"]:
        sys.stderr.write(
            f"Pipeline stage failure detected in {summary['failed_stages']}\n"
        )
    if summary.get("failed_critical_stages") or len(summary["failed_stages"]) == len(summary["stages"]):
        sys.exit(1)
