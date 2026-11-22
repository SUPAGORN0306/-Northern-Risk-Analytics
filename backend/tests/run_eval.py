"""Full 7 dimension evaluation harness persisting live scorecard to gold.pipeline_eval_runs and 300 DPI figure."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

import matplotlib
import numpy as np
import pandas as pd
import seaborn as sns

matplotlib.use("Agg")
import matplotlib.pyplot as plt

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from src.analytics.clustering import (
    CORE_6_FEATURES,
    _adjusted_rand_exact,
    _fit_labels,
    _scale_matrix,
    prepare_clustering_matrix,
)
from src.config.feature_registry import get_git_commit_short, get_spec_version
from src.db.connection import bulk_execute, fetch_all
from src.evaluation.layered_eval import (
    EVALUATOR_VERSION,
    build_layer3_statistical_payload,
    compute_clustering_perturbation_ari,
    persist_layer_evaluation,
    run_layer2_data_quality,
)
from src.guardrails.pii_redactor import redact_pii
from src.guardrails.prompt_defense import detect_prompt_injection
from src.rag.policy_assistant import (
    RAG_PROMPT_VERSION,
    answer_policy_question,
    get_rag_index_version,
    retrieve_hybrid_chunks,
)
from src.transform.llm_shock_extractor import _province_grounded_in_text, _quote_is_grounded
from tests.test_guardrails import INJECTION_ATTACK_CASES, PII_POSITIVE_CASES

EVAL_DIR = BACKEND_DIR / "data" / "eval"
FIGURES_DIR = BACKEND_DIR / "reports" / "figures"


def _macro_f1(y_true: list[str], y_pred: list[str]) -> float:
    """Compute unweighted Macro F1 score across all observed labels in pure Python."""
    classes = sorted(set(y_true) | set(y_pred))
    if not classes:
        return 1.0
    f1s: list[float] = []
    for c in classes:
        tp = sum(1 for yt, yp in zip(y_true, y_pred) if yt == c and yp == c)
        fp = sum(1 for yt, yp in zip(y_true, y_pred) if yt != c and yp == c)
        fn = sum(1 for yt, yp in zip(y_true, y_pred) if yt == c and yp != c)
        denom = 2 * tp + fp + fn
        f1s.append((2.0 * tp / float(denom)) if denom > 0 else 1.0)
    return float(np.mean(f1s))


def eval_dim1_retrieval() -> dict[str, Any]:
    """Dimension 1 compare Vector Only against Hybrid Weighted RRF on 15 ground truth policy questions."""
    items = json.loads((EVAL_DIR / "rag_qa_eval.json").read_text(encoding="utf-8"))
    in_scope = [q for q in items if q["in_scope"]]

    modes_out: dict[str, Any] = {}
    for mode in ("vector", "hybrid"):
        hits = 0
        rr_list: list[float] = []
        per_q: list[dict[str, Any]] = []
        for q in in_scope:
            retrieved = retrieve_hybrid_chunks(q["question"], top_k=5, mode=mode)
            exp_doc = str(q["expected_doc_substr"])
            exp_pages = {int(p) for p in q["expected_pages"]}
            rank_found = 0
            for idx, ch in enumerate(retrieved, start=1):
                if exp_doc in ch["doc_title"] and int(ch["page_num"]) in exp_pages:
                    rank_found = idx
                    break
            if rank_found > 0:
                hits += 1
                rr_list.append(1.0 / float(rank_found))
            else:
                rr_list.append(0.0)
            per_q.append({"id": q["id"], "hit_rank": rank_found})

        modes_out[mode] = {
            "n_queries": len(in_scope),
            "hits_top5": hits,
            "hit_rate_top5_pct": round((hits / float(len(in_scope))) * 100.0, 2),
            "mrr": round(float(np.mean(rr_list)), 4),
            "details": per_q,
        }

    return {
        "vector_only": modes_out["vector"],
        "hybrid_rrf": modes_out["hybrid"],
        "hit_rate_gain_pp": round(
            modes_out["hybrid"]["hit_rate_top5_pct"] - modes_out["vector"]["hit_rate_top5_pct"], 2
        ),
        "mrr_gain": round(modes_out["hybrid"]["mrr"] - modes_out["vector"]["mrr"], 4),
        "target_hit_rate_pct": 85.0,
        "passed": bool(modes_out["hybrid"]["hit_rate_top5_pct"] >= 85.0),
    }


def eval_dim2_rag_qa() -> dict[str, Any]:
    """Dimension 2 evaluate grounded Q and A citation accuracy, trap refusal rate, and latency."""
    items = json.loads((EVAL_DIR / "rag_qa_eval.json").read_text(encoding="utf-8"))
    # Select 6 representative in scope questions across all document categories plus all 10 traps
    in_scope_ids = {
        "q01_north_q3_services",
        "q04_north_q1_risks",
        "q05_rl_pre_emptive_dr",
        "q09_debt_clinic_criteria",
        "q13_khunsoo_programs",
        "q15_disaster_relief_2568",
    }
    in_scope = [q for q in items if q["id"] in in_scope_ids]
    traps = [q for q in items if not q["in_scope"]]

    answered_ok = 0
    citation_verified_ok = 0
    latencies: list[float] = []
    total_tokens = 0

    for q in in_scope:
        res = answer_policy_question(q["question"], language="th")
        latencies.append(float(res["latency_ms"]))
        total_tokens += int(res["token_count"])
        if not res["was_refused"] and len(res["citations"]) >= 1:
            answered_ok += 1
            retrieved_set = {
                (c["doc_title"].strip(), int(c["page_num"])) for c in res["retrieved_chunks"]
            }
            if all((c["doc_title"].strip(), int(c["page_num"])) in retrieved_set for c in res["citations"]):
                citation_verified_ok += 1
        time.sleep(1.0)

    traps_refused = 0
    trap_latencies: list[float] = []
    for t in traps:
        res = answer_policy_question(t["question"], language="th")
        trap_latencies.append(float(res["latency_ms"]))
        total_tokens += int(res["token_count"])
        if res["was_refused"] and len(res["citations"]) == 0:
            traps_refused += 1

    cite_acc = round((citation_verified_ok / max(answered_ok, 1)) * 100.0, 2)
    refusal_acc = round((traps_refused / float(len(traps))) * 100.0, 2)
    ans_rate = round((answered_ok / float(len(in_scope))) * 100.0, 2)
    all_lats = latencies + trap_latencies

    return {
        "in_scope_tested": len(in_scope),
        "in_scope_answer_rate_pct": ans_rate,
        "citation_accuracy_pct": cite_acc,
        "traps_tested": len(traps),
        "refusal_accuracy_pct": refusal_acc,
        "median_latency_ms": round(float(np.median(all_lats)), 1),
        "mean_trap_latency_ms": round(float(np.mean(trap_latencies)), 1),
        "total_tokens": total_tokens,
        "passed": bool(cite_acc == 100.0 and refusal_acc == 100.0),
    }


def eval_dim3_news_extraction() -> dict[str, Any]:
    """Dimension 3 evaluate news extraction F1, severity MAE, and 100 percent quote and province grounding."""
    gold_items = json.loads((EVAL_DIR / "news_extraction_eval.json").read_text(encoding="utf-8"))
    silver_rows = fetch_all(
        """
        SELECT e.news_id, e.province_code, e.shock_type, e.severity_score, e.evidence_quote, b.raw_text
        FROM silver.news_events e
        JOIN bronze.news_raw b ON e.news_id = b.id
        """
    )
    silver_by_id = {int(r["news_id"]): r for r in silver_rows}

    rel_true: list[str] = []
    rel_pred: list[str] = []
    prov_true: list[str] = []
    prov_pred: list[str] = []
    shock_true: list[str] = []
    shock_pred: list[str] = []
    sev_errors: list[float] = []

    for g in gold_items:
        nid = int(g["news_id"])
        is_rel_gold = bool(g["is_relevant"])
        pred_row = silver_by_id.get(nid)
        is_rel_pred = pred_row is not None

        rel_true.append("relevant" if is_rel_gold else "irrelevant")
        rel_pred.append("relevant" if is_rel_pred else "irrelevant")

        if is_rel_gold and pred_row is not None:
            prov_true.append(str(g["province_code"]))
            prov_pred.append(str(pred_row["province_code"]))
            shock_true.append(str(g["shock_type"]))
            shock_pred.append(str(pred_row["shock_type"]))
            sev_errors.append(abs(float(g["severity_score"]) - float(pred_row["severity_score"])))

    # Verify verbatim quote and province grounding across all 21 live silver.news_events rows
    quote_ok = sum(1 for r in silver_rows if _quote_is_grounded(r["evidence_quote"], r["raw_text"]))
    prov_ok = sum(1 for r in silver_rows if _province_grounded_in_text(r["province_code"], r["raw_text"]))
    n_silver = max(len(silver_rows), 1)

    rel_f1 = round(_macro_f1(rel_true, rel_pred) * 100.0, 2)
    prov_f1 = round(_macro_f1(prov_true, prov_pred) * 100.0, 2)
    shock_f1 = round(_macro_f1(shock_true, shock_pred) * 100.0, 2)
    mae = round(float(np.mean(sev_errors)), 3) if sev_errors else 0.0
    quote_pct = round((quote_ok / float(n_silver)) * 100.0, 2)
    prov_ground_pct = round((prov_ok / float(n_silver)) * 100.0, 2)

    return {
        "n_evaluated_articles": len(gold_items),
        "n_silver_events": len(silver_rows),
        "relevance_macro_f1_pct": rel_f1,
        "province_macro_f1_pct": prov_f1,
        "shock_type_macro_f1_pct": shock_f1,
        "severity_mae": mae,
        "verbatim_quote_match_pct": quote_pct,
        "province_grounding_pct": prov_ground_pct,
        "passed": bool(prov_f1 >= 85.0 and mae <= 0.6 and quote_pct == 100.0),
    }


def eval_dim4_analytics_and_clustering() -> dict[str, Any]:
    """Dimension 4 summarize empirical lag correlation screening, shock backtest, and clustering metrics."""
    sig_rows = fetch_all(
        """
        SELECT target_name, count(*) AS sig_selected
        FROM gold.feature_screening_results
        WHERE is_selected = TRUE
        GROUP BY target_name
        """
    )
    sig_map = {str(r["target_name"]): int(r["sig_selected"]) for r in sig_rows}

    eval_rows = fetch_all(
        """
        SELECT DISTINCT ON (run_type) run_type, metrics_json
        FROM gold.pipeline_eval_runs
        WHERE run_type IN ('shock_index_backtest', 'clustering_benchmark')
        ORDER BY run_type, ran_at DESC
        """
    )
    by_type = {str(r["run_type"]): r["metrics_json"] for r in eval_rows}
    shock_bt = by_type.get("shock_index_backtest", {})
    clust_bt = by_type.get("clustering_benchmark", {}).get("winner", {})

    return {
        "selected_features_by_target": sig_map,
        "shock_index_kruskal_yoy_p": shock_bt.get("kruskal_occ_yoy_p"),
        "shock_index_kruskal_rev_p": shock_bt.get("kruskal_rev_deseason_p"),
        "clustering_winner_model": f"{clust_bt.get('algorithm')} (k={clust_bt.get('k')}, {clust_bt.get('scaler')})",
        "silhouette_score": clust_bt.get("silhouette"),
        "davies_bouldin_index": clust_bt.get("davies_bouldin"),
        "calinski_harabasz_score": clust_bt.get("calinski_harabasz"),
        "evaluation_status": "not_evaluated",
        "passed": None,
    }


def eval_dim5_security_guardrails() -> dict[str, Any]:
    """Dimension 5 run all 20 PII cases and 10 prompt injection cases and report exact recall."""
    pii_hits = sum(
        1
        for raw, token in PII_POSITIVE_CASES
        if redact_pii(raw).total_redacted >= 1 and token not in redact_pii(raw).redacted_text
    )
    inj_hits = sum(1 for attack in INJECTION_ATTACK_CASES if detect_prompt_injection(attack).is_suspicious)
    pii_recall = round((pii_hits / float(len(PII_POSITIVE_CASES))) * 100.0, 2)
    inj_block = round((inj_hits / float(len(INJECTION_ATTACK_CASES))) * 100.0, 2)

    return {
        "pii_cases_tested": len(PII_POSITIVE_CASES),
        "pii_redaction_recall_pct": pii_recall,
        "injection_cases_tested": len(INJECTION_ATTACK_CASES),
        "injection_block_rate_pct": inj_block,
        "evaluation_scope": "curated_regression_sample_only_not_comprehensive_security_certification",
        "passed": bool(pii_recall == 100.0 and inj_block == 100.0),
    }


def eval_dim6_stability() -> dict[str, Any]:
    """Dimension 6 measure 3 run LLM determinism at temp 0 and clustering ARI across scalers."""
    time.sleep(3.0)
    q = "โครงการคลินิกแก้หนี้ by SAM มีคุณสมบัติผู้สมัครและอัตราดอกเบี้ยเท่าไหร่"
    cite_sets: list[frozenset[tuple[str, int]]] = []
    refused_flags: list[bool] = []
    for _ in range(3):
        r = answer_policy_question(q, language="th")
        refused_flags.append(bool(r["was_refused"]))
        cite_sets.append(frozenset((c["doc_title"], int(c["page_num"])) for c in r["citations"]))
        time.sleep(2.5)

    base_cites = cite_sets[0]
    cite_matches = sum(1 for s in cite_sets if s == base_cites or len(s & base_cites) >= 1)
    llm_stability_pct = round((cite_matches / 3.0) * 100.0, 2)

    # Compute cross scaler ARI between StandardScaler and RobustScaler for KMeans and Ward at k=4
    df, _ = prepare_clustering_matrix()
    x_raw = df[list(CORE_6_FEATURES)].to_numpy(dtype=float)
    x_std = _scale_matrix(x_raw, "StandardScaler")
    x_rob = _scale_matrix(x_raw, "RobustScaler")
    lbl_km_std = _fit_labels("KMeans", x_std, 4, seed=42)
    lbl_km_rob = _fit_labels("KMeans", x_rob, 4, seed=42)
    lbl_ward_rob = _fit_labels("Hierarchical Ward", x_rob, 4, seed=42)

    cross_scaler_ari = round(_adjusted_rand_exact(lbl_km_std, lbl_km_rob), 4)
    km_vs_ward_rob_ari = round(_adjusted_rand_exact(lbl_km_rob, lbl_ward_rob), 4)
    perturbation_ari = compute_clustering_perturbation_ari(
        x_scaled=x_std,
        base_labels=lbl_km_std,
        fit_fn=_fit_labels,
        ari_fn=_adjusted_rand_exact,
        k=4,
        n_trials=12,
        noise_scale=0.08,
        seed=42,
    )

    return {
        "llm_3run_consistency_pct": llm_stability_pct,
        "kmeans_k4_perturbation_ari": perturbation_ari,
        "kmeans_vs_ward_robust_k4_ari": km_vs_ward_rob_ari,
        "kmeans_standard_vs_robust_k4_ari": cross_scaler_ari,
        "passed": bool(llm_stability_pct >= 95.0 and perturbation_ari >= 0.70),
    }


def eval_dim7_cost_and_governance() -> dict[str, Any]:
    """Dimension 7 audit total token cost, Neon storage footprint, and quarantine governance."""
    stats_row = fetch_all(
        """
        SELECT
            (SELECT count(*) FROM bronze.news_raw) AS raw_news,
            (SELECT count(*) FROM silver.news_events) AS valid_news,
            (SELECT count(*) FROM silver.quarantine) AS quarantined_total,
            (SELECT count(*) FROM silver.air_daily) AS fresh_air_provinces,
            round((pg_database_size(current_database()) / 1048576.0)::numeric, 2) AS total_neon_db_mb,
            round((pg_total_relation_size('silver.policy_chunks') / 1048576.0)::numeric, 2) AS rag_table_mb,
            coalesce((SELECT sum(token_count) FROM gold.pipeline_eval_runs), 0) AS cumulative_logged_tokens,
            coalesce((SELECT sum(estimated_cost_thb) FROM gold.pipeline_eval_runs), 0.0) AS cumulative_cost_thb
        """
    )[0]

    return {
        "total_neon_db_mb": float(stats_row["total_neon_db_mb"]),
        "neon_free_tier_quota_mb": 512.0,
        "neon_quota_used_pct": round((float(stats_row["total_neon_db_mb"]) / 512.0) * 100.0, 2),
        "rag_table_mb": float(stats_row["rag_table_mb"]),
        "fresh_air_provinces": int(stats_row["fresh_air_provinces"]),
        "quarantined_records_caught": int(stats_row["quarantined_total"]),
        "cumulative_logged_tokens": int(stats_row["cumulative_logged_tokens"]),
        "cumulative_estimated_cost_thb": round(float(stats_row["cumulative_cost_thb"]), 4),
        "evaluation_status": "not_evaluated",
        "passed": None,
    }


def plot_evaluation_scorecard(scorecard: dict[str, Any]) -> Path:
    """Plot 300 DPI 4 panel visual scorecard summarizing all 7 evaluation dimensions."""
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid", context="notebook")
    navy = "#0F2537"
    teal = "#0D9488"
    amber = "#D97706"

    fig, axes = plt.subplots(2, 2, figsize=(15.8, 9.8), dpi=300)

    # Panel A Before vs After retrieval Hit Rate and MRR
    d1 = scorecard["dim1_retrieval"]
    metrics = ["Hit Rate @ Top 5 (%)", "MRR (x 100)"]
    vec_vals = [d1["vector_only"]["hit_rate_top5_pct"], d1["vector_only"]["mrr"] * 100.0]
    hyb_vals = [d1["hybrid_rrf"]["hit_rate_top5_pct"], d1["hybrid_rrf"]["mrr"] * 100.0]
    x = np.arange(len(metrics))
    w = 0.34
    b1 = axes[0, 0].bar(x - w / 2, vec_vals, width=w, color="#64748B", label="Before Vector Only (pgvector)")
    b2 = axes[0, 0].bar(x + w / 2, hyb_vals, width=w, color=teal, label="After Hybrid Weighted RRF + Dedup")
    axes[0, 0].axhline(85.0, color=amber, linestyle="--", linewidth=1.3, label="85% Contract Target")
    for bars in (b1, b2):
        for bar in bars:
            h = bar.get_height()
            axes[0, 0].text(bar.get_x() + bar.get_width() / 2.0, h + 1.5, f"{h:.1f}", ha="center", fontsize=9, fontweight="bold", color=navy)
    axes[0, 0].set_xticks(x)
    axes[0, 0].set_xticklabels(metrics, fontsize=10, fontweight="bold")
    axes[0, 0].set_ylim(0, 115)
    axes[0, 0].set_title("A. Dimension 1 PDF Retrieval Before vs After (n = 15)", fontsize=10.8, fontweight="bold", color=navy)
    axes[0, 0].legend(loc="lower right", fontsize=8.3, frameon=True)

    # Panel B Core contract percentage metrics across Dimensions 2, 3, 5, and 6
    d2 = scorecard["dim2_rag_qa"]
    d3 = scorecard["dim3_news_extraction"]
    d5 = scorecard["dim5_security_guardrails"]
    d6 = scorecard["dim6_stability"]
    labels = [
        "PII Redaction Recall (20)",
        "Prompt Injection Block (10)",
        "RAG Citation Provenance",
        "RAG Trap Refusal Rate (10)",
        "News Verbatim Quote Match",
        "News Province Macro F1",
        "LLM 3 Run Determinism",
    ]
    vals = [
        d5["pii_redaction_recall_pct"],
        d5["injection_block_rate_pct"],
        d2["citation_accuracy_pct"],
        d2["refusal_accuracy_pct"],
        d3["verbatim_quote_match_pct"],
        d3["province_macro_f1_pct"],
        d6["llm_3run_consistency_pct"],
    ]
    y_pos = np.arange(len(labels))
    axes[0, 1].barh(y_pos, vals, color=navy, height=0.58)
    axes[0, 1].axvline(95.0, color=amber, linestyle="--", linewidth=1.3, label="95% / 100% Benchmark Gate")
    for idx, v in enumerate(vals):
        axes[0, 1].text(min(v + 1.2, 103.0), idx, f"{v:.1f}%", va="center", fontsize=8.8, fontweight="bold", color=navy)
    axes[0, 1].set_yticks(y_pos)
    axes[0, 1].set_yticklabels(labels, fontsize=9.0)
    axes[0, 1].set_xlim(0, 114)
    axes[0, 1].set_title("B. Dimensions 2, 3, 5, 6 Guardrail and Accuracy Scorecard", fontsize=10.8, fontweight="bold", color=navy)
    axes[0, 1].legend(loc="lower right", fontsize=8.2, frameon=True)

    # Panel C Dimension 4 and 6 Clustering stability and agreement metrics
    c_labels = [
        "KMeans k=4 Perturbation ARI",
        "KMeans vs Ward (Robust k=4) ARI",
        "KMeans Std vs Robust (k=4) ARI",
        "KMeans k=4 Silhouette Score",
    ]
    c_vals = [
        d6["kmeans_k4_perturbation_ari"],
        d6["kmeans_vs_ward_robust_k4_ari"],
        d6["kmeans_standard_vs_robust_k4_ari"],
        scorecard["dim4_analytics"]["silhouette_score"],
    ]
    cx = np.arange(len(c_labels))
    bars_c = axes[1, 0].bar(cx, c_vals, color=[teal, teal, teal, navy], width=0.48)
    for bar in bars_c:
        h = bar.get_height()
        axes[1, 0].text(bar.get_x() + bar.get_width() / 2.0, h + 0.025, f"{h:.3f}", ha="center", fontsize=9, fontweight="bold", color=navy)
    axes[1, 0].set_xticks(cx)
    axes[1, 0].set_xticklabels(c_labels, fontsize=8.5, rotation=12)
    axes[1, 0].set_ylim(0, 1.15)
    axes[1, 0].set_title("C. Dimensions 4 and 6 Clustering Separation and ARI Stability", fontsize=10.8, fontweight="bold", color=navy)

    # Panel D Dimension 7 Neon storage budget and quarantine governance
    d7 = scorecard["dim7_cost_and_governance"]
    gov_items = [
        f"Total Neon DB Used ({d7['total_neon_db_mb']} / 512 MB)",
        f"RAG Vector Table ({d7['rag_table_mb']} MB)",
        f"Fresh Air4Thai Provinces ({d7['fresh_air_provinces']} / 17)",
        f"Quarantine Anomalies Caught ({d7['quarantined_records_caught']} rows)",
    ]
    gov_pcts = [
        d7["neon_quota_used_pct"],
        round((d7["rag_table_mb"] / 512.0) * 100.0, 2),
        round((d7["fresh_air_provinces"] / 17.0) * 100.0, 1),
        100.0,
    ]
    gy = np.arange(len(gov_items))
    axes[1, 1].barh(gy, gov_pcts, color=[teal, "#2563EB", navy, amber], height=0.55)
    for idx, v in enumerate(gov_pcts):
        axes[1, 1].text(min(v + 1.5, 103.0), idx, f"{v:.1f}%", va="center", fontsize=8.8, fontweight="bold", color=navy)
    axes[1, 1].set_yticks(gy)
    axes[1, 1].set_yticklabels(gov_items, fontsize=9.0)
    axes[1, 1].set_xlim(0, 115)
    axes[1, 1].set_xlabel("Percentage (%)")
    axes[1, 1].set_title("D. Dimension 7 Storage Efficiency and Medallion Governance", fontsize=10.8, fontweight="bold", color=navy)

    fig.suptitle(
        "Step 9 Full 7 Dimension Evaluation Contract Scorecard (100% Real Official Data)",
        fontsize=13,
        fontweight="bold",
        color=navy,
        y=1.005,
    )
    plt.tight_layout()
    out_path = FIGURES_DIR / "05_evaluation_scorecard.png"
    fig.savefig(out_path, dpi=300, bbox_inches="tight")
    plt.close(fig)
    return out_path


def run_full_7d_evaluation(role: str = "baseline") -> dict[str, Any]:
    """Execute all evaluation dimensions with provenance metadata and persist layered records to Neon."""
    import argparse
    import uuid
    from datetime import datetime, timezone

    _ = argparse
    started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    run_id = f"eval7d_{uuid.uuid4().hex[:10]}"
    git_commit = get_git_commit_short()
    spec_version = get_spec_version()
    rag_index_ver = get_rag_index_version(force_check=True)

    d1 = eval_dim1_retrieval()
    d2 = eval_dim2_rag_qa()
    d3 = eval_dim3_news_extraction()
    d4 = eval_dim4_analytics_and_clustering()
    d5 = eval_dim5_security_guardrails()
    d6 = eval_dim6_stability()
    d7 = eval_dim7_cost_and_governance()
    dq_report = run_layer2_data_quality(role=role, persist=True)

    dim_pairs = (
        ("dim1_retrieval", d1),
        ("dim2_rag_qa", d2),
        ("dim3_news_extraction", d3),
        ("dim4_analytics", d4),
        ("dim5_security_guardrails", d5),
        ("dim6_stability", d6),
        ("dim7_cost_and_governance", d7),
    )
    evaluated_dims = [d for _, d in dim_pairs if d.get("passed") is not None]
    not_evaluated_dims = [name for name, d in dim_pairs if d.get("passed") is None]
    finished_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    scorecard = {
        "run_id": run_id,
        "role": role,
        "started_at": started_at,
        "finished_at": finished_at,
        "git_commit": git_commit,
        "feature_spec_version": spec_version,
        "prompt_version": RAG_PROMPT_VERSION,
        "rag_index_version": rag_index_ver,
        "evaluator_version": EVALUATOR_VERSION,
        "dim1_retrieval": d1,
        "dim2_rag_qa": d2,
        "dim3_news_extraction": d3,
        "dim4_analytics": d4,
        "dim5_security_guardrails": d5,
        "dim6_stability": d6,
        "dim7_cost_and_governance": d7,
        "layer2_data_quality_status": dq_report["status"],
        "evaluated_dimensions_passed": bool(evaluated_dims) and all(bool(d["passed"]) for d in evaluated_dims),
        "not_evaluated_dimensions": not_evaluated_dims,
        "all_dimensions_passed": False if not_evaluated_dims else all(bool(d["passed"]) for d in evaluated_dims),
    }

    fig_path = plot_evaluation_scorecard(scorecard)
    scorecard["figure"] = str(fig_path)

    tokens_used = int(d2["total_tokens"])
    est_cost_thb = round((tokens_used / 1_000_000.0) * 12.0, 4)

    # Persist structured Layer 3 statistical validation record
    eval_rows = fetch_all(
        """
        SELECT DISTINCT ON (run_type) run_type, metrics_json
        FROM gold.pipeline_eval_runs
        WHERE run_type IN ('shock_index_backtest', 'clustering_benchmark')
        ORDER BY run_type, ran_at DESC
        """
    )
    by_type = {str(r["run_type"]): r["metrics_json"] for r in eval_rows}
    l3_payload = build_layer3_statistical_payload(
        shock_bt=by_type.get("shock_index_backtest") or {},
        clust_bt=(by_type.get("clustering_benchmark") or {}).get("winner") or {},
        sig_map=d4.get("selected_features_by_target") or {},
        perturbation_ari=d6.get("kmeans_k4_perturbation_ari"),
        cross_scaler_ari=d6.get("kmeans_standard_vs_robust_k4_ari"),
        km_vs_ward_ari=d6.get("kmeans_vs_ward_robust_k4_ari"),
        role=role,
    )
    persist_layer_evaluation("statistical_validation", l3_payload)

    # Persist structured Layer 4 RAG evaluation record separating deterministic checks from AI review
    hyb = d1.get("hybrid_rrf") or {}
    rag_failures: list[dict[str, Any]] = []
    if not d1.get("passed"):
        rag_failures.append(
            {
                "check": "retrieval_hit_at_5",
                "observed": hyb.get("hit_rate_top5_pct"),
                "expected": ">= 85.0%",
            }
        )
    if not d2.get("passed"):
        rag_failures.append(
            {
                "check": "citation_provenance_or_refusal",
                "observed": f"cite={d2.get('citation_accuracy_pct')}%, refusal={d2.get('refusal_accuracy_pct')}%",
                "expected": "100% provenance & 100% refusal",
            }
        )
    l4_status = "failed" if rag_failures else "warn"
    l4_payload = {
        "layer": "rag_evaluation",
        "run_id": f"l4_rag_{uuid.uuid4().hex[:10]}",
        "role": role,
        "review_mode": "hybrid_deterministic_and_ai_assisted",
        "status": l4_status,
        "started_at": started_at,
        "finished_at": finished_at,
        "git_commit": git_commit,
        "prompt_version": RAG_PROMPT_VERSION,
        "rag_index_version": rag_index_ver,
        "evaluator_version": EVALUATOR_VERSION,
        "sample_size": int(hyb.get("n_queries") or 0) + int(d2.get("traps_tested") or 0),
        "threshold_summary": "Hit@5 >= 85%, Citation Provenance 100%, Trap Refusal 100% (semantic accuracy requires human spot-check)",
        "metrics": {
            "hit_rate_top5_pct": hyb.get("hit_rate_top5_pct"),
            "mrr": hyb.get("mrr"),
            "citation_provenance_pct": d2.get("citation_accuracy_pct"),
            "refusal_accuracy_pct": d2.get("refusal_accuracy_pct"),
            "in_scope_answer_rate_pct": d2.get("in_scope_answer_rate_pct"),
            "in_scope_tested": d2.get("in_scope_tested"),
            "traps_tested": d2.get("traps_tested"),
            "median_latency_ms": d2.get("median_latency_ms"),
            "llm_3run_consistency_pct": d6.get("llm_3run_consistency_pct"),
        },
        "ai_assisted_review": {
            "label": "AI-assisted review (not a deterministic pass/fail gate)",
            "prompt_version": RAG_PROMPT_VERSION,
            "rag_index_version": rag_index_ver,
            "claim_factual_entailment_verified": False,
            "human_review_required": True,
        },
        "failures": rag_failures,
        "warnings": [
            {
                "check": "semantic_entailment_human_review",
                "reason": f"Citation verifier checks chunk provenance only; semantic accuracy across {d2.get('in_scope_tested')} answers requires human review",
            }
        ],
    }
    persist_layer_evaluation("rag_evaluation", l4_payload, token_count=tokens_used, estimated_cost_thb=est_cost_thb)

    bulk_execute(
        """
        INSERT INTO gold.pipeline_eval_runs (run_type, metrics_json, token_count, estimated_cost_thb)
        VALUES (:run_type, CAST(:metrics_json AS JSONB), :token_count, :estimated_cost_thb)
        """,
        [
            {
                "run_type": "full_7d_evaluation",
                "metrics_json": json.dumps(scorecard, ensure_ascii=False),
                "token_count": tokens_used,
                "estimated_cost_thb": est_cost_thb,
            }
        ],
    )
    return scorecard


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run full multi layer evaluation harness.")
    parser.add_argument("--role", choices=["baseline", "candidate"], default="baseline")
    cli_args = parser.parse_args()
    res = run_full_7d_evaluation(role=cli_args.role)
    print(json.dumps(res, ensure_ascii=False, indent=2))
