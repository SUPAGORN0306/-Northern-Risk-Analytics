"""Official MOTS provincial tourism and NSO household finance extractors into Neon Bronze."""

from __future__ import annotations

import hashlib
import json
import ssl
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
import openpyxl
import pandas as pd
import truststore
import yaml

from src.db.connection import bulk_execute
from src.guardrails.schemas import get_province_metadata, resolve_northern_province

BACKEND_DIR = Path(__file__).resolve().parents[2]
RAW_DIR = BACKEND_DIR / "data" / "raw"

# Constant time Thai month abbreviation lookup
THAI_MONTH_MAP: dict[str, int] = {
    "ม.ค.": 1,
    "ก.พ.": 2,
    "มี.ค.": 3,
    "เม.ย.": 4,
    "พ.ค.": 5,
    "มิ.ย.": 6,
    "ก.ค.": 7,
    "ส.ค.": 8,
    "ก.ย.": 9,
    "ต.ค.": 10,
    "พ.ย.": 11,
    "ธ.ค.": 12,
}

# Column pairs mapping current year and prior year indices in official MOTS monthly workbooks
MOTS_METRIC_COLS: tuple[tuple[str, int, int], ...] = (
    ("occupancy_rate", 2, 3),
    ("guest_arrivals", 5, 6),
    ("visitors_total", 8, 9),
    ("visitors_thai", 11, 12),
    ("visitors_foreign", 14, 15),
    ("revenue_total_mthb", 17, 18),
    ("revenue_thai_mthb", 20, 21),
    ("revenue_foreign_mthb", 23, 24),
)

NSO_METRIC_MAP: dict[str, str] = {
    "รายได้ทั้งสิ้นต่อเดือน": "monthly_income_thb",
    "ค่าใช้จ่ายทั้งสิ้นต่อเดือน": "monthly_expense_thb",
    "หนี้สินเฉลี่ยต่อครัวเรือนทั้งสิ้น": "avg_household_debt_thb",
    "ร้อยละของค่าใช้จ่ายต่อรายได้": "expense_to_income_pct",
}

NSO_CLASS_MAP: dict[str, str] = {
    "รวมทั้งสิ้น": "all",
    "ผู้ประกอบธุรกิจของตนเองที่ไม่ใช่การเกษตร": "sme",
}


@lru_cache(maxsize=1)
def _load_source_urls() -> tuple[dict[str, Any], dict[str, Any]]:
    """Load MOTS and NSO endpoints from config/sources.yaml."""
    cfg = yaml.safe_load((BACKEND_DIR / "config" / "sources.yaml").read_text(encoding="utf-8"))
    return cfg["mots"], cfg["nso"]


def _download_if_missing(url: str, target_path: Path, timeout_sec: int = 30) -> Path:
    """Download an official open data file with OS TLS truststore if not cached locally."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if not target_path.exists():
        tls_ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        with httpx.Client(verify=tls_ctx, timeout=timeout_sec, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            target_path.write_bytes(resp.content)
    return target_path


def _to_float(value: Any) -> float | None:
    """Parse numeric Excel or CSV cells safely to float."""
    if value is None or value == "" or value == "-":
        return None
    try:
        cleaned = str(value).replace(",", "").strip()
        return float(cleaned)
    except ValueError:
        return None


def _make_stat_hash(dataset: str, period: str, province_code: str, metric: str) -> str:
    """Compute SHA256 digest for idempotent Bronze statistics upsert."""
    raw = f"{dataset}|{period}|{province_code}|{metric}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _parse_sheet_month(sheet_name: str) -> int | None:
    """Resolve Thai month prefix from MOTS sheet name in O(1) prefix checks."""
    cleaned = sheet_name.strip()
    if "สะสม" in cleaned:
        return None
    for prefix, month_num in THAI_MONTH_MAP.items():
        if cleaned.startswith(prefix):
            return month_num
    return None


def parse_mots_monthly_workbook(
    file_path: Path,
    current_year_ce: int,
    include_prior_year: bool = True,
) -> list[dict[str, Any]]:
    """Extract all 17 Northern provinces from a monthly MOTS Excel workbook."""
    provinces_meta = get_province_metadata()
    rows: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()

    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
    try:
        for sheet_name in wb.sheetnames:
            month_num = _parse_sheet_month(sheet_name)
            if month_num is None:
                continue

            ws = wb[sheet_name]
            curr_period = date(current_year_ce, month_num, 1)
            prev_period = date(current_year_ce - 1, month_num, 1)

            for excel_row in ws.iter_rows(min_row=5, values_only=True):
                if len(excel_row) < 19:
                    continue
                prov_name = str(excel_row[1] or "").strip()
                prov_code = resolve_northern_province(prov_name)
                if not prov_code:
                    continue

                canonical_th = provinces_meta[prov_code]["name_th"]
                year_targets: list[tuple[date, bool]] = [(curr_period, True)]
                if include_prior_year:
                    year_targets.append((prev_period, False))

                for period_dt, is_curr in year_targets:
                    period_str = period_dt.isoformat()
                    for metric_name, curr_idx, prev_idx in MOTS_METRIC_COLS:
                        col_idx = curr_idx if is_curr else prev_idx
                        if col_idx >= len(excel_row):
                            continue
                        val = _to_float(excel_row[col_idx])
                        if val is None:
                            continue

                        digest = _make_stat_hash("mots_tourism", period_str, prov_code, metric_name)
                        if digest in seen_hashes:
                            continue
                        seen_hashes.add(digest)

                        rows.append(
                            {
                                "dataset_name": "mots_tourism",
                                "source_org": "Ministry of Tourism and Sports",
                                "source_file": file_path.name,
                                "period_date": period_dt,
                                "province_raw": canonical_th,
                                "metric_name": metric_name,
                                "metric_value": round(val, 4),
                                "raw_row": json.dumps(
                                    {
                                        "province_code": prov_code,
                                        "sheet": sheet_name,
                                        "period": period_str,
                                        "metric": metric_name,
                                        "value": round(val, 4),
                                    },
                                    ensure_ascii=False,
                                ),
                                "content_sha256": digest,
                            }
                        )
    finally:
        wb.close()
    return rows


def load_mots_to_bronze() -> dict[str, int]:
    """Download and bulk upsert official 2024 to 2026 MOTS Northern tourism data into Bronze."""
    mots_cfg, _ = _load_source_urls()
    timeout = int(mots_cfg["timeout_sec"])

    path_2568 = _download_if_missing(
        mots_cfg["monthly_2568r_url"], RAW_DIR / "mots_monthly_2568r.xlsx", timeout
    )
    path_2569 = _download_if_missing(
        mots_cfg["monthly_2569_url"], RAW_DIR / "mots_monthly_2569.xlsx", timeout
    )

    # Extract 2024 and 2025 from the revised 2568R workbook and 2026 from the 2569 workbook
    rows_24_25 = parse_mots_monthly_workbook(path_2568, current_year_ce=2025, include_prior_year=True)
    rows_26 = parse_mots_monthly_workbook(path_2569, current_year_ce=2026, include_prior_year=False)

    seen: set[str] = set()
    merged_rows: list[dict[str, Any]] = []
    for row in rows_24_25 + rows_26:
        if row["content_sha256"] not in seen:
            seen.add(row["content_sha256"])
            merged_rows.append(row)

    upsert_sql = """
        INSERT INTO bronze.provincial_stats_raw (
            dataset_name, source_org, source_file, period_date,
            province_raw, metric_name, metric_value, raw_row, content_sha256
        ) VALUES (
            :dataset_name, :source_org, :source_file, :period_date,
            :province_raw, :metric_name, :metric_value, CAST(:raw_row AS JSONB), :content_sha256
        )
        ON CONFLICT (content_sha256) DO NOTHING
    """
    inserted = bulk_execute(upsert_sql, merged_rows)
    return {"parsed_rows": len(merged_rows), "inserted_bronze": inserted}


def load_nso_household_finance_to_bronze() -> dict[str, int]:
    """Download and bulk upsert official NSO provincial income, expense, and debt into Bronze."""
    _, nso_cfg = _load_source_urls()
    csv_path = _download_if_missing(
        nso_cfg["household_finance_csv_url"],
        RAW_DIR / "nso_sfd_spb0801.csv",
        int(nso_cfg["timeout_sec"]),
    )

    df = pd.read_csv(csv_path)
    provinces_meta = get_province_metadata()
    rows: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()

    # Vectorized filtering before row construction
    metric_col = "mthincome_mthexp_totaldebt_pctexptoincome"
    df = df[df[metric_col].isin(NSO_METRIC_MAP.keys()) & df["soc_eco_class1"].isin(NSO_CLASS_MAP.keys())].copy()
    df["province_code"] = df["province"].map(resolve_northern_province)
    df = df.dropna(subset=["province_code"])
    df["numeric_val"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["numeric_val"])

    # Aggregate in case sub classes exist under the same class1 and take mean
    grouped = df.groupby(["year", "province_code", metric_col, "soc_eco_class1"], as_index=False)[
        "numeric_val"
    ].mean()

    for rec in grouped.to_dict(orient="records"):
        year_ce = int(rec["year"]) - 543
        period_dt = date(year_ce, 1, 1)
        period_str = period_dt.isoformat()
        prov_code = str(rec["province_code"])
        canonical_th = provinces_meta[prov_code]["name_th"]
        base_metric = NSO_METRIC_MAP[rec[metric_col]]
        cls_suffix = NSO_CLASS_MAP[rec["soc_eco_class1"]]
        metric_name = f"{base_metric}_{cls_suffix}"
        val = round(float(rec["numeric_val"]), 2)

        digest = _make_stat_hash("nso_household_finance", period_str, prov_code, metric_name)
        if digest in seen_hashes:
            continue
        seen_hashes.add(digest)

        rows.append(
            {
                "dataset_name": "nso_household_finance",
                "source_org": "National Statistical Office",
                "source_file": csv_path.name,
                "period_date": period_dt,
                "province_raw": canonical_th,
                "metric_name": metric_name,
                "metric_value": val,
                "raw_row": json.dumps(
                    {
                        "province_code": prov_code,
                        "year_ce": year_ce,
                        "metric": metric_name,
                        "value": val,
                    },
                    ensure_ascii=False,
                ),
                "content_sha256": digest,
            }
        )

    upsert_sql = """
        INSERT INTO bronze.provincial_stats_raw (
            dataset_name, source_org, source_file, period_date,
            province_raw, metric_name, metric_value, raw_row, content_sha256
        ) VALUES (
            :dataset_name, :source_org, :source_file, :period_date,
            :province_raw, :metric_name, :metric_value, CAST(:raw_row AS JSONB), :content_sha256
        )
        ON CONFLICT (content_sha256) DO NOTHING
    """
    inserted = bulk_execute(upsert_sql, rows)
    return {"parsed_rows": len(rows), "inserted_bronze": inserted}
