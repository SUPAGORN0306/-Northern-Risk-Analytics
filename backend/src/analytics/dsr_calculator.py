"""Deterministic Debt Service Ratio calculator enforcing zero LLM arithmetic."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

DsrBand = Literal["stable", "watch", "tight", "critical"]


@dataclass(frozen=True)
class DsrAssessment:
    """Immutable deterministic liquidity assessment with bilingual Thai and English labels."""

    monthly_revenue_thb: float
    monthly_debt_thb: float
    dsr_pct: float | None
    band: DsrBand
    summary_en: str
    summary_th: str


def calculate_dsr(monthly_revenue_thb: float, monthly_debt_thb: float) -> DsrAssessment:
    """Compute Debt Service Ratio in Python with explicit zero revenue edge handling."""
    if monthly_revenue_thb < 0 or monthly_debt_thb < 0:
        raise ValueError("Revenue and debt payments must be non negative")

    if monthly_revenue_thb == 0:
        if monthly_debt_thb == 0:
            return DsrAssessment(
                monthly_revenue_thb=0.0,
                monthly_debt_thb=0.0,
                dsr_pct=0.0,
                band="stable",
                summary_en="No active monthly debt obligation reported",
                summary_th="ไม่พบภาระผ่อนชำระหนี้รายเดือนในขณะนี้",
            )
        return DsrAssessment(
            monthly_revenue_thb=0.0,
            monthly_debt_thb=round(monthly_debt_thb, 2),
            dsr_pct=None,
            band="critical",
            summary_en="Active debt obligation with zero reported monthly revenue",
            summary_th="มีภาระผ่อนชำระหนี้แต่ไม่มีรายได้รายเดือน ควรเจรจาปรับโครงสร้างหนี้โดยเร่งด่วน",
        )

    dsr_pct = round((monthly_debt_thb / monthly_revenue_thb) * 100.0, 2)

    if dsr_pct < 40.0:
        band: DsrBand = "stable"
        summary_en = "Stable Liquidity"
        summary_th = "สภาพคล่องอยู่ในเกณฑ์ปกติ"
    elif dsr_pct < 60.0:
        band = "watch"
        summary_en = "Moderate Debt Pressure"
        summary_th = "ภาระหนี้เริ่มตึงตัว ควรเฝ้าระวังและสำรองสภาพคล่อง"
    elif dsr_pct < 80.0:
        band = "tight"
        summary_en = "Tight Liquidity"
        summary_th = "สภาพคล่องตึงตัว ควรวางแผนปรับโครงสร้างหนี้ก่อนเริ่มค้างชำระ"
    else:
        band = "critical"
        summary_en = "Critical Liquidity Stress"
        summary_th = "ภาระหนี้ระดับวิกฤต ควรติดต่อเจ้าหนี้เพื่อขอปรับโครงสร้างหนี้โดยเร่งด่วน"

    return DsrAssessment(
        monthly_revenue_thb=round(monthly_revenue_thb, 2),
        monthly_debt_thb=round(monthly_debt_thb, 2),
        dsr_pct=dsr_pct,
        band=band,
        summary_en=summary_en,
        summary_th=summary_th,
    )
