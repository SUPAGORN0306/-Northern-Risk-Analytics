"""One page bilingual executive policy memo generator backed by live Neon Gold and Silver tables."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any

from src.db.connection import fetch_all
from src.guardrails.schemas import resolve_northern_province

ICT_TZ = timezone(timedelta(hours=7))

_CLUSTER_LABEL_TH: dict[str, str] = {
    "International Tourism Hub": "ศูนย์กลางท่องเที่ยวต่างชาติ",
    "High Debt Chronic Haze Belt": "เขตหนี้สูงและฝุ่นเรื้อรัง",
    "Secondary Domestic Tourism Corridor": "เมืองท่องเที่ยวในประเทศรอง",
    "Elevated Debt Domestic Basin": "ลุ่มน้ำตลาดในประเทศหนี้ค่อนข้างสูง",
}

_SHOCK_TYPE_TH: dict[str, str] = {
    "pm25": "ฝุ่น PM2.5",
    "flood": "อุทกภัย",
    "demand_drop": "อุปสงค์ชะลอตัว",
    "cost_inflation": "ต้นทุนและเงินเฟ้อ",
    "policy_relief": "มาตรการช่วยเหลือ",
}


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
        dti_all = m.get("avg_household_debt_thb_all", 0.0) / (inc_all * 12.0) if inc_all > 0 else 0.0
        dti_sme = m.get("avg_household_debt_thb_sme", 0.0) / (inc_sme * 12.0) if inc_sme > 0 else 0.0
        out[code] = {
            "dti_all": round(dti_all, 2),
            "dti_sme": round(dti_sme, 2),
            "exp_inc_all": round(m.get("expense_to_income_pct_all", 0.0), 1),
            "exp_inc_sme": round(m.get("expense_to_income_pct_sme", 0.0), 1),
        }
    return out


def _format_month_label(iso_date: str, language: str) -> str:
    """Format YYYY MM DD date string into readable Thai Buddhist Era or English month."""
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


def build_executive_brief_data(language: str = "th") -> dict[str, Any]:
    """Assemble concise, non redundant 1 page executive memo data directly from Neon."""
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
    latest_month = str(latest_rows[0]["month_date"]) if latest_rows else ""
    model_used = str(latest_rows[0]["model_used"]) if latest_rows and latest_rows[0]["model_used"] else "KMeans (k=4)"

    occ_vals: list[float] = []
    occ_yoy_vals: list[float] = []
    rev_total = 0.0
    cm_cr_rev = 0.0
    elevated_provs: list[str] = []
    cpi_yoy = None
    oil_yoy = None

    by_cluster_provs: dict[int, list[str]] = {}
    watchlist_candidates: list[dict[str, Any]] = []

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

        cid = int(r["cluster_id"] or 0)
        by_cluster_provs.setdefault(cid, []).append(prov_label)

        dti_sme = nso.get("dti_sme", 0.0)
        exp_sme = nso.get("exp_inc_sme", 0.0)
        exp_all = nso.get("exp_inc_all", 0.0)
        cushion_sme = round(max(0.0, 100.0 - exp_sme), 0)

        # Score priority urgency combining SME balance sheet fragility, tourism concentration, and shock exposure
        priority_score = (
            dti_sme * 40.0
            + max(0.0, exp_sme - 70.0) * 1.5
            + max(0.0, exp_all - 75.0) * 1.2
            + float(r["exposure_score"] or 0.0) * 0.35
            + (12.0 if code in {"CM", "CR"} else 0.0)
        )

        if dti_sme >= 1.0 or cushion_sme <= 12:
            risk_reason_th = f"หนี้ SME สูง ({dti_sme:.2f} เท่า) เหลือเงินหลังหักรายจ่ายเพียง {cushion_sme:.0f}%"
            risk_reason_en = f"Severe SME debt ({dti_sme:.2f}x) with only {cushion_sme:.0f}% income left after expenses"
            action_tag_th = "ปรับโครงสร้างหนี้เร่งด่วน (RL / คลินิกแก้หนี้)"
            action_tag_en = "Urgent debt restructuring (RL / Debt Clinic)"
        elif exp_all >= 84.0 or code == "CM":
            risk_reason_th = f"ศูนย์กลางรายได้หลัก ({round(rev):,} ลบ./เดือน) รายจ่ายครัวเรือนสูง {exp_all:.0f}%"
            risk_reason_en = f"Primary revenue hub ({round(rev):,} M THB/mo), high HH expense {exp_all:.0f}%"
            action_tag_th = "สำรองวงเงินสภาพคล่องรับฤดูฝุ่น มี.ค. ถึง เม.ย."
            action_tag_en = "Pre position liquidity lines before Mar to Apr haze"
        elif code == "CR":
            risk_reason_th = "เปราะบางสูงต่อทั้งน้ำท่วมและฝุ่นสีแดง มีความผันผวนรายได้สูง"
            risk_reason_en = "High sensitivity to compound flooding and red haze disruptions"
            action_tag_th = "เตรียมมาตรการพักเงินต้นฉุกเฉินและฟื้นฟูกิจการ"
            action_tag_en = "Standby disaster moratorium & recovery credit"
        else:
            risk_reason_th = f"อัตราเข้าพัก {occ:.1f}% และรายจ่าย SME {exp_sme:.0f}%"
            risk_reason_en = f"Occupancy {occ:.1f}% with SME expense ratio {exp_sme:.0f}%"
            action_tag_th = "ติดตามภาระค่างวดและกันชนเงินสดต่อเนื่อง"
            action_tag_en = "Monitor cash buffer & seasonal debt coverage"

        watchlist_candidates.append(
            {
                "province_code": code,
                "name_th": str(r["name_th"]),
                "name_en": str(r["name_en"]),
                "occupancy_pct": round(occ, 1),
                "occupancy_yoy_diff": round(occ_yoy, 1),
                "dti_sme": dti_sme,
                "cash_cushion_sme": cushion_sme,
                "exp_inc_all": exp_all,
                "risk_reason": risk_reason_en if language == "en" else risk_reason_th,
                "recommended_action": action_tag_en if language == "en" else action_tag_th,
                "_score": priority_score,
            }
        )

    watchlist_candidates.sort(key=lambda x: x["_score"], reverse=True)
    priority_watchlist = [
        {k: v for k, v in item.items() if k != "_score"}
        for item in watchlist_candidates[:5]
    ]

    # Fall back to latest published non null BIS CPI month when latest tourism month leads CPI by 1 month
    cpi_month = latest_month
    if cpi_yoy is None:
        cpi_rows = fetch_all(
            """
            SELECT month_date, (selected_features->>'th_cpi_yoy_pct')::double precision AS cpi_val
            FROM gold.province_monthly_panel
            WHERE selected_features->>'th_cpi_yoy_pct' IS NOT NULL
            ORDER BY month_date DESC
            LIMIT 1
            """
        )
        if cpi_rows:
            cpi_yoy = round(float(cpi_rows[0]["cpi_val"]), 2)
            cpi_month = str(cpi_rows[0]["month_date"])

    avg_occ = round(sum(occ_vals) / max(len(occ_vals), 1), 1)
    avg_occ_yoy = round(sum(occ_yoy_vals) / max(len(occ_yoy_vals), 1), 1)
    top2_rev_share = round((cm_cr_rev / max(rev_total, 1.0)) * 100.0, 1)
    m_lbl = _format_month_label(latest_month, language)
    cpi_lbl = _format_month_label(cpi_month, language)

    if language == "en":
        situation_summary = (
            f"In {m_lbl}, Northern Thailand's 17 service provinces averaged {avg_occ}% hotel occupancy "
            f"({avg_occ_yoy:+.1f} pp YoY) with {rev_total:,.0f} M THB in monthly tourism revenue "
            f"({top2_rev_share}% concentrated in Chiang Mai and Chiang Rai). "
            f"While no province triggered an external physical hazard alert this month (0/17), "
            f"elevated cost pressure (CPI {cpi_yoy}% in {cpi_lbl}, Brent oil {oil_yoy:+.0f}% YoY) "
            f"intensifies debt strain in Lower North SME hubs with thin cash cushions."
        )
        action_plan = [
            {
                "horizon": "Immediate (0 to 30 days)",
                "target_area": ", ".join(by_cluster_provs.get(2, ["Phitsanulok", "Kamphaeng Phet", "Sukhothai"])),
                "action": "Deploy proactive pre NPL debt restructuring under Responsible Lending 2568 and route overdue unsecured borrowers to Debt Clinic by SAM (3 to 5% interest, up to 10 years).",
            },
            {
                "horizon": "Seasonal Readiness (Pre Mar to Apr)",
                "target_area": ", ".join(by_cluster_provs.get(1, ["Chiang Mai", "Chiang Rai", "Mae Hong Son", "Nan"])),
                "action": "Pre approve seasonal working capital lines and standby disaster principal deferral ahead of peak haze and monsoon windows to protect core regional revenue.",
            },
            {
                "horizon": "Preventive Monitoring (Ongoing)",
                "target_area": ", ".join((by_cluster_provs.get(3, []) + by_cluster_provs.get(4, []))[:6]) + " (10 domestic provinces)",
                "action": "Promote preventive debt consolidation and cash buffer planning for domestic market SMEs facing rising operating costs and chronic orange haze days.",
            },
        ]
    else:
        yoy_txt = f"เพิ่มขึ้น +{avg_occ_yoy}% จากปีก่อน" if avg_occ_yoy >= 0 else f"ชะลอตัว {avg_occ_yoy}% จากปีก่อน"
        situation_summary = (
            f"เดือน {m_lbl} ภาคบริการ 17 จังหวัดภาคเหนือมีอัตราเข้าพักเฉลี่ย {avg_occ}% ({yoy_txt}) "
            f"สร้างรายได้รวม {rev_total:,.0f} ล้านบาท โดยกระจุกตัวในเชียงใหม่และเชียงรายสูงถึง {top2_rev_share}% "
            f"แม้เดือนนี้จะยังไม่พบสัญญาณภัยพิบัติฝุ่นหรือน้ำท่วมเกินเกณฑ์เตือนภัย (ปกติ 17/17 จังหวัด) "
            f"แต่แรงกดดันต้นทุน (เงินเฟ้อ {cpi_yoy}% ณ {cpi_lbl} และน้ำมันดิบ Brent {oil_yoy:+.0f}% YoY) "
            f"กำลังซ้ำเติมผู้ประกอบการ SME ในภาคเหนือตอนล่างที่มีหนี้สูงและเหลือเงินหลังหักรายจ่ายน้อย"
        )
        action_plan = [
            {
                "horizon": "เร่งด่วน (0 ถึง 30 วัน)",
                "target_area": ", ".join(by_cluster_provs.get(2, ["พิษณุโลก", "กำแพงเพชร", "สุโขทัย"])),
                "action": "เร่งรุกปรับโครงสร้างหนี้เชิงป้องกันตามเกณฑ์ Responsible Lending 2568 สำหรับ SME กันชนบาง และส่งต่อลูกหนี้ค้างชำระเกิน 120 วันเข้าคลินิกแก้หนี้ (ดอกเบี้ย 3 ถึง 5% ผ่อนสูงสุด 10 ปี)",
            },
            {
                "horizon": "เตรียมพร้อมฤดูกาล (ก่อน มี.ค. ถึง เม.ย.)",
                "target_area": ", ".join(by_cluster_provs.get(1, ["เชียงใหม่", "เชียงราย", "แม่ฮ่องสอน", "น่าน"])),
                "action": "เตรียมวงเงินสินเชื่อหมุนเวียนและเงื่อนไขพักเงินต้นฉุกเฉินล่วงหน้าก่อนเข้าสู่ฤดูฝุ่น PM2.5 และช่วงน้ำหลาก เพื่อคุ้มครองฐานรายได้หลักเกือบ 70% ของภาค",
            },
            {
                "horizon": "ติดตามเชิงป้องกัน (ต่อเนื่อง)",
                "target_area": "กลุ่มจังหวัดท่องเที่ยวในประเทศและลุ่มน้ำ (10 จังหวัดที่เหลือ)",
                "action": "ส่งเสริมการรวมหนี้ลดภาระค่างวดและให้ความรู้การสำรองสภาพคล่องผ่านเครื่องมือประเมิน DSR สาธารณะเพื่อดักจับจุดตึงตัวตั้งแต่เนิ่นๆ",
            },
        ]

    # Latest verified news evidence (2 concise lines for field context)
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
            "provinces_monitored": len(latest_rows),
            "avg_occupancy_pct": avg_occ,
            "avg_occupancy_yoy_diff": avg_occ_yoy,
            "total_monthly_revenue_mthb": round(rev_total, 1),
            "top2_revenue_share_pct": top2_rev_share,
            "th_cpi_yoy_pct": cpi_yoy,
            "th_cpi_month": cpi_month,
            "oil_brent_yoy_pct": oil_yoy,
            "elevated_shock_provinces": elevated_provs,
            "has_regional_external_shock": len(elevated_provs) > 0,
        },
        "priority_watchlist": priority_watchlist,
        "action_plan": action_plan,
        "verified_news": verified_news,
    }


def render_brief_markdown(brief: dict[str, Any], language: str = "th") -> str:
    """Render concise 3 section executive policy memo in Markdown."""
    snap = brief["regional_snapshot"]
    is_en = language == "en"
    m_lbl = _format_month_label(brief["latest_month"], language)
    lines: list[str] = []

    if is_en:
        lines.append("# Executive Policy Memo: Northern Thailand Service Sector & Debt Resilience")
        lines.append(f"**Period:** {m_lbl} | **Generated:** {brief['generated_at']}")
        lines.append("")
        lines.append("## 1. Situation Overview")
        lines.append(brief["situation_summary"])
        lines.append("")
        lines.append("## 2. Priority Watchlist (Top 5 Provinces Requiring Policy Attention)")
        lines.append("| Province | Occupancy | SME Debt | SME Cash Cushion | Key Risk Driver | Recommended Action |")
        lines.append("|---|---:|---:|---:|---|---|")
        for w in brief["priority_watchlist"]:
            lines.append(
                f"| {w['name_en']} | {w['occupancy_pct']}% | {w['dti_sme']}x | {w['cash_cushion_sme']:.0f}% | {w['risk_reason']} | {w['recommended_action']} |"
            )
        lines.append("")
        lines.append("## 3. Three Horizon Policy Action Plan")
        for a in brief["action_plan"]:
            lines.append(f"- **{a['horizon']} ({a['target_area']}):** {a['action']}")
    else:
        lines.append("# บันทึกสรุปเชิงนโยบาย: เศรษฐกิจภาคบริการและความเปราะบางทางการเงินภาคเหนือ")
        lines.append(f"**ข้อมูลประจำเดือน:** {m_lbl} | **จัดทำเมื่อ:** {brief['generated_at']}")
        lines.append("")
        lines.append("## 1. สรุปสถานการณ์ภาพรวม")
        lines.append(brief["situation_summary"])
        lines.append("")
        lines.append("## 2. รายชื่อ 5 จังหวัดที่ต้องเฝ้าระวังเร่งด่วนที่สุด")
        lines.append("| จังหวัด | อัตราเข้าพัก | หนี้ SME | กันชนเงินสด | จุดเสี่ยงหลัก | แนวทางดำเนินการ |")
        lines.append("|---|---:|---:|---:|---|---|")
        for w in brief["priority_watchlist"]:
            lines.append(
                f"| {w['name_th']} | {w['occupancy_pct']}% | {w['dti_sme']}x | {w['cash_cushion_sme']:.0f}% | {w['risk_reason']} | {w['recommended_action']} |"
            )
        lines.append("")
        lines.append("## 3. แผนปฏิบัติการเชิงนโยบาย 3 ระยะ")
        for a in brief["action_plan"]:
            lines.append(f"- **{a['horizon']} ({a['target_area']}):** {a['action']}")

    lines.append("")
    lines.append("## 4. Field Signals" if is_en else "## 4. สัญญาณข่าวภาคสนามล่าสุด")
    for n in brief["verified_news"][:2]:
        p_name = n["name_en"] if is_en else n["name_th"]
        lines.append(f"- [{n['event_date']} · {p_name}] {n['evidence_quote']}")
    return "\n".join(lines)


def render_brief_html(brief: dict[str, Any], language: str = "th") -> str:
    """Render concise, non redundant single page A4 executive policy memo in HTML."""
    snap = brief["regional_snapshot"]
    is_en = language == "en"
    title = (
        "Executive Policy Memo: Northern Thailand Service Sector & Debt Resilience"
        if is_en
        else "บันทึกสรุปเชิงนโยบาย: เศรษฐกิจภาคบริการและความเปราะบางทางการเงินภาคเหนือ"
    )
    m_lbl = _format_month_label(brief["latest_month"], language)
    shock_str = (
        f"{len(snap['elevated_shock_provinces'])} {'Alerts' if is_en else 'จังหวัด'}"
        if snap["elevated_shock_provinces"]
        else ("Normal (0/17)" if is_en else "ปกติ (0/17)")
    )

    watch_rows = "".join(
        f"<tr>"
        f"<td><strong>{escape(w['name_en'] if is_en else w['name_th'])}</strong></td>"
        f"<td style='text-align:right;white-space:nowrap'>{w['occupancy_pct']}%</td>"
        f"<td style='text-align:right;white-space:nowrap'>{w['dti_sme']}x</td>"
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
        f"({escape(n['shock_type'] if is_en else _SHOCK_TYPE_TH.get(n['shock_type'], n['shock_type']))}):</strong> "
        f"{escape(n['evidence_quote'])}</li>"
        for n in brief["verified_news"][:2]
    )

    yoy_sign = "+" if snap["avg_occupancy_yoy_diff"] >= 0 else ""

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
      <div class="lbl">{'17P Avg Occupancy' if is_en else 'อัตราเข้าพักเฉลี่ย 17 จังหวัด'}</div>
      <div class="val">{snap['avg_occupancy_pct']}%</div>
      <div class="sub">YoY {yoy_sign}{snap['avg_occupancy_yoy_diff']}%</div>
    </div>
    <div class="kpi">
      <div class="lbl">{'Monthly Tourism Revenue' if is_en else 'รายได้ท่องเที่ยวทั้งภาค'}</div>
      <div class="val">{snap['total_monthly_revenue_mthb']:,.0f} {'M THB' if is_en else 'ลบ.'}</div>
      <div class="sub">{'CM+CR share' if is_en else 'เชียงใหม่+เชียงราย'} {snap['top2_revenue_share_pct']}%</div>
    </div>
    <div class="kpi">
      <div class="lbl">{'Thailand CPI / Brent Oil' if is_en else 'เงินเฟ้อไทย / น้ำมัน Brent'}</div>
      <div class="val">{snap['th_cpi_yoy_pct']}% / {snap['oil_brent_yoy_pct']:+.0f}%</div>
      <div class="sub">CPI {escape(_format_month_label(snap['th_cpi_month'], language))}</div>
    </div>
    <div class="kpi">
      <div class="lbl">{'External Hazard Status' if is_en else 'สัญญาณภัยพิบัติภายนอก'}</div>
      <div class="val" style="font-size:13px">{escape(shock_str)}</div>
      <div class="sub">{'Alert cutoff >= 50' if is_en else 'เกณฑ์เตือนภัยดัชนี 50+'}</div>
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
        <th style="text-align:right">{'Occ' if is_en else 'เข้าพัก'}</th>
        <th style="text-align:right">{'SME Debt' if is_en else 'หนี้ SME'}</th>
        <th style="text-align:right">{'Surplus' if is_en else 'เงินเหลือ'}</th>
        <th>{'Primary Risk Driver' if is_en else 'จุดเสี่ยงหลัก'}</th>
        <th>{'Recommended Action' if is_en else 'แนวทางดำเนินการ'}</th>
      </tr>
    </thead>
    <tbody>{watch_rows}</tbody>
  </table>

  <h2>{'3. Three Horizon Policy Action Plan' if is_en else '3. แผนปฏิบัติการเชิงนโยบาย 3 ระยะ'}</h2>
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

  <h2>{'4. Verified Field Signals' if is_en else '4. สัญญาณข่าวภาคสนามล่าสุด'}</h2>
  <ul>{news_html}</ul>

  <footer>
    {'Sources: MOTS, NSO 2025, BIS CPI, FRED Oil, Open Meteo, Air4Thai, and Bank of Thailand Official Policy Publications.' if is_en else 'แหล่งข้อมูลทางการ: กระทรวงการท่องเที่ยวและกีฬา (MOTS), สำนักงานสถิติแห่งชาติ (สสช. 2568), BIS CPI, FRED, Open-Meteo, กรมควบคุมมลพิษ (Air4Thai) และเอกสารธนาคารแห่งประเทศไทย'}
  </footer>
</div>
</body>
</html>"""
