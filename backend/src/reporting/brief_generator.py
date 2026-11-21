"""One-page bilingual policy brief generator backed by live Neon Gold and Silver tables."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any

from src.db.connection import fetch_all
from src.guardrails.schemas import resolve_northern_province

ICT_TZ = timezone(timedelta(hours=7))

_SHOCK_TYPE_TH: dict[str, str] = {
    "pm25": "ฝุ่น PM2.5",
    "flood": "อุทกภัย",
    "water_pollution": "มลพิษ/สารพิษทางน้ำ",
    "demand_drop": "อุปสงค์ชะลอตัว",
    "cost_surge": "ต้นทุนพุ่งสูงฉับพลัน",
    "cost_inflation": "แรงกดดันต้นทุนและเงินเฟ้อ",
    "policy_relief": "มาตรการช่วยเหลือ",
}

_SHOCK_TYPE_EN: dict[str, str] = {
    "pm25": "PM2.5 Haze",
    "flood": "Flooding",
    "water_pollution": "Water Pollution",
    "demand_drop": "Demand Softening",
    "cost_surge": "Cost Surge",
    "cost_inflation": "Cost Pressure",
    "policy_relief": "Policy Relief",
}


def compute_priority_score(
    exposure_score: float | None,
    shock_intensity: float | None,
    cash_margin_pct: float | None,
    dti_sme: float | None,
) -> float:
    """Unified composite vulnerability score without synthetic fallback values.

    Uses the exact same weights as the Staff Workspace UI:
    0.38 exposure + 0.32 external shock + 0.15 tight cash margin penalty + 0.15 SME debt penalty.
    When any component is missing, weights are renormalized across available components.
    """
    weighted_sum = 0.0
    active_weight = 0.0

    if exposure_score is not None:
        weighted_sum += 0.38 * float(exposure_score)
        active_weight += 0.38
    if shock_intensity is not None:
        weighted_sum += 0.32 * float(shock_intensity)
        active_weight += 0.32
    if cash_margin_pct is not None:
        tight_margin_penalty = max(0.0, (30.0 - float(cash_margin_pct)) * 2.2)
        weighted_sum += 0.15 * tight_margin_penalty
        active_weight += 0.15
    if dti_sme is not None:
        debt_penalty = min(100.0, float(dti_sme) * 65.0)
        weighted_sum += 0.15 * debt_penalty
        active_weight += 0.15

    if active_weight <= 0.0:
        return 0.0
    return round(weighted_sum / active_weight, 2)


def _load_nso_2025_map() -> dict[str, dict[str, float]]:
    """Load latest 2025 NSO debt and expense indicators per Northern province in O(N)."""
    rows = fetch_all(
        """
        SELECT province_raw, metric_name, metric_value
        FROM bronze.provincial_stats_raw
        WHERE dataset_name = 'nso_household_finance'
          AND period_date = (
              SELECT max(period_date)
              FROM bronze.provincial_stats_raw
              WHERE dataset_name = 'nso_household_finance'
          )
        """
    )
    by_prov: dict[str, dict[str, float]] = {}
    for r in rows:
        code = resolve_northern_province(r["province_raw"])
        if not code or r["metric_value"] is None:
            continue
        by_prov.setdefault(code, {})[str(r["metric_name"])] = float(r["metric_value"])

    out: dict[str, dict[str, float]] = {}
    for code, m in by_prov.items():
        inc_all = m.get("monthly_income_thb_all", 0.0)
        inc_sme = m.get("monthly_income_thb_sme", 0.0)
        dti_all = m.get("avg_household_debt_thb_all", 0.0) / (inc_all * 12.0) if inc_all > 0 else None
        dti_sme = m.get("avg_household_debt_thb_sme", 0.0) / (inc_sme * 12.0) if inc_sme > 0 else None
        entry: dict[str, float] = {}
        if dti_all is not None:
            entry["dti_all"] = round(dti_all, 2)
        if dti_sme is not None:
            entry["dti_sme"] = round(dti_sme, 2)
        if "expense_to_income_pct_all" in m:
            entry["exp_inc_all"] = round(m["expense_to_income_pct_all"], 1)
        if "expense_to_income_pct_sme" in m:
            entry["exp_inc_sme"] = round(m["expense_to_income_pct_sme"], 1)
        out[code] = entry
    return out


def _format_month_label(iso_date: str, language: str) -> str:
    """Format YYYY-MM-DD date string into readable Thai Buddhist Era or English month."""
    if not iso_date or len(iso_date) < 7:
        return iso_date
    parts = iso_date.split("-")
    year = int(parts[0])
    month_idx = int(parts[1]) - 1
    th_m = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]
    en_m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    if 0 <= month_idx < 12:
        return f"{th_m[month_idx]} {year + 543}" if language == "th" else f"{en_m[month_idx]} {year}"
    return iso_date


def _fmt_signed_pct(val: float | None, decimals: int = 0) -> str:
    if val is None:
        return "—"
    return f"{val:+.{decimals}f}%"


def _fmt_pct(val: float | None, decimals: int = 2) -> str:
    if val is None:
        return "—"
    return f"{val:.{decimals}f}%"


def _fetch_latest_non_null_feature(feature_key: str) -> tuple[float | None, str]:
    """Fallback lookup for macro series that publish on a slight lag."""
    allowed = {"th_cpi_yoy_pct", "oil_brent_yoy_pct"}
    if feature_key not in allowed:
        return None, ""
    rows = fetch_all(
        f"""
        SELECT month_date, (selected_features->>'{feature_key}')::double precision AS val
        FROM gold.province_monthly_panel
        WHERE selected_features->>'{feature_key}' IS NOT NULL
        ORDER BY month_date DESC
        LIMIT 1
        """
    )
    if not rows or rows[0]["val"] is None:
        return None, ""
    return float(rows[0]["val"]), str(rows[0]["month_date"])


def build_executive_brief_data(language: str = "th") -> dict[str, Any]:
    """Assemble concise, non-redundant 1-page policy brief data directly from Neon."""
    latest_rows = fetch_all(
        """
        WITH latest_m AS (
            SELECT max(month_date) AS m_date FROM gold.province_monthly_panel
        )
        SELECT
            d.province_code, d.name_th, d.name_en, d.subregion,
            p.month_date, p.composite_shock_idx, p.target_metrics, p.selected_features,
            c.model_used, c.cluster_id, c.cluster_label,
            c.shock_intensity, c.exposure_score
        FROM silver.dim_provinces d
        JOIN gold.province_monthly_panel p
          ON d.province_code = p.province_code
         AND p.month_date = (SELECT m_date FROM latest_m)
        LEFT JOIN gold.province_clusters c
          ON d.province_code = c.province_code
        ORDER BY d.province_code
        """
    )

    nso_map = _load_nso_2025_map()
    prov_count = len(latest_rows)
    latest_month = str(latest_rows[0]["month_date"]) if latest_rows else ""
    model_used = str(latest_rows[0]["model_used"]) if latest_rows and latest_rows[0]["model_used"] else "KMeans (k=4)"

    occ_vals: list[float] = []
    occ_yoy_vals: list[float] = []
    rev_total = 0.0
    cm_cr_rev = 0.0
    elevated_provs: list[str] = []
    cpi_yoy: float | None = None
    oil_yoy: float | None = None

    watchlist_candidates: list[dict[str, Any]] = []
    province_profiles: list[dict[str, Any]] = []

    for r in latest_rows:
        code = str(r["province_code"])
        tm = r["target_metrics"] or {}
        sf = r["selected_features"] or {}
        nso = nso_map.get(code, {})

        occ = float(tm.get("occupancy_rate") or 0.0)
        occ_yoy = float(tm.get("occupancy_yoy_diff") or 0.0)
        rev = float(tm.get("revenue_total_mthb") or 0.0)
        occ_vals.append(occ)
        occ_yoy_vals.append(occ_yoy)
        rev_total += rev
        if code in {"CM", "CR"}:
            cm_cr_rev += rev

        if cpi_yoy is None and sf.get("th_cpi_yoy_pct") is not None:
            cpi_yoy = round(float(sf["th_cpi_yoy_pct"]), 2)
        if oil_yoy is None and sf.get("oil_brent_yoy_pct") is not None:
            oil_yoy = round(float(sf["oil_brent_yoy_pct"]), 1)

        shock_v = float(r["composite_shock_idx"] or 0.0)
        prov_label = str(r["name_th"] if language == "th" else r["name_en"])
        if shock_v >= 50.0:
            elevated_provs.append(prov_label)

        dti_sme = nso.get("dti_sme")
        exp_sme = nso.get("exp_inc_sme")
        exp_all = nso.get("exp_inc_all")
        cash_margin_sme = round(max(0.0, 100.0 - exp_sme), 1) if exp_sme is not None else None
        exposure_v = float(r["exposure_score"]) if r["exposure_score"] is not None else None
        shock_intensity_v = float(r["shock_intensity"]) if r["shock_intensity"] is not None else None

        priority_score = compute_priority_score(
            exposure_score=exposure_v,
            shock_intensity=shock_intensity_v,
            cash_margin_pct=cash_margin_sme,
            dti_sme=dti_sme,
        )

        if (dti_sme is not None and dti_sme >= 1.0) or (cash_margin_sme is not None and cash_margin_sme <= 12.0):
            risk_reason_th = (
                f"หนี้ SME สูง ({dti_sme:.2f} เท่า) เงินเหลือหลังหักรายจ่ายเพียง {cash_margin_sme:.0f}%"
                if dti_sme is not None and cash_margin_sme is not None
                else "ภาระหนี้สูงและเงินเหลือหลังหักรายจ่ายอยู่ในระดับตึงตัว"
            )
            risk_reason_en = (
                f"Elevated SME debt ({dti_sme:.2f}x) with only {cash_margin_sme:.0f}% cash margin"
                if dti_sme is not None and cash_margin_sme is not None
                else "High SME debt strain with thin post-expense cash margin"
            )
            action_tag_th = "ปรับโครงสร้างหนี้เร่งด่วน (RL / คลินิกแก้หนี้)"
            action_tag_en = "Urgent debt restructuring (RL / Debt Clinic)"
        elif (exp_all is not None and exp_all >= 84.0) or code == "CM":
            risk_reason_th = (
                f"ศูนย์กลางรายได้หลัก ({round(rev):,} ลบ./เดือน) รายจ่ายครัวเรือนสูง {exp_all:.0f}%"
                if exp_all is not None
                else f"ศูนย์กลางรายได้หลัก ({round(rev):,} ลบ./เดือน) มีความอ่อนไหวต่อแรงกระแทกภายนอก"
            )
            risk_reason_en = (
                f"Primary revenue hub ({round(rev):,} M THB/mo), high HH expense {exp_all:.0f}%"
                if exp_all is not None
                else f"Primary revenue hub ({round(rev):,} M THB/mo) exposed to external shocks"
            )
            action_tag_th = "สำรองวงเงินสภาพคล่องรับฤดูฝุ่น มี.ค.–เม.ย."
            action_tag_en = "Pre-position liquidity lines before Mar–Apr haze"
        elif (shock_intensity_v is not None and shock_intensity_v >= 65.0) or code == "CR":
            risk_reason_th = "เผชิญแรงกระแทกภายนอกสูง (ฝุ่น น้ำท่วม หรือข่าวเหตุการณ์รุนแรง) รายได้ผันผวนสูง"
            risk_reason_en = "High external shock exposure (haze, flood, or severe events) with volatile revenue"
            action_tag_th = "เตรียมมาตรการพักเงินต้นฉุกเฉินและฟื้นฟูกิจการ"
            action_tag_en = "Standby disaster moratorium & recovery credit"
        else:
            exp_txt_th = f" และรายจ่าย SME {exp_sme:.0f}%" if exp_sme is not None else ""
            exp_txt_en = f" with SME expense ratio {exp_sme:.0f}%" if exp_sme is not None else ""
            risk_reason_th = f"อัตราเข้าพักเฉลี่ย {occ:.1f}%{exp_txt_th}"
            risk_reason_en = f"Occupancy {occ:.1f}%{exp_txt_en}"
            action_tag_th = "ติดตามภาระค่างวดและเงินเหลือหลังหักรายจ่ายต่อเนื่อง"
            action_tag_en = "Monitor debt coverage & post-expense cash margin"

        province_profiles.append(
            {
                "code": code,
                "label": prov_label,
                "rev": rev,
                "exposure": exposure_v or 0.0,
                "dti_sme": dti_sme or 0.0,
                "cash_margin_sme": cash_margin_sme if cash_margin_sme is not None else 100.0,
                "priority_score": priority_score,
            }
        )

        watchlist_candidates.append(
            {
                "province_code": code,
                "name_th": str(r["name_th"]),
                "name_en": str(r["name_en"]),
                "occupancy_pct": round(occ, 1),
                "occupancy_yoy_diff": round(occ_yoy, 1),
                "dti_sme": dti_sme if dti_sme is not None else 0.0,
                "cash_cushion_sme": round(cash_margin_sme, 0) if cash_margin_sme is not None else 0.0,
                "exp_inc_all": exp_all if exp_all is not None else 0.0,
                "risk_reason": risk_reason_en if language == "en" else risk_reason_th,
                "recommended_action": action_tag_en if language == "en" else action_tag_th,
                "priority_score": priority_score,
            }
        )

    watchlist_candidates.sort(key=lambda x: x["priority_score"], reverse=True)
    priority_watchlist = [
        {**item, "priority_rank": idx + 1}
        for idx, item in enumerate(watchlist_candidates[:5])
    ]

    # Fall back to latest published non-null CPI and Brent oil months if latest tourism month leads macro releases
    cpi_month = latest_month
    if cpi_yoy is None:
        cpi_val, cpi_m = _fetch_latest_non_null_feature("th_cpi_yoy_pct")
        if cpi_val is not None:
            cpi_yoy = round(cpi_val, 2)
            cpi_month = cpi_m

    oil_month = latest_month
    if oil_yoy is None:
        oil_val, oil_m = _fetch_latest_non_null_feature("oil_brent_yoy_pct")
        if oil_val is not None:
            oil_yoy = round(oil_val, 1)
            oil_month = oil_m

    avg_occ = round(sum(occ_vals) / max(len(occ_vals), 1), 1)
    avg_occ_yoy = round(sum(occ_yoy_vals) / max(len(occ_yoy_vals), 1), 1)
    top2_rev_share = round((cm_cr_rev / max(rev_total, 1.0)) * 100.0, 1)
    m_lbl = _format_month_label(latest_month, language)
    cpi_lbl = _format_month_label(cpi_month, language)

    # Dynamic action plan targets (independent of cluster_id or k=3/4/5)
    immediate_targets = [
        p for p in sorted(province_profiles, key=lambda x: (x["dti_sme"], -x["cash_margin_sme"]), reverse=True)
        if p["dti_sme"] >= 0.65 or p["cash_margin_sme"] <= 18.0
    ][:4]
    if not immediate_targets:
        immediate_targets = sorted(province_profiles, key=lambda x: x["priority_score"], reverse=True)[:3]
    immediate_codes = {p["code"] for p in immediate_targets}

    seasonal_targets = sorted(
        [p for p in province_profiles if p["code"] not in immediate_codes],
        key=lambda x: (x["rev"], x["exposure"]),
        reverse=True,
    )[:4]
    seasonal_codes = {p["code"] for p in seasonal_targets}
    seasonal_rev_share = round(
        (sum(p["rev"] for p in seasonal_targets) / max(rev_total, 1.0)) * 100.0,
        1,
    )

    preventive_targets = [
        p for p in province_profiles if p["code"] not in immediate_codes and p["code"] not in seasonal_codes
    ]

    if language == "en":
        if elevated_provs:
            shock_clause = (
                f"External shock alerts (index >= 50) were triggered in {len(elevated_provs)}/{prov_count} provinces "
                f"({', '.join(elevated_provs[:5])}), while "
            )
        else:
            shock_clause = f"While no province triggered an external shock alert this month (0/{prov_count}), "

        macro_parts: list[str] = []
        if cpi_yoy is not None:
            macro_parts.append(f"CPI {_fmt_pct(cpi_yoy, 2)} YoY in {cpi_lbl}")
        if oil_yoy is not None:
            macro_parts.append(f"Brent oil {_fmt_signed_pct(oil_yoy, 0)} YoY")
        macro_clause = (
            f"elevated cost pressure ({', '.join(macro_parts)}) intensifies debt strain in provinces with thin cash margins."
            if macro_parts
            else "ongoing operating cost pressures continue to weigh on provinces with thin cash margins."
        )

        situation_summary = (
            f"In {m_lbl}, Northern Thailand's {prov_count} service provinces averaged {avg_occ}% occupancy "
            f"({avg_occ_yoy:+.1f} pp YoY) with {rev_total:,.0f} M THB in monthly tourism revenue "
            f"({top2_rev_share}% concentrated in Chiang Mai and Chiang Rai). "
            f"{shock_clause}{macro_clause}"
        )

        preventive_names = ", ".join(p["label"] for p in preventive_targets[:5])
        preventive_suffix = (
            f" and {len(preventive_targets) - 5} other provinces ({len(preventive_targets)} total)"
            if len(preventive_targets) > 5
            else f" ({len(preventive_targets)} provinces)"
        )
        action_plan = [
            {
                "horizon": "Immediate (0–30 days)",
                "target_area": ", ".join(p["label"] for p in immediate_targets),
                "action": "Deploy proactive pre-NPL debt restructuring under Responsible Lending 2568 and route overdue unsecured borrowers to Debt Clinic by SAM (3–5% interest, up to 10 years).",
            },
            {
                "horizon": "Seasonal Readiness (Pre Mar–Apr)",
                "target_area": ", ".join(p["label"] for p in seasonal_targets),
                "action": f"Pre-approve seasonal working capital lines and standby disaster principal deferral ahead of peak haze and monsoon windows to protect {seasonal_rev_share}% of regional tourism revenue.",
            },
            {
                "horizon": "Preventive Monitoring (Ongoing)",
                "target_area": f"{preventive_names}{preventive_suffix}" if preventive_targets else "All monitored provinces",
                "action": "Promote preventive debt consolidation and cash margin planning for domestic-market SMEs facing operating cost pressure and seasonal external shocks.",
            },
        ]
    else:
        yoy_txt = f"เพิ่มขึ้น +{avg_occ_yoy}% เทียบปีก่อน" if avg_occ_yoy >= 0 else f"ชะลอตัว {avg_occ_yoy}% เทียบปีก่อน"
        if elevated_provs:
            shock_clause = (
                f"พบสัญญาณแรงกระแทกภายนอกเกินเกณฑ์เตือนภัย (ดัชนี 50 ขึ้นไป) จำนวน {len(elevated_provs)}/{prov_count} จังหวัด "
                f"({', '.join(elevated_provs[:5])}) ขณะที่"
            )
        else:
            shock_clause = f"แม้เดือนนี้จะยังไม่พบจังหวัดที่มีดัชนีแรงกระแทกภายนอกเกินเกณฑ์เตือนภัย (0/{prov_count} จังหวัด) แต่"

        macro_parts_th: list[str] = []
        if cpi_yoy is not None:
            macro_parts_th.append(f"เงินเฟ้อไทย {_fmt_pct(cpi_yoy, 2)} เทียบปีก่อน ณ {cpi_lbl}")
        if oil_yoy is not None:
            macro_parts_th.append(f"น้ำมันดิบ Brent {_fmt_signed_pct(oil_yoy, 0)} เทียบปีก่อน")
        macro_clause_th = (
            f"แรงกดดันต้นทุน ({' และ'.join(macro_parts_th)}) กำลังซ้ำเติมผู้ประกอบการ SME ในพื้นที่ที่มีภาระหนี้สูงและเงินเหลือหลังหักรายจ่ายน้อย"
            if macro_parts_th
            else "แรงกดดันต้นทุนการดำเนินงานยังคงกดดันผู้ประกอบการ SME ในพื้นที่ที่มีเงินเหลือหลังหักรายจ่ายน้อย"
        )

        situation_summary = (
            f"เดือน {m_lbl} ภาคบริการทั้ง {prov_count} จังหวัดภาคเหนือมีอัตราเข้าพักเฉลี่ย {avg_occ}% ({yoy_txt}) "
            f"สร้างรายได้รวม {rev_total:,.0f} ล้านบาท โดยกระจุกตัวในเชียงใหม่และเชียงรายสูงถึง {top2_rev_share}% "
            f"{shock_clause}{macro_clause_th}"
        )

        preventive_names_th = ", ".join(p["label"] for p in preventive_targets[:5])
        preventive_area_th = (
            f"{preventive_names_th} และอีก {len(preventive_targets) - 5} จังหวัด (รวม {len(preventive_targets)} จังหวัด)"
            if len(preventive_targets) > 5
            else f"{preventive_names_th} ({len(preventive_targets)} จังหวัด)"
            if preventive_targets
            else "จังหวัดที่ติดตามทั้งหมด"
        )
        action_plan = [
            {
                "horizon": "เร่งด่วน (0–30 วัน)",
                "target_area": ", ".join(p["label"] for p in immediate_targets),
                "action": "เร่งปรับโครงสร้างหนี้เชิงป้องกันตามเกณฑ์ Responsible Lending 2568 สำหรับ SME ที่เงินเหลือหลังหักรายจ่ายต่ำ และส่งต่อลูกหนี้ค้างชำระเกิน 120 วันเข้าคลินิกแก้หนี้ (ดอกเบี้ย 3–5% ผ่อนสูงสุด 10 ปี)",
            },
            {
                "horizon": "เตรียมพร้อมฤดูกาล (ก่อน มี.ค.–เม.ย.)",
                "target_area": ", ".join(p["label"] for p in seasonal_targets),
                "action": f"เตรียมวงเงินสินเชื่อหมุนเวียนและเงื่อนไขพักเงินต้นฉุกเฉินล่วงหน้าก่อนเข้าสู่ฤดูฝุ่น PM2.5 และช่วงน้ำหลาก เพื่อคุ้มครองฐานรายได้ท่องเที่ยว {seasonal_rev_share}% ของภาค",
            },
            {
                "horizon": "ติดตามเชิงป้องกัน (ต่อเนื่อง)",
                "target_area": preventive_area_th,
                "action": "ส่งเสริมการรวมหนี้ลดภาระค่างวดและวางแผนเงินเหลือหลังหักรายจ่ายผ่านเครื่องมือประเมินภาระหนี้สาธารณะ เพื่อตรวจจับความตึงตัวตั้งแต่เนิ่นๆ",
            },
        ]

    news_rows = fetch_all(
        """
        SELECT
            e.province_code, d.name_th, d.name_en, e.event_date,
            e.shock_type, e.severity_score, e.evidence_quote, n.source_url
        FROM silver.news_events e
        JOIN silver.dim_provinces d ON e.province_code = d.province_code
        JOIN bronze.news_raw n ON e.news_id = n.id
        ORDER BY e.event_date DESC, e.severity_score DESC
        LIMIT 3
        """
    )
    verified_news = [
        {
            "province_code": str(n["province_code"]),
            "name_th": str(n["name_th"]),
            "name_en": str(n["name_en"]),
            "event_date": str(n["event_date"]),
            "shock_type": str(n["shock_type"]),
            "severity_score": int(n["severity_score"]),
            "evidence_quote": str(n["evidence_quote"]),
            "source_url": str(n["source_url"]),
        }
        for n in news_rows
    ]

    generated_at = datetime.now(ICT_TZ).strftime("%Y-%m-%d %H:%M ICT")
    return {
        "generated_at": generated_at,
        "language": language,
        "latest_month": latest_month,
        "clustering_model": model_used,
        "situation_summary": situation_summary,
        "regional_snapshot": {
            "provinces_monitored": prov_count,
            "avg_occupancy_pct": avg_occ,
            "avg_occupancy_yoy_diff": avg_occ_yoy,
            "total_monthly_revenue_mthb": round(rev_total, 1),
            "top2_revenue_share_pct": top2_rev_share,
            "th_cpi_yoy_pct": cpi_yoy,
            "th_cpi_month": cpi_month,
            "oil_brent_yoy_pct": oil_yoy,
            "oil_brent_month": oil_month,
            "elevated_shock_provinces": elevated_provs,
            "has_regional_external_shock": len(elevated_provs) > 0,
        },
        "priority_watchlist": priority_watchlist,
        "action_plan": action_plan,
        "verified_news": verified_news,
    }


def render_brief_markdown(brief: dict[str, Any], language: str = "th") -> str:
    """Render concise policy brief in Markdown."""
    is_en = language == "en"
    m_lbl = _format_month_label(brief["latest_month"], language)
    lines: list[str] = []

    if is_en:
        lines.append("# Policy Brief: Northern Thailand Service Sector & Financial Vulnerability")
        lines.append(f"**Period:** {m_lbl} | **Generated:** {brief['generated_at']}")
        lines.append("")
        lines.append("## 1. Situation Overview")
        lines.append(brief["situation_summary"])
        lines.append("")
        lines.append("## 2. Priority Watchlist (Top 5 Provinces Requiring Attention)")
        lines.append("| Province | Occupancy | SME Debt | Cash Margin | Key Risk Driver | Recommended Action |")
        lines.append("|---|---:|---:|---:|---|---|")
        for w in brief["priority_watchlist"]:
            lines.append(
                f"| {w['name_en']} | {w['occupancy_pct']}% | {w['dti_sme']}x | {w['cash_cushion_sme']:.0f}% | {w['risk_reason']} | {w['recommended_action']} |"
            )
        lines.append("")
        lines.append("## 3. Three-Horizon Policy Action Plan")
        for a in brief["action_plan"]:
            lines.append(f"- **{a['horizon']} ({a['target_area']}):** {a['action']}")
    else:
        lines.append("# รายงานสรุปเชิงนโยบาย: เศรษฐกิจภาคบริการและความเปราะบางทางการเงินภาคเหนือ")
        lines.append(f"**ข้อมูลประจำเดือน:** {m_lbl} | **จัดทำเมื่อ:** {brief['generated_at']}")
        lines.append("")
        lines.append("## 1. สรุปสถานการณ์ภาพรวม")
        lines.append(brief["situation_summary"])
        lines.append("")
        lines.append("## 2. รายชื่อ 5 จังหวัดที่ต้องเฝ้าระวังเร่งด่วนที่สุด")
        lines.append("| จังหวัด | อัตราเข้าพัก | หนี้ SME | เงินเหลือหลังหักรายจ่าย | จุดเสี่ยงหลัก | แนวทางดำเนินการ |")
        lines.append("|---|---:|---:|---:|---|---|")
        for w in brief["priority_watchlist"]:
            lines.append(
                f"| {w['name_th']} | {w['occupancy_pct']}% | {w['dti_sme']} เท่า | {w['cash_cushion_sme']:.0f}% | {w['risk_reason']} | {w['recommended_action']} |"
            )
        lines.append("")
        lines.append("## 3. แผนปฏิบัติการเชิงนโยบาย 3 ระยะ")
        for a in brief["action_plan"]:
            lines.append(f"- **{a['horizon']} ({a['target_area']}):** {a['action']}")

    lines.append("")
    lines.append("## 4. Latest Verified Field Signals" if is_en else "## 4. สัญญาณข่าวภาคสนามที่ตรวจสอบแล้วล่าสุด")
    for n in brief["verified_news"][:2]:
        p_name = n["name_en"] if is_en else n["name_th"]
        lines.append(f"- [{n['event_date']} · {p_name}] {n['evidence_quote']}")
    return "\n".join(lines)


def render_brief_html(brief: dict[str, Any], language: str = "th") -> str:
    """Render concise, non-redundant single-page A4 policy brief in HTML."""
    snap = brief["regional_snapshot"]
    is_en = language == "en"
    prov_count = snap["provinces_monitored"]
    title = (
        "Policy Brief: Northern Thailand Service Sector & Financial Vulnerability"
        if is_en
        else "รายงานสรุปเชิงนโยบาย: เศรษฐกิจภาคบริการและความเปราะบางทางการเงินภาคเหนือ"
    )
    m_lbl = _format_month_label(brief["latest_month"], language)
    shock_str = (
        f"{len(snap['elevated_shock_provinces'])}/{prov_count} {'Alerts' if is_en else 'จังหวัด'}"
        if snap["elevated_shock_provinces"]
        else (f"Normal (0/{prov_count})" if is_en else f"ปกติ (0/{prov_count})")
    )

    watch_rows = "".join(
        f"<tr>"
        f"<td><strong>{escape(w['name_en'] if is_en else w['name_th'])}</strong></td>"
        f"<td style='text-align:right;white-space:nowrap'>{w['occupancy_pct']}%</td>"
        f"<td style='text-align:right;white-space:nowrap'>{w['dti_sme']}{'x' if is_en else ' เท่า'}</td>"
        f"<td style='text-align:right;white-space:nowrap'><strong>{w['cash_cushion_sme']:.0f}%</strong></td>"
        f"<td>{escape(w['risk_reason'])}</td>"
        f"<td>{escape(w['recommended_action'])}</td>"
        f"</tr>"
        for w in brief["priority_watchlist"]
    )

    action_rows = "".join(
        f"<tr>"
        f"<td style='white-space:nowrap'><strong>{escape(a['horizon'])}</strong></td>"
        f"<td>{escape(a['target_area'])}</td>"
        f"<td>{escape(a['action'])}</td>"
        f"</tr>"
        for a in brief["action_plan"]
    )

    news_html = "".join(
        f"<li><strong>{escape(n['event_date'])} · {escape(n['name_en'] if is_en else n['name_th'])} "
        f"({escape(_SHOCK_TYPE_EN.get(n['shock_type'], n['shock_type']) if is_en else _SHOCK_TYPE_TH.get(n['shock_type'], n['shock_type']))}):</strong> "
        f"{escape(n['evidence_quote'])}</li>"
        for n in brief["verified_news"][:2]
    )

    yoy_sign = "+" if snap["avg_occupancy_yoy_diff"] >= 0 else ""
    cpi_txt = _fmt_pct(snap.get("th_cpi_yoy_pct"), 2)
    oil_txt = _fmt_signed_pct(snap.get("oil_brent_yoy_pct"), 0)

    return f"""<!DOCTYPE html>
<html lang="{escape(language)}">
<head>
<meta charset="utf-8" />
<title>{escape(title)}</title>
<style>
  @page {{ size: A4; margin: 13mm; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: 'Segoe UI', Tahoma, sans-serif; color: #111827; margin: 0; padding: 8px; line-height: 1.45; font-size: 11px; }}
  .sheet {{ max-width: 780px; margin: 0 auto; }}
  header {{ border-bottom: 2px solid #111827; padding-bottom: 8px; margin-bottom: 12px; }}
  h1 {{ font-size: 16.5px; margin: 0 0 3px 0; }}
  .meta {{ color: #4B5563; font-size: 10px; }}
  .kpis {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }}
  .kpi {{ border: 1px solid #D1D5DB; border-radius: 5px; padding: 8px 10px; background: #F9FAFB; }}
  .kpi .lbl {{ font-size: 9px; color: #6B7280; }}
  .kpi .val {{ font-size: 14.5px; font-weight: 700; margin-top: 2px; }}
  .kpi .sub {{ font-size: 9px; color: #4B5563; margin-top: 1px; }}
  .memo-box {{ border-left: 3px solid #111827; background: #F9FAFB; padding: 9px 12px; margin-bottom: 12px; }}
  h2 {{ font-size: 12px; margin: 12px 0 6px 0; border-bottom: 1px solid #E5E7EB; padding-bottom: 3px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 10.2px; margin-bottom: 10px; }}
  th, td {{ border: 1px solid #E5E7EB; padding: 5px 7px; text-align: left; vertical-align: top; }}
  th {{ background: #F3F4F6; font-weight: 600; }}
  ul {{ margin: 4px 0 6px 16px; padding: 0; }}
  li {{ margin-bottom: 4px; }}
  footer {{ margin-top: 12px; padding-top: 7px; border-top: 1px solid #D1D5DB; font-size: 9px; color: #6B7280; }}
</style>
</head>
<body>
<div class="sheet">
  <header>
    <h1>{escape(title)}</h1>
    <div class="meta">NorthRisk Analytics | {'Period' if is_en else 'ข้อมูลประจำเดือน'}: {escape(m_lbl)} | {'Generated' if is_en else 'จัดทำเมื่อ'}: {escape(brief['generated_at'])}</div>
  </header>

  <div class="kpis">
    <div class="kpi">
      <div class="lbl">{f'Regional Avg Occupancy ({prov_count} Prov.)' if is_en else f'อัตราเข้าพักเฉลี่ย ({prov_count} จังหวัด)'}</div>
      <div class="val">{snap['avg_occupancy_pct']}%</div>
      <div class="sub">{'YoY' if is_en else 'เทียบปีก่อน'} {yoy_sign}{snap['avg_occupancy_yoy_diff']}%</div>
    </div>
    <div class="kpi">
      <div class="lbl">{'Monthly Tourism Revenue' if is_en else 'รายได้ท่องเที่ยวรวมต่อเดือน'}</div>
      <div class="val">{snap['total_monthly_revenue_mthb']:,.0f} {'M THB' if is_en else 'ลบ.'}</div>
      <div class="sub">{'CM+CR share' if is_en else 'เชียงใหม่+เชียงราย'} {snap['top2_revenue_share_pct']}%</div>
    </div>
    <div class="kpi">
      <div class="lbl">{'CPI / Brent Oil (YoY)' if is_en else 'เงินเฟ้อไทย / น้ำมัน Brent (เทียบปีก่อน)'}</div>
      <div class="val">{escape(cpi_txt)} / {escape(oil_txt)}</div>
      <div class="sub">{'CPI as of' if is_en else 'เงินเฟ้อ ณ'} {escape(_format_month_label(snap['th_cpi_month'], language))}</div>
    </div>
    <div class="kpi">
      <div class="lbl">{'External Shock Status' if is_en else 'สถานะแรงกระแทกภายนอก'}</div>
      <div class="val" style="font-size:13px">{escape(shock_str)}</div>
      <div class="sub">{'Alert cutoff >= 50' if is_en else 'เกณฑ์เตือนภัยดัชนี 50 ขึ้นไป'}</div>
    </div>
  </div>

  <div class="memo-box">
    <strong>{'1. Situation Overview:' if is_en else '1. สรุปสถานการณ์ภาพรวม:'}</strong>
    {escape(brief['situation_summary'])}
  </div>

  <h2>{'2. Priority Watchlist (Top 5 Provinces Requiring Attention)' if is_en else '2. รายชื่อ 5 จังหวัดที่ต้องเฝ้าระวังเร่งด่วนที่สุด'}</h2>
  <table>
    <thead>
      <tr>
        <th>{'Province' if is_en else 'จังหวัด'}</th>
        <th style="text-align:right">{'Occupancy' if is_en else 'อัตราเข้าพัก'}</th>
        <th style="text-align:right">{'SME Debt' if is_en else 'หนี้ SME'}</th>
        <th style="text-align:right">{'Cash Margin' if is_en else 'เงินเหลือหลังหักรายจ่าย'}</th>
        <th>{'Primary Risk Driver' if is_en else 'จุดเสี่ยงหลัก'}</th>
        <th>{'Recommended Action' if is_en else 'แนวทางดำเนินการ'}</th>
      </tr>
    </thead>
    <tbody>{watch_rows}</tbody>
  </table>

  <h2>{'3. Three-Horizon Policy Action Plan' if is_en else '3. แผนปฏิบัติการเชิงนโยบาย 3 ระยะ'}</h2>
  <table>
    <thead>
      <tr>
        <th>{'Horizon' if is_en else 'กรอบเวลา'}</th>
        <th>{'Target Area' if is_en else 'พื้นที่เป้าหมาย'}</th>
        <th>{'Concrete Policy Action' if is_en else 'มาตรการและข้อเสนอแนะเชิงปฏิบัติการ'}</th>
      </tr>
    </thead>
    <tbody>{action_rows}</tbody>
  </table>

  <h2>{'4. Latest Verified Field Signals' if is_en else '4. สัญญาณข่าวภาคสนามที่ตรวจสอบแล้วล่าสุด'}</h2>
  <ul>{news_html}</ul>

  <footer>
    {'Official Sources: MOTS, NSO 2025, BIS CPI, FRED, Open-Meteo, Air4Thai, and Bank of Thailand Official Publications.' if is_en else 'แหล่งข้อมูลทางการ: กระทรวงการท่องเที่ยวและกีฬา (MOTS), สำนักงานสถิติแห่งชาติ (สสช. 2568), BIS CPI, FRED, Open-Meteo, กรมควบคุมมลพิษ (Air4Thai) และเอกสารธนาคารแห่งประเทศไทย'}
  </footer>
</div>
</body>
</html>"""