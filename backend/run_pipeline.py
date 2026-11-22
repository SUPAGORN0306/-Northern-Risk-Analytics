"""End to end Medallion ELT batch orchestrator for scheduled daily or full refresh into Neon."""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.analytics.clustering import run_clustering_pipeline
from src.analytics.eda_feature_selection import run_full_eda_screening
from src.analytics.shock_index import run_shock_index_pipeline
from src.config.feature_registry import get_git_commit_short, get_spec_version
from src.db.connection import bulk_execute, fetch_all
from src.evaluation.layered_eval import run_layer2_data_quality
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


def run_elt_pipeline(
    mode: str = "daily",
    skip_news_llm: bool = False,
    skip_pdf_sync: bool = False,
    news_limit: int = 30,
) -> dict[str, Any]:
    """Orchestrate incremental daily or full Medallion ELT refresh into Neon PostgreSQL."""
    started_at = datetime.now(ICT_TZ).isoformat(timespec="seconds")
    t_all = time.perf_counter()
    stages: list[dict[str, Any]] = []

    # Step 1 live Air4Thai sensor extraction and Silver quarantine cleaning
    stages.append(_execute_stage("bronze_air4thai", load_air4thai_to_bronze))
    stages.append(_execute_stage("silver_air_daily", transform_air4thai_bronze_to_silver))

    # Step 2 live Google News RSS extraction and incremental LLM shock extraction
    stages.append(_execute_stage("bronze_news_rss", load_news_to_bronze))
    if not skip_news_llm:
        stages.append(
            _execute_stage(
                "silver_news_llm",
                lambda: run_silver_news_extraction(limit=news_limit, batch_size=10),
            )
        )

    # Step 3 slow moving official monthly and annual statistics refreshed in full mode
    if mode == "full":
        stages.append(_execute_stage("bronze_mots_tourism", load_mots_to_bronze))
        stages.append(_execute_stage("bronze_nso_finance", load_nso_household_finance_to_bronze))
        stages.append(_execute_stage("bronze_open_meteo_hazards", load_historical_hazards_to_bronze))
        stages.append(_execute_stage("bronze_macro_controls", load_macro_controls_to_bronze))

        # Step 4 refresh empirical feature screening and rebuild Gold shock index and clustering
        stages.append(_execute_stage("gold_feature_screening", run_full_eda_screening))
        stages.append(_execute_stage("gold_shock_index", run_shock_index_pipeline, critical=True))
        stages.append(_execute_stage("gold_clustering", run_clustering_pipeline, critical=True))

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

    db_snapshot = _collect_db_health_snapshot()
    failed_stages = [s["stage"] for s in stages if s["status"] != "ok"]
    critical_stage_names = {
        "silver_air_daily",
        "bronze_mots_tourism",
        "bronze_nso_finance",
        "gold_feature_screening",
        "gold_shock_index",
        "gold_clustering",
        "rag_pdf_sync",
        "layer2_data_quality",
    }
    failed_critical_stages = [st for st in failed_stages if st in critical_stage_names]
    total_elapsed_s = round(time.perf_counter() - t_all, 2)

    report = {
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
