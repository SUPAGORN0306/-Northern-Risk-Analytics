"""FastAPI REST service powering public regional economic outlook, financial resilience checks, and staff monitor."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from src.analytics.vulnerability_lab import (
    _get_cached_clustering_inputs,
    _get_cached_monte_carlo_inputs,
    invalidate_lab_cache,
    run_empirical_monte_carlo,
    run_interactive_clustering,
)
from src.analytics.vulnerability_tiering import (
    build_tier_summary,
    evaluate_province_vulnerability,
)
from src.db.connection import fetch_all
from src.guardrails.schemas import resolve_northern_province
from src.rag.policy_assistant import answer_policy_question, assess_financial_resilience
from src.reporting.brief_generator import (
    build_executive_brief_data,
    render_brief_html,
    render_brief_markdown,
)

BACKEND_DIR = Path(__file__).resolve().parents[2]
GUARDRAILS_PATH = BACKEND_DIR / "config" / "guardrails.yaml"
load_dotenv(BACKEND_DIR / ".env")

ICT_TZ = timezone(timedelta(hours=7))
TOKEN_TTL_SECONDS = 8 * 3600
READ_CACHE_TTL_SECONDS = 120.0

_CACHE_LOCK = threading.Lock()
_READ_CACHE: dict[str, tuple[float, Any]] = {}


def _cache_get(key: str) -> Any | None:
    """Return a cached payload when still within TTL or None on cache miss."""
    now = time.monotonic()
    with _CACHE_LOCK:
        entry = _READ_CACHE.get(key)
        if entry is None:
            return None
        expires_at, payload = entry
        if now > expires_at:
            _READ_CACHE.pop(key, None)
            return None
        return payload


def _cache_set(key: str, payload: Any, ttl: float = READ_CACHE_TTL_SECONDS) -> None:
    """Store a read payload inside the thread safe TTL cache."""
    with _CACHE_LOCK:
        _READ_CACHE[key] = (time.monotonic() + ttl, payload)


def _invalidate_read_cache() -> None:
    """Clear all cached read payloads immediately after live writes or refreshes."""
    with _CACHE_LOCK:
        _READ_CACHE.clear()
    invalidate_lab_cache()


def _dedupe_news_rows(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Deduplicate cross outlet news items sharing the same normalized headline prefix."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in rows:
        title = str(row.get("title") or "")
        base = title.rsplit(" - ", 1)[0] if " - " in title else title
        norm = "".join(base.lower().split())[:64]
        if norm and norm in seen:
            continue
        if norm:
            seen.add(norm)
        out.append(row)
        if len(out) >= limit:
            break
    return out


@lru_cache(maxsize=1)
def _load_guardrails() -> dict[str, Any]:
    """Load guardrails configuration once for rate limits and operational cutoffs."""
    return yaml.safe_load(GUARDRAILS_PATH.read_text(encoding="utf-8"))


_RATE_CFG = _load_guardrails().get("rate_limits", {})
LIMIT_RELIEF = str(_RATE_CFG.get("relief_check", "20/minute"))
LIMIT_CHAT = str(_RATE_CFG.get("chat", "15/minute"))
LIMIT_REFRESH = str(_RATE_CFG.get("refresh", "3/hour"))

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(
    title="Northern Thailand Service Sector Risk and Resilience API",
    description="Regional economic pulse, financial resilience navigator, and staff policy monitor for 17 Northern provinces.",
    version="1.0.0",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configure strict CORS origins from environment variable with local Next.js default and Vercel regex
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# Request models validated deterministically with Pydantic

class StaffLoginRequest(BaseModel):
    """Credentials for staff portal sign in."""

    username: str = Field(..., min_length=2, max_length=60)
    password: str = Field(..., min_length=4, max_length=120)


class ReliefCheckPayload(BaseModel):
    """Input payload for deterministic DSR calculation and grounded policy guidance."""

    province: str = Field(..., min_length=2, max_length=60)
    business_type: str = Field(..., min_length=2, max_length=60)
    monthly_revenue_thb: float = Field(..., ge=0.0, le=1e9)
    monthly_debt_thb: float = Field(..., ge=0.0, le=1e9)
    impact_tags: list[str] = Field(default_factory=list, max_length=8)
    language: Literal["th", "en"] = Field(default="th")


class ChatRequestPayload(BaseModel):
    """Input payload for guardrailed policy and regional economic knowledge assistant."""

    question: str = Field(..., min_length=2, max_length=600)
    language: Literal["th", "en"] = Field(default="th")


# Stateless HMAC SHA256 staff token helpers

def _get_auth_secret() -> bytes:
    """Return signing secret from environment or deterministic fallback derived from env."""
    secret = os.getenv("STAFF_AUTH_SECRET") or os.getenv("DATABASE_URL") or "northrisk_local_dev_secret"
    return hashlib.sha256(secret.encode("utf-8")).digest()


def _create_staff_token(username: str, role: str = "analyst") -> dict[str, Any]:
    """Create signed bearer token valid for eight hours without external JWT dependencies."""
    exp_ts = int(time.time()) + TOKEN_TTL_SECONDS
    payload = {"sub": username, "role": role, "exp": exp_ts}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    sig = hmac.new(_get_auth_secret(), b64.encode("ascii"), hashlib.sha256).hexdigest()
    return {
        "access_token": f"{b64}.{sig}",
        "token_type": "bearer",
        "expires_in_seconds": TOKEN_TTL_SECONDS,
        "role": role,
        "username": username,
    }


def _verify_staff_token(token: str) -> dict[str, Any]:
    """Validate HMAC signature and expiration timestamp of a staff bearer token."""
    parts = token.split(".")
    if len(parts) != 2:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid staff token format")
    b64, sig = parts
    expected_sig = hmac.new(_get_auth_secret(), b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid staff token signature")
    pad = "=" * ((4 - len(b64) % 4) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(b64 + pad).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed staff token") from exc
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Staff token expired")
    return payload


def require_staff_token(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    """FastAPI dependency enforcing authenticated staff access on restricted endpoints."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Staff authentication required")
    token = authorization.split(" ", 1)[1].strip()
    return _verify_staff_token(token)


def _fetch_nso_latest_by_province() -> dict[str, dict[str, float]]:
    """Load latest 2025 NSO debt and expense metrics keyed by 2 letter province code."""
    cached = _cache_get("nso_latest_by_province")
    if cached is not None:
        return cached
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
    raw_map: dict[str, dict[str, float]] = {}
    for r in rows:
        code = resolve_northern_province(r["province_raw"])
        if not code or r["metric_value"] is None:
            continue
        raw_map.setdefault(code, {})[str(r["metric_name"])] = float(r["metric_value"])

    out: dict[str, dict[str, float]] = {}
    for code, m in raw_map.items():
        inc_all = m.get("monthly_income_thb_all", 0.0)
        inc_sme = m.get("monthly_income_thb_sme", 0.0)
        out[code] = {
            "debt_to_annual_income_all": round(
                m.get("avg_household_debt_thb_all", 0.0) / (inc_all * 12.0), 2
            )
            if inc_all > 0
            else 0.0,
            "debt_to_annual_income_sme": round(
                m.get("avg_household_debt_thb_sme", 0.0) / (inc_sme * 12.0), 2
            )
            if inc_sme > 0
            else 0.0,
            "expense_to_income_pct_all": round(m.get("expense_to_income_pct_all", 0.0), 1),
            "expense_to_income_pct_sme": round(m.get("expense_to_income_pct_sme", 0.0), 1),
            "monthly_income_thb_all": round(inc_all, 0),
            "monthly_income_thb_sme": round(inc_sme, 0),
        }
    _cache_set("nso_latest_by_province", out, ttl=300.0)
    return out


# Health and authentication routes

@app.get("/api/health")
def health_check() -> dict[str, Any]:
    """Verify API availability and live Neon PostgreSQL connectivity."""
    ping = fetch_all("SELECT 1 AS ok, (SELECT count(*) FROM silver.dim_provinces) AS provinces")[0]
    return {
        "status": "ok",
        "database_connected": bool(ping["ok"] == 1),
        "provinces_seeded": int(ping["provinces"]),
        "server_time_ict": datetime.now(ICT_TZ).isoformat(timespec="seconds"),
    }


@app.post("/api/auth/staff-login")
def staff_login(payload: StaffLoginRequest) -> dict[str, Any]:
    """Authenticate staff analyst credentials and return signed bearer token."""
    expected_user = os.getenv("STAFF_DEMO_USERNAME", "analyst")
    expected_pass = os.getenv("STAFF_DEMO_PASSWORD", "northrisk2026")
    user_ok = hmac.compare_digest(payload.username.strip(), expected_user)
    pass_ok = hmac.compare_digest(payload.password, expected_pass)
    if not (user_ok and pass_ok):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid staff credentials")
    return _create_staff_token(username=expected_user, role="policy_analyst")


@app.post("/api/auth/demo-access")
def staff_demo_access() -> dict[str, Any]:
    """Issue a time limited demo staff token for interactive portfolio evaluation."""
    return _create_staff_token(username="demo_analyst", role="demo_policy_analyst")


# Public routes open without login

@app.get("/api/risk-outlook")
def get_risk_outlook(
    months: int = Query(default=12, ge=3, le=34),
) -> dict[str, Any]:
    """Serve 17 province regional economic pulse, NSO vulnerability, and conditional external shocks."""
    cache_key = f"risk_outlook_{months}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    latest_rows = fetch_all(
        """
        WITH latest_m AS (
            SELECT max(month_date) AS m_date FROM gold.province_monthly_panel
        ),
        latest_air AS (
            SELECT DISTINCT ON (province_code)
                province_code, obs_date, pm25_mean, pm25_max, exceeds_37_5, exceeds_75_0
            FROM silver.air_daily
            ORDER BY province_code, obs_date DESC
        )
        SELECT
            d.province_code, d.name_th, d.name_en, d.subregion, d.lat, d.lon,
            p.month_date, p.composite_shock_idx, p.target_metrics, p.selected_features,
            c.cluster_id, c.cluster_label, c.shock_intensity, c.exposure_score, c.recommended_policy,
            a.obs_date AS air_obs_date, a.pm25_mean AS live_pm25_mean,
            a.exceeds_37_5 AS live_pm25_elevated, a.exceeds_75_0 AS live_pm25_critical
        FROM silver.dim_provinces d
        LEFT JOIN gold.province_monthly_panel p
          ON d.province_code = p.province_code
         AND p.month_date = (SELECT m_date FROM latest_m)
        LEFT JOIN gold.province_clusters c ON d.province_code = c.province_code
        LEFT JOIN latest_air a ON d.province_code = a.province_code
        ORDER BY d.province_code
        """
    )

    nso_map = _fetch_nso_latest_by_province()

    # Load recent verified high severity news alerts (including water pollution, flood, and PM2.5)
    recent_alert_rows = fetch_all(
        """
        SELECT province_code, event_date, shock_type, severity_score, evidence_quote
        FROM silver.news_events
        WHERE event_date >= CURRENT_DATE - INTERVAL '120 days'
          AND shock_type != 'policy_relief'
          AND severity_score >= 3
        ORDER BY event_date DESC, severity_score DESC
        """
    )
    alerts_by_prov: dict[str, list[dict[str, Any]]] = {}
    for ar in recent_alert_rows:
        alerts_by_prov.setdefault(str(ar["province_code"]), []).append(dict(ar))

    provinces_out: list[dict[str, Any]] = []
    occ_list: list[float] = []
    rev_sum = 0.0
    elevated_codes: list[str] = []
    water_alert_codes: list[str] = []
    latest_month = ""
    cpi_yoy = None
    oil_yoy = None

    for r in latest_rows:
        code = str(r["province_code"])
        tm = r["target_metrics"] or {}
        sf = r["selected_features"] or {}
        nso = nso_map.get(code, {})
        if not latest_month and r["month_date"]:
            latest_month = str(r["month_date"])
        if cpi_yoy is None and sf.get("th_cpi_yoy_pct") is not None:
            cpi_yoy = round(float(sf["th_cpi_yoy_pct"]), 2)
        if oil_yoy is None and sf.get("oil_brent_yoy_pct") is not None:
            oil_yoy = round(float(sf["oil_brent_yoy_pct"]), 1)

        occ_v = tm.get("occupancy_rate")
        rev_v = tm.get("revenue_total_mthb")
        if occ_v is not None:
            occ_list.append(float(occ_v))
        if rev_v is not None:
            rev_sum += float(rev_v)

        shock_idx = round(float(r["composite_shock_idx"] or 0.0), 2)
        live_pm_crit = bool(r["live_pm25_critical"]) if r["live_pm25_critical"] is not None else False
        prov_alerts = alerts_by_prov.get(code, [])

        prov_record: dict[str, Any] = {
            "province_code": code,
            "name_th": str(r["name_th"]),
            "name_en": str(r["name_en"]),
            "subregion": str(r["subregion"]),
            "lat": float(r["lat"]),
            "lon": float(r["lon"]),
            "occupancy_rate": tm.get("occupancy_rate"),
            "occupancy_yoy_diff": tm.get("occupancy_yoy_diff"),
            "revenue_total_mthb": tm.get("revenue_total_mthb"),
            "revenue_yoy_pct": tm.get("revenue_yoy_pct"),
            "foreign_visitor_share": tm.get("foreign_visitor_share"),
            "debt_to_annual_income_all": nso.get("debt_to_annual_income_all"),
            "debt_to_annual_income_sme": nso.get("debt_to_annual_income_sme"),
            "expense_to_income_pct_all": nso.get("expense_to_income_pct_all"),
            "expense_to_income_pct_sme": nso.get("expense_to_income_pct_sme"),
            "cluster_id": int(r["cluster_id"]) if r["cluster_id"] is not None else None,
            "cluster_label": str(r["cluster_label"] or ""),
            "shock_intensity": float(r["shock_intensity"]) if r["shock_intensity"] is not None else None,
            "exposure_score": float(r["exposure_score"]) if r["exposure_score"] is not None else None,
            "latest_shock_idx": shock_idx,
            "shock_driver": str(sf.get("shock_driver", "normal")),
            "live_pm25_mean": round(float(r["live_pm25_mean"]), 1) if r["live_pm25_mean"] is not None else None,
            "live_air_date": str(r["air_obs_date"]) if r["air_obs_date"] else None,
            "recommended_policy": str(r["recommended_policy"] or ""),
        }

        vuln = evaluate_province_vulnerability(prov_record, prov_alerts)
        has_water = bool(vuln["has_active_water_pollution"])
        has_shock = shock_idx >= 50.0 or live_pm_crit or has_water
        if has_shock:
            elevated_codes.append(code)
        if has_water:
            water_alert_codes.append(code)

        prov_record["has_active_external_shock"] = has_shock
        prov_record.update(vuln)
        provinces_out.append(prov_record)

    # Resolve latest published non null BIS CPI when latest tourism month leads official CPI by 1 month
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

    # Monthly regional economic and external shock timeline for interactive frontend charts
    ts_rows = fetch_all(
        """
        SELECT
            month_date,
            round(avg((target_metrics->>'occupancy_rate')::numeric), 2) AS avg_occupancy_rate,
            round(sum((target_metrics->>'revenue_total_mthb')::numeric), 1) AS total_revenue_mthb,
            round(avg((target_metrics->>'occupancy_yoy_diff')::numeric), 2) AS avg_occupancy_yoy_diff,
            round(avg(composite_shock_idx::numeric), 2) AS avg_shock_idx,
            round(avg((selected_features->>'th_cpi_yoy_pct')::numeric), 2) AS th_cpi_yoy_pct,
            round(avg((selected_features->>'oil_brent_yoy_pct')::numeric), 2) AS oil_brent_yoy_pct
        FROM gold.province_monthly_panel
        GROUP BY month_date
        ORDER BY month_date DESC
        LIMIT :lim
        """,
        {"lim": months},
    )
    ts_out = [
        {
            "month_date": str(r["month_date"]),
            "avg_occupancy_rate": float(r["avg_occupancy_rate"]) if r["avg_occupancy_rate"] is not None else None,
            "total_revenue_mthb": float(r["total_revenue_mthb"]) if r["total_revenue_mthb"] is not None else None,
            "avg_occupancy_yoy_diff": float(r["avg_occupancy_yoy_diff"]) if r["avg_occupancy_yoy_diff"] is not None else None,
            "avg_shock_idx": float(r["avg_shock_idx"]) if r["avg_shock_idx"] is not None else None,
            "th_cpi_yoy_pct": float(r["th_cpi_yoy_pct"]) if r["th_cpi_yoy_pct"] is not None else None,
            "oil_brent_yoy_pct": float(r["oil_brent_yoy_pct"]) if r["oil_brent_yoy_pct"] is not None else None,
        }
        for r in reversed(ts_rows)
    ]

    news_rows = fetch_all(
        """
        SELECT
            e.event_id, e.province_code, d.name_th, d.name_en, e.event_date,
            e.sector, e.shock_type, e.severity_score, e.evidence_quote,
            n.title, n.source_name, n.source_url
        FROM silver.news_events e
        JOIN silver.dim_provinces d ON e.province_code = d.province_code
        JOIN bronze.news_raw n ON e.news_id = n.id
        ORDER BY e.event_date DESC, e.severity_score DESC
        LIMIT 24
        """
    )
    news_out = [
        {
            "event_id": int(n["event_id"]),
            "province_code": str(n["province_code"]),
            "name_th": str(n["name_th"]),
            "name_en": str(n["name_en"]),
            "event_date": str(n["event_date"]),
            "sector": str(n["sector"]),
            "shock_type": str(n["shock_type"]),
            "severity_score": int(n["severity_score"]),
            "evidence_quote": str(n["evidence_quote"]),
            "title": str(n["title"]),
            "source_name": str(n["source_name"]),
            "source_url": str(n["source_url"]),
        }
        for n in _dedupe_news_rows(news_rows, limit=8)
    ]

    result = {
        "latest_month": latest_month,
        "regional_summary": {
            "provinces_count": len(provinces_out),
            "avg_occupancy_pct": round(sum(occ_list) / max(len(occ_list), 1), 2),
            "total_monthly_revenue_mthb": round(rev_sum, 1),
            "th_cpi_yoy_pct": cpi_yoy,
            "th_cpi_month": cpi_month,
            "oil_brent_yoy_pct": oil_yoy,
            "active_external_shock_provinces": elevated_codes,
            "water_pollution_alert_provinces": water_alert_codes,
            "has_active_external_shock": len(elevated_codes) > 0,
        },
        "provinces": provinces_out,
        "vulnerability_tiers": build_tier_summary(provinces_out),
        "regional_timeseries": ts_out,
        "recent_verified_news": news_out,
    }
    _cache_set(cache_key, result)
    return result


@app.get("/api/provinces/{province_code}")
def get_province_detail(province_code: str) -> dict[str, Any]:
    """Serve detailed provincial monthly economic series, seasonality, NSO shift, and news."""
    code = resolve_northern_province(province_code)
    if not code:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Northern province code not found")

    cache_key = f"province_detail_{code}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    meta_rows = fetch_all(
        """
        SELECT
            d.province_code, d.name_th, d.name_en, d.subregion, d.lat, d.lon,
            c.model_used, c.cluster_id, c.cluster_label,
            c.shock_intensity, c.exposure_score, c.recommended_policy
        FROM silver.dim_provinces d
        LEFT JOIN gold.province_clusters c ON d.province_code = c.province_code
        WHERE d.province_code = :code
        """,
        {"code": code},
    )
    if not meta_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Province record not found")
    meta = meta_rows[0]

    series_rows = fetch_all(
        """
        SELECT month_date, target_metrics, selected_features, composite_shock_idx
        FROM gold.province_monthly_panel
        WHERE province_code = :code
        ORDER BY month_date ASC
        """,
        {"code": code},
    )

    monthly_series: list[dict[str, Any]] = []
    cal_buckets: dict[int, dict[str, list[float]]] = {
        m: {"occ": [], "pm25": [], "rain": []} for m in range(1, 13)
    }
    for r in series_rows:
        tm = r["target_metrics"] or {}
        sf = r["selected_features"] or {}
        m_num = int(r["month_date"].month)
        if tm.get("occupancy_rate") is not None:
            cal_buckets[m_num]["occ"].append(float(tm["occupancy_rate"]))
        if sf.get("pm25_mean") is not None:
            cal_buckets[m_num]["pm25"].append(float(sf["pm25_mean"]))
        if sf.get("rainfall_sum_mm") is not None:
            cal_buckets[m_num]["rain"].append(float(sf["rainfall_sum_mm"]))

        monthly_series.append(
            {
                "month_date": str(r["month_date"]),
                "occupancy_rate": tm.get("occupancy_rate"),
                "occupancy_deseason": tm.get("occupancy_deseason"),
                "occupancy_yoy_diff": tm.get("occupancy_yoy_diff"),
                "revenue_total_mthb": tm.get("revenue_total_mthb"),
                "visitors_total": tm.get("visitors_total"),
                "pm25_mean": sf.get("pm25_mean"),
                "rainfall_sum_mm": sf.get("rainfall_sum_mm"),
                "composite_shock_idx": float(r["composite_shock_idx"] or 0.0),
                "flood_shock_subidx": sf.get("flood_shock_subidx"),
                "haze_shock_subidx": sf.get("haze_shock_subidx"),
                "macro_pressure_subidx": sf.get("macro_pressure_subidx"),
                "shock_driver": sf.get("shock_driver", "normal"),
            }
        )

    seasonality = [
        {
            "cal_month": m,
            "avg_occupancy_rate": round(sum(b["occ"]) / len(b["occ"]), 1) if b["occ"] else None,
            "avg_pm25_mean": round(sum(b["pm25"]) / len(b["pm25"]), 1) if b["pm25"] else None,
            "avg_rainfall_mm": round(sum(b["rain"]) / len(b["rain"]), 1) if b["rain"] else None,
        }
        for m, b in sorted(cal_buckets.items())
    ]

    nso_latest = _fetch_nso_latest_by_province().get(code, {})
    news_rows = fetch_all(
        """
        SELECT e.event_date, e.sector, e.shock_type, e.severity_score, e.evidence_quote, n.title, n.source_url
        FROM silver.news_events e
        JOIN bronze.news_raw n ON e.news_id = n.id
        WHERE e.province_code = :code
        ORDER BY e.event_date DESC
        LIMIT 18
        """,
        {"code": code},
    )

    result = {
        "province": {
            "province_code": str(meta["province_code"]),
            "name_th": str(meta["name_th"]),
            "name_en": str(meta["name_en"]),
            "subregion": str(meta["subregion"]),
            "lat": float(meta["lat"]),
            "lon": float(meta["lon"]),
            "cluster_id": int(meta["cluster_id"]) if meta["cluster_id"] is not None else None,
            "cluster_label": str(meta["cluster_label"] or ""),
            "shock_intensity": float(meta["shock_intensity"]) if meta["shock_intensity"] is not None else None,
            "exposure_score": float(meta["exposure_score"]) if meta["exposure_score"] is not None else None,
            "recommended_policy": str(meta["recommended_policy"] or ""),
        },
        "nso_2025": nso_latest,
        "monthly_series": monthly_series,
        "seasonality_calendar": seasonality,
        "verified_news": [
            {
                "event_date": str(n["event_date"]),
                "sector": str(n["sector"]),
                "shock_type": str(n["shock_type"]),
                "severity_score": int(n["severity_score"]),
                "evidence_quote": str(n["evidence_quote"]),
                "title": str(n["title"]),
                "source_url": str(n["source_url"]),
            }
            for n in _dedupe_news_rows(news_rows, limit=6)
        ],
    }
    _cache_set(cache_key, result)
    return result


@app.post("/api/relief-check")
@limiter.limit(LIMIT_RELIEF)
def post_relief_check(request: Request, payload: ReliefCheckPayload) -> dict[str, Any]:
    """Run deterministic DSR assessment and retrieve grounded official BOT policy guidance."""
    prov_code = resolve_northern_province(payload.province)
    if not prov_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Province must be one of the 17 official Northern Thailand provinces",
        )
    res = assess_financial_resilience(
        province=prov_code,
        business_type=payload.business_type,
        monthly_revenue_thb=payload.monthly_revenue_thb,
        monthly_debt_thb=payload.monthly_debt_thb,
        impact_tags=payload.impact_tags,
        language=payload.language,
        log_anonymous=True,
    )
    _invalidate_read_cache()
    return res


@app.post("/api/chat")
@limiter.limit(LIMIT_CHAT)
def post_chat(request: Request, payload: ChatRequestPayload) -> dict[str, Any]:
    """Answer citizen or analyst questions strictly from verified official PDFs with page citations."""
    res = answer_policy_question(question=payload.question, language=payload.language)
    return {
        "answer_text": res["answer_text"],
        "key_points": res["key_points"],
        "citations": res["citations"],
        "was_refused": res["was_refused"],
        "refusal_reason": res["refusal_reason"],
        "pii_redacted_count": res["pii_redacted_count"],
        "top_vector_sim": res["top_vector_sim"],
        "model_used": res["model_used"],
        "latency_ms": res["latency_ms"],
    }


def _clean_policy_page_text(raw: str) -> str:
    """Reflow hard PDF line wraps and strip stray page number headers while keeping headings intact."""
    from src.extract.bot_pdf_loader import normalize_thai_pdf_text

    text = normalize_thai_pdf_text(raw)
    raw_lines = [ln.strip() for ln in text.split("\n")]

    # Drop standalone page number lines at the very top or bottom of a page
    while raw_lines and (not raw_lines[0] or re.fullmatch(r"[-–—\s]*\d{1,3}[-–—\s]*", raw_lines[0])):
        raw_lines.pop(0)
    while raw_lines and (not raw_lines[-1] or re.fullmatch(r"[-–—\s]*\d{1,3}[-–—\s]*", raw_lines[-1])):
        raw_lines.pop()

    heading_re = re.compile(r"^(\d+(\.\d+)*\s+|\(\d+\)\s+|[-•▪]\s+|ข้อ\s+\d+|หมวด\s+|ส่วนที่\s+|หลักเกณฑ์$|สรุปสาระสำคัญ)")
    out_paragraphs: list[str] = []
    curr = ""

    for ln in raw_lines:
        if not ln:
            if curr:
                out_paragraphs.append(curr.strip())
                curr = ""
            continue
        if heading_re.match(ln):
            if curr:
                out_paragraphs.append(curr.strip())
            curr = ln
        else:
            if not curr:
                curr = ln
            elif len(curr) < 42 and heading_re.match(curr) and not curr.endswith((")", "”", "\"")):
                # Join short split heading line such as "(1) การพัฒนาผลิตภัณฑ์" + "สินเชื่อ"
                curr = f"{curr}{ln}" if ("\u0e00" <= curr[-1] <= "\u0e7f" and "\u0e00" <= ln[0] <= "\u0e7f") else f"{curr} {ln}"
            else:
                # Join wrapped body lines smoothly
                sep = "" if (len(curr) > 55 and "\u0e00" <= curr[-1] <= "\u0e7f" and "\u0e00" <= ln[0] <= "\u0e7f" and not curr.endswith((" ", ")", "”"))) else " "
                curr = f"{curr}{sep}{ln}"

    if curr:
        out_paragraphs.append(curr.strip())

    return "\n\n".join(p for p in out_paragraphs if p)


@app.get("/api/policy-page")
def get_policy_page(
    doc_title: str = Query(..., min_length=2),
    page_num: int = Query(..., ge=1, le=500),
) -> dict[str, Any]:
    """Return full intact page text from bronze.bot_docs_raw without overlapping chunk splits."""
    cache_key = f"policy_page_v2_{doc_title.strip()}_{page_num}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    bronze_rows = fetch_all(
        """
        SELECT
            doc_title,
            doc_url,
            page_num,
            raw_text,
            (
                SELECT count(DISTINCT b2.page_num)
                FROM bronze.bot_docs_raw b2
                WHERE b2.doc_title = bronze.bot_docs_raw.doc_title
            ) AS total_pages
        FROM bronze.bot_docs_raw
        WHERE doc_title = :title AND page_num = :pnum
        ORDER BY id DESC
        LIMIT 1
        """,
        {"title": doc_title.strip(), "pnum": int(page_num)},
    )

    if bronze_rows:
        r0 = bronze_rows[0]
        cleaned_full = _clean_policy_page_text(str(r0.get("raw_text") or ""))
        paragraphs = [p.strip() for p in cleaned_full.split("\n\n") if p.strip()]
        payload = {
            "doc_title": str(r0["doc_title"]),
            "doc_url": str(r0.get("doc_url") or ""),
            "page_num": int(r0["page_num"]),
            "total_pages": int(r0.get("total_pages") or 1),
            "chunks": paragraphs,
            "full_text": cleaned_full,
        }
        _cache_set(cache_key, payload, ttl=600.0)
        return payload

    rows = fetch_all(
        """
        SELECT
            doc_title,
            doc_url,
            page_num,
            chunk_text,
            (
                SELECT count(DISTINCT p2.page_num)
                FROM silver.policy_chunks p2
                WHERE p2.doc_title = silver.policy_chunks.doc_title
            ) AS total_pages
        FROM silver.policy_chunks
        WHERE doc_title = :title AND page_num = :pnum
        ORDER BY chunk_id ASC
        """,
        {"title": doc_title.strip(), "pnum": int(page_num)},
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Official document page not found")

    paragraphs = []
    for r in rows:
        txt = _clean_policy_page_text(str(r.get("chunk_text") or ""))
        if txt and txt not in paragraphs:
            paragraphs.append(txt)

    payload = {
        "doc_title": str(rows[0]["doc_title"]),
        "doc_url": str(rows[0].get("doc_url") or ""),
        "page_num": int(rows[0]["page_num"]),
        "total_pages": int(rows[0].get("total_pages") or 1),
        "chunks": paragraphs,
        "full_text": "\n\n".join(paragraphs),
    }
    _cache_set(cache_key, payload, ttl=600.0)
    return payload


# Authenticated staff routes requiring bearer token

@app.get("/api/policy-monitor")
def get_policy_monitor(
    fresh: bool = Query(default=False),
    staff: dict[str, Any] = Depends(require_staff_token),
) -> dict[str, Any]:
    """Serve staff policy monitor with 4 quadrant clustering, screening stats, news, and anonymized demand."""
    t0 = time.perf_counter()
    if not fresh:
        cached = _cache_get("policy_monitor")
        if cached is not None:
            return {
                **cached,
                "authenticated_staff": staff["sub"],
                "cache_status": "HIT",
                "server_query_ms": round((time.perf_counter() - t0) * 1000.0, 1),
            }

    consolidated = fetch_all(
        """
        WITH avg_rev AS (
            SELECT
                province_code,
                round(avg((target_metrics->>'revenue_total_mthb')::numeric), 1) AS avg_monthly_revenue_mthb,
                round(avg((target_metrics->>'occupancy_rate')::numeric), 1) AS avg_occupancy_rate
            FROM gold.province_monthly_panel
            GROUP BY province_code
        ),
        panel_span AS (
            SELECT
                count(DISTINCT month_date) AS panel_months,
                min(month_date) AS min_month,
                max(month_date) AS max_month
            FROM gold.province_monthly_panel
        ),
        quad_cte AS (
            SELECT
                d.province_code, d.name_th, d.name_en, d.subregion,
                c.model_used, c.cluster_id, c.cluster_label,
                c.shock_intensity, c.exposure_score, c.silhouette_score, c.recommended_policy,
                r.avg_monthly_revenue_mthb, r.avg_occupancy_rate,
                ps.panel_months, ps.min_month, ps.max_month
            FROM silver.dim_provinces d
            JOIN gold.province_clusters c ON d.province_code = c.province_code
            LEFT JOIN avg_rev r ON d.province_code = r.province_code
            CROSS JOIN panel_span ps
            ORDER BY c.cluster_id, c.exposure_score DESC
        ),
        scr_cte AS (
            SELECT
                feature_name, dataset_name, target_name, best_lag_months,
                spearman_r, p_value, vif_score, is_selected, decision_reason
            FROM gold.feature_screening_results
            WHERE target_name IN ('occupancy_deseason', 'occupancy_yoy_diff', 'clustering_17_provinces')
            ORDER BY target_name, is_selected DESC, abs(coalesce(spearman_r, 0)) DESC
        ),
        dem_prov_cte AS (
            SELECT province_code, dsr_band, count(*) AS query_count
            FROM gold.relief_query_logs
            GROUP BY province_code, dsr_band
            ORDER BY query_count DESC
        ),
        dem_biz_cte AS (
            SELECT business_type, count(*) AS query_count
            FROM gold.relief_query_logs
            GROUP BY business_type
            ORDER BY query_count DESC
        )
        SELECT
            coalesce((SELECT json_agg(row_to_json(q)) FROM quad_cte q), '[]'::json) AS quad_json,
            coalesce((SELECT json_agg(row_to_json(s)) FROM scr_cte s), '[]'::json) AS scr_json,
            coalesce((SELECT json_agg(row_to_json(dp)) FROM dem_prov_cte dp), '[]'::json) AS dem_prov_json,
            coalesce((SELECT json_agg(row_to_json(db)) FROM dem_biz_cte db), '[]'::json) AS dem_biz_json
        """
    )[0]

    quad_rows = consolidated["quad_json"] or []
    screening_rows = consolidated["scr_json"] or []
    demand_by_prov = consolidated["dem_prov_json"] or []
    demand_by_biz = consolidated["dem_biz_json"] or []
    nso_map = _fetch_nso_latest_by_province()

    quadrant_points = [
        {
            "province_code": str(q["province_code"]),
            "name_th": str(q["name_th"]),
            "name_en": str(q["name_en"]),
            "subregion": str(q["subregion"]),
            "cluster_id": int(q["cluster_id"]),
            "cluster_label": str(q["cluster_label"]),
            "shock_intensity": float(q["shock_intensity"]),
            "exposure_score": float(q["exposure_score"]),
            "avg_monthly_revenue_mthb": float(q.get("avg_monthly_revenue_mthb") or 0.0),
            "avg_occupancy_rate": float(q.get("avg_occupancy_rate") or 0.0),
            "debt_to_annual_income_all": nso_map.get(str(q["province_code"]), {}).get("debt_to_annual_income_all"),
            "debt_to_annual_income_sme": nso_map.get(str(q["province_code"]), {}).get("debt_to_annual_income_sme"),
            "expense_to_income_pct_sme": nso_map.get(str(q["province_code"]), {}).get("expense_to_income_pct_sme"),
            "recommended_policy": str(q["recommended_policy"]),
        }
        for q in quad_rows
    ]

    panel_months = int(quad_rows[0]["panel_months"]) if quad_rows and quad_rows[0].get("panel_months") else 0
    panel_start = str(quad_rows[0]["min_month"]) if quad_rows and quad_rows[0].get("min_month") else ""
    panel_end = str(quad_rows[0]["max_month"]) if quad_rows and quad_rows[0].get("max_month") else ""

    payload = {
        "authenticated_staff": staff["sub"],
        "model_used": str(quad_rows[0]["model_used"]) if quad_rows else None,
        "silhouette_score": float(quad_rows[0]["silhouette_score"]) if quad_rows and quad_rows[0]["silhouette_score"] is not None else None,
        "panel_months": panel_months,
        "panel_start_month": panel_start,
        "panel_end_month": panel_end,
        "quadrant_provinces": quadrant_points,
        "feature_screening": screening_rows,
        "public_demand_signals": {
            "total_checks": sum(int(r["query_count"]) for r in demand_by_prov),
            "by_province_and_band": [
                {
                    "province_code": str(r["province_code"]),
                    "dsr_band": str(r["dsr_band"]),
                    "query_count": int(r["query_count"]),
                }
                for r in demand_by_prov
            ],
            "by_business_type": [
                {"business_type": str(r["business_type"]), "query_count": int(r["query_count"])}
                for r in demand_by_biz
            ],
        },
    }
    _cache_set("policy_monitor", payload)
    return {
        **payload,
        "cache_status": "MISS",
        "server_query_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    }


@app.get("/api/data-health")
def get_data_health(
    fresh: bool = Query(default=False),
    staff: dict[str, Any] = Depends(require_staff_token),
) -> dict[str, Any]:
    """Serve live medallion layer row counts, quarantine diagnostics, RAG storage, and eval runs."""
    t0 = time.perf_counter()
    if not fresh:
        cached = _cache_get("data_health")
        if cached is not None:
            return {
                **cached,
                "authenticated_staff": staff["sub"],
                "cache_status": "HIT",
                "server_query_ms": round((time.perf_counter() - t0) * 1000.0, 1),
            }

    consolidated = fetch_all(
        """
        WITH counts_cte AS (
            SELECT
                (SELECT count(*) FROM bronze.air4thai_raw) AS bronze_air4thai,
                (SELECT count(*) FROM bronze.news_raw) AS bronze_news,
                (SELECT count(*) FROM bronze.provincial_stats_raw) AS bronze_stats,
                (SELECT count(*) FROM bronze.bot_docs_raw) AS bronze_pdf_pages,
                (SELECT count(*) FROM silver.dim_provinces) AS silver_provinces,
                (SELECT count(*) FROM silver.air_daily) AS silver_air_daily,
                (SELECT count(*) FROM silver.news_events) AS silver_news_events,
                (SELECT count(*) FROM silver.quarantine) AS silver_quarantine,
                (SELECT count(*) FROM silver.policy_chunks) AS silver_policy_chunks,
                (SELECT count(DISTINCT doc_title) FROM silver.policy_chunks) AS silver_policy_docs,
                round((pg_total_relation_size('silver.policy_chunks') / 1048576.0)::numeric, 2) AS rag_storage_mb,
                (SELECT count(*) FROM gold.feature_screening_results) AS gold_screening,
                (SELECT count(*) FROM gold.province_monthly_panel) AS gold_monthly_panel,
                (SELECT count(DISTINCT month_date) FROM gold.province_monthly_panel) AS panel_months,
                (SELECT count(*) FROM gold.province_clusters) AS gold_clusters,
                (SELECT count(*) FROM gold.relief_query_logs) AS gold_relief_logs
        ),
        q_cte AS (
            SELECT source_table, error_reason, count(*) AS cnt
            FROM silver.quarantine
            GROUP BY source_table, error_reason
            ORDER BY cnt DESC
            LIMIT 12
        ),
        eval_cte AS (
            SELECT DISTINCT ON (run_type)
                run_type,
                CASE
                    WHEN metrics_json ? 'all_24_benchmarks' THEN metrics_json - 'all_24_benchmarks'
                    ELSE metrics_json
                END AS metrics_json,
                token_count,
                estimated_cost_thb,
                ran_at
            FROM gold.pipeline_eval_runs
            ORDER BY run_type, ran_at DESC
        ),
        docs_cte AS (
            SELECT doc_title, doc_url, count(*) AS chunk_count, count(DISTINCT page_num) AS page_count
            FROM silver.policy_chunks
            GROUP BY doc_title, doc_url
            ORDER BY doc_title
        )
        SELECT
            (SELECT row_to_json(c) FROM counts_cte c) AS counts_json,
            coalesce((SELECT json_agg(row_to_json(q)) FROM q_cte q), '[]'::json) AS quarantine_json,
            coalesce((SELECT json_agg(row_to_json(e)) FROM eval_cte e), '[]'::json) AS evals_json,
            coalesce((SELECT json_agg(row_to_json(d)) FROM docs_cte d), '[]'::json) AS docs_json
        """
    )[0]

    counts = consolidated["counts_json"] or {}
    quarantine_breakdown = consolidated["quarantine_json"] or []
    latest_evals = consolidated["evals_json"] or []
    indexed_docs = consolidated["docs_json"] or []

    trimmed_evals: list[dict[str, Any]] = [
        {
            "run_type": str(e["run_type"]),
            "token_count": int(e.get("token_count") or 0),
            "estimated_cost_thb": float(e.get("estimated_cost_thb") or 0.0),
            "ran_at": str(e["ran_at"]),
            "metrics_json": e["metrics_json"],
        }
        for e in latest_evals
    ]

    payload = {
        "authenticated_staff": staff["sub"],
        "layer_counts": {k: (float(v) if k == "rag_storage_mb" else int(v)) for k, v in counts.items()},
        "quarantine_breakdown": [
            {
                "source_table": str(q["source_table"]),
                "error_reason": str(q["error_reason"]),
                "count": int(q["cnt"]),
            }
            for q in quarantine_breakdown
        ],
        "indexed_official_documents": [
            {
                "doc_title": str(d["doc_title"]),
                "doc_url": str(d.get("doc_url") or ""),
                "page_count": int(d["page_count"]),
                "chunk_count": int(d["chunk_count"]),
            }
            for d in indexed_docs
        ],
        "latest_eval_runs": trimmed_evals,
    }
    _cache_set("data_health", payload)
    return {
        **payload,
        "cache_status": "MISS",
        "server_query_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    }


@app.get("/api/export-brief")
def export_executive_brief(
    format: Literal["json", "markdown", "html"] = Query(default="json"),
    lang: Literal["th", "en"] = Query(default="th"),
    staff: dict[str, Any] = Depends(require_staff_token),
) -> Any:
    """Export one page printable executive policy brief in JSON, Markdown, or HTML format."""
    brief = build_executive_brief_data(language=lang)
    if format == "markdown":
        return PlainTextResponse(
            content=render_brief_markdown(brief, language=lang),
            media_type="text/markdown; charset=utf-8",
        )
    if format == "html":
        return HTMLResponse(content=render_brief_html(brief, language=lang))
    return brief


@app.post("/api/refresh")
@limiter.limit(LIMIT_REFRESH)
def trigger_incremental_refresh(
    request: Request,
    staff: dict[str, Any] = Depends(require_staff_token),
) -> dict[str, Any]:
    """Run live Air4Thai sensor sync, 17 province RSS news fetch, and immediate Silver extraction."""
    import logging

    from src.extract.air4thai_client import load_air4thai_to_bronze
    from src.extract.news_scraper import load_news_to_bronze
    from src.transform.llm_shock_extractor import run_silver_news_extraction
    from src.transform.silver_clean import transform_air4thai_bronze_to_silver

    log = logging.getLogger(__name__)
    errors: list[str] = []

    air_bronze: dict[str, Any] = {"fetched_valid": 0, "inserted_bronze": 0, "quarantined": 0}
    air_silver: dict[str, Any] = {}
    try:
        air_bronze = load_air4thai_to_bronze()
        air_silver = transform_air4thai_bronze_to_silver()
    except Exception as exc:
        log.warning("Air4Thai live sync failed: %s", exc)
        errors.append(f"air4thai: {exc}")

    news_bronze: dict[str, Any] = {"fetched_unique": 0}
    news_silver: dict[str, Any] = {"validated_silver": 0}
    try:
        news_bronze = load_news_to_bronze()
        news_silver = run_silver_news_extraction(limit=40, batch_size=10)
    except Exception as exc:
        log.warning("News live sync failed: %s", exc)
        errors.append(f"news: {exc}")

    _invalidate_read_cache()
    return {
        "status": "partial" if errors else "refreshed",
        "triggered_by": staff["sub"],
        "air4thai_bronze": air_bronze,
        "air4thai_silver": air_silver,
        "news_bronze": news_bronze,
        "news_silver": news_silver,
        "errors": errors,
    }


class StaffReclusterRequest(BaseModel):
    """Payload for interactive staff KMeans clustering and VIF diagnostic run."""

    k: int = Field(default=4, ge=3, le=5)
    feature_keys: list[str] | None = Field(default=None)
    persist: bool = Field(default=False)


class StaffMonteCarloRequest(BaseModel):
    """Payload for Empirical Bootstrap Monte Carlo cashflow simulation."""

    horizon_months: int = Field(default=3, ge=1, le=6)
    cost_shock_pct: float = Field(default=5.0, ge=0.0, le=25.0)
    include_news_regime: bool = Field(default=True)
    n_simulations: int = Field(default=3000, ge=500, le=5000)


@app.post("/api/staff/recluster")
def staff_recluster(
    payload: StaffReclusterRequest,
    staff: dict[str, Any] = Depends(require_staff_token),
) -> dict[str, Any]:
    """Execute dynamic KMeans clustering with live VIF check and targeted policy prescriptions."""
    res = run_interactive_clustering(
        k=payload.k,
        feature_keys=payload.feature_keys,
        persist=payload.persist,
    )
    if payload.persist:
        _invalidate_read_cache()
    res["triggered_by"] = staff["sub"]
    return res


@app.post("/api/staff/monte-carlo")
def staff_monte_carlo(
    payload: StaffMonteCarloRequest,
    staff: dict[str, Any] = Depends(require_staff_token),
) -> dict[str, Any]:
    """Execute Empirical Bootstrap Monte Carlo cashflow stress test."""
    res = run_empirical_monte_carlo(
        horizon_months=payload.horizon_months,
        cost_shock_pct=payload.cost_shock_pct,
        include_news_regime=payload.include_news_regime,
        n_simulations=payload.n_simulations,
    )
    res["triggered_by"] = staff["sub"]
    return res


def _warm_read_pool_background() -> None:
    """Pre warm pooled Neon connections, public risk outlook, and staff modeling datasets on boot."""
    try:
        get_risk_outlook(months=12)
        _get_cached_monte_carlo_inputs()
        _get_cached_clustering_inputs()
    except Exception:
        pass


threading.Thread(target=_warm_read_pool_background, daemon=True).start()
