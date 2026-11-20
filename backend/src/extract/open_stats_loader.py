"""Official open statistics CSV and Excel loader for MOTS, NSO, BOT, AOT, and DBD files."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pandas as pd

from src.db.connection import bulk_execute


def load_tabular_stat_file_to_bronze(
    file_path: str | Path,
    dataset_name: str,
    source_org: str,
    period_col: str,
    metric_cols: list[str],
    province_col: str | None = None,
    sheet_name: str | int = 0,
) -> dict[str, int]:
    """Melt an official wide CSV or Excel table into bronze.provincial_stats_raw."""
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Statistics file not found ({path})")

    if path.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(path, sheet_name=sheet_name)
    else:
        df = pd.read_csv(path)

    id_vars = [period_col] + ([province_col] if province_col else [])
    melted = df.melt(
        id_vars=id_vars,
        value_vars=metric_cols,
        var_name="metric_name",
        value_name="metric_value",
    )
    melted["period_date"] = pd.to_datetime(melted[period_col], errors="coerce").dt.date
    melted["metric_value"] = pd.to_numeric(melted["metric_value"], errors="coerce")
    melted = melted.dropna(subset=["period_date", "metric_value"])

    rows: list[dict[str, Any]] = []
    for rec in melted.to_dict(orient="records"):
        prov = str(rec[province_col]).strip() if province_col and pd.notna(rec[province_col]) else None
        period = rec["period_date"]
        metric = str(rec["metric_name"]).strip()
        val = float(rec["metric_value"])
        digest = hashlib.sha256(
            f"{dataset_name}|{period.isoformat()}|{prov or 'REGIONAL'}|{metric}".encode("utf-8")
        ).hexdigest()

        rows.append(
            {
                "dataset_name": dataset_name,
                "source_org": source_org,
                "source_file": path.name,
                "period_date": period,
                "province_raw": prov,
                "metric_name": metric,
                "metric_value": val,
                "raw_row": json.dumps(
                    {
                        "period": period.isoformat(),
                        "province": prov,
                        "metric": metric,
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
