"""Deterministic Debt Service Ratio calculator enforcing zero LLM arithmetic."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

DsrBand = Literal["stable", "watch", "tight", "critical"]


@dataclass(frozen=True)
class DsrAssessment:
    """Immutable deterministic gross income DSR assessment with bilingual labels."""

    monthly_revenue_thb: float
    monthly_debt_thb: float
    dsr_pct: float | None
    band: DsrBand
    summary_en: str
    summary_th: str
    formula_type: str = "gross_income_dsr"
    formula_definition_en: str = "Monthly debt payment divided by gross monthly revenue before living or operating expenses"
    formula_definition_th: str = "สัดส่วนค่างวดหนี้รายเดือนต่อรายได้รวมก่อนหักค่าใช้จ่ายดำเนินงานหรือค่าครองชีพ"


def calculate_dsr(monthly_revenue_thb: float, monthly_debt_thb: float) -> DsrAssessment:
    """Compute gross income Debt Service Ratio in Python with explicit zero revenue edge handling."""
    if monthly_revenue_thb < 0 or monthly_debt_thb < 0:
        raise ValueError("Revenue and debt payments must be non negative")

    if monthly_revenue_thb == 0:
        if monthly_debt_thb == 0:
            return DsrAssessment(
                monthly_revenue_thb=0.0,
                monthly_debt_thb=0.0,
                dsr_pct=0.0,
                band="stable",
                summary_en="No active monthly debt obligation reported (Gross income DSR 0%)",
                summary_th="ไม่พบภาระผ่อนชำระหนี้รายเดือนในขณะนี้ (สัดส่วนหนี้ต่อรายได้รวม 0%)",
            )
        return DsrAssessment(
            monthly_revenue_thb=0.0,
            monthly_debt_thb=round(monthly_debt_thb, 2),
            dsr_pct=None,
            band="critical",
            summary_en="Active debt obligation with zero reported gross monthly revenue (Gross income DSR undefined)",
            summary_th="มีภาระผ่อนชำระหนี้แต่ไม่มีรายได้รวมรายเดือน (คำนวณสัดส่วนหนี้ต่อรายได้รวมไม่ได้) ควรเจรจาปรับโครงสร้างหนี้โดยเร่งด่วน",
        )

    dsr_pct = round((monthly_debt_thb / monthly_revenue_thb) * 100.0, 2)

    if dsr_pct < 40.0:
        band: DsrBand = "stable"
        summary_en = "Gross income DSR within normal range (evaluate remaining cash after operating and living expenses separately)"
        summary_th = "สัดส่วนค่างวดต่อรายได้รวมอยู่ในเกณฑ์ปกติ (ควรพิจารณาเงินเหลือหลังหักค่าใช้จ่ายจำเป็นควบคู่กัน)"
    elif dsr_pct < 60.0:
        band = "watch"
        summary_en = "Moderate gross income debt burden (monitor post expense cash buffer closely)"
        summary_th = "สัดส่วนค่างวดต่อรายได้รวมเริ่มตึงตัว ควรเฝ้าระวังและตรวจสอบเงินเหลือหลังหักค่าใช้จ่าย"
    elif dsr_pct < 80.0:
        band = "tight"
        summary_en = "High gross income debt burden before living and operating expenses (consider proactive restructuring)"
        summary_th = "สัดส่วนค่างวดต่อรายได้รวมตึงตัวมากก่อนหักค่าใช้จ่ายจำเป็น ควรวางแผนปรับโครงสร้างหนี้ก่อนเริ่มค้างชำระ"
    else:
        band = "critical"
        summary_en = "Critical gross income debt stress (contact creditors immediately for restructuring)"
        summary_th = "สัดส่วนค่างวดต่อรายได้รวมอยู่ในระดับวิกฤต ควรติดต่อเจ้าหนี้เพื่อขอปรับโครงสร้างหนี้โดยเร่งด่วน"

    return DsrAssessment(
        monthly_revenue_thb=round(monthly_revenue_thb, 2),
        monthly_debt_thb=round(monthly_debt_thb, 2),
        dsr_pct=dsr_pct,
        band=band,
        summary_en=summary_en,
        summary_th=summary_th,
    )
