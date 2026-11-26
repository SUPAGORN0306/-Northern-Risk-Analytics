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
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
import httpx
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
from src.analytics.clustering import compute_cluster_run_diff
from src.analytics.vulnerability_tiering import (
    build_tier_summary,
    compute_weight_sensitivity,
    evaluate_province_vulnerability,
)
from src.db.connection import fetch_all
from src.extract.air4thai_client import fetch_northern_air4thai
from src.evaluation.layered_eval import build_layered_evaluation_summary
from src.guardrails.schemas import get_province_metadata, resolve_northern_province
from src.config.feature_registry import get_git_commit_short, get_spec_version
from src.rag.policy_assistant import (
    answer_policy_question,
    assess_financial_resilience,
    get_rag_index_version,
)
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


def _build_provenance(
    population_scope: str,
    source_org: list[str],
    as_of_date: str | None,
    run_id: str | None = None,
    ecological_fallacy_warning: bool = True,
) -> dict[str, Any]:
    """Attach enough metadata to interpret and reproduce public analytics outputs."""
    return {
        "population_scope": population_scope,
        "source_org": source_org,
        "as_of_date": as_of_date,
        "run_id": run_id,
        "feature_spec_version": get_spec_version(),
        "git_commit": get_git_commit_short(),
        "ecological_fallacy_warning": ecological_fallacy_warning,
    }

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
LIMIT_STAFF_LOGIN = str(_RATE_CFG.get("staff_login", "10/minute"))

limiter = Limiter(key_func=get_remote_address)

def _is_production_env() -> bool:
    """Detect production deployment runtime on Render or explicit ENV setting."""
    return (
        os.getenv("RENDER", "").strip().lower() in {"1", "true", "yes"}
        or os.getenv("ENV", "").strip().lower() in {"prod", "production"}
    )


@asynccontextmanager
async def _app_lifespan(_app: FastAPI):
    """Fail fast at production startup when dedicated staff auth signing secret is missing."""
    if _is_production_env():
        secret = (os.getenv("STAFF_AUTH_SECRET") or "").strip()
        if len(secret) < 16:
            raise RuntimeError("STAFF_AUTH_SECRET must be explicitly configured with at least 16 characters in production")
    yield


app = FastAPI(
    title="NorthRisk Analytics API",
    description="Debt relief planning and regional economic risk analytics API for Thailand 17 Northern provinces.",
    version="1.0.0",
    lifespan=_app_lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Configure strict CORS origins from environment variable with project scoped Vercel regex
_raw_origins = os.getenv(
    "ALLOWED_ORIGINS",
    "https://northrisk.vercel.app,https://northrisk-analytics.vercel.app,http://localhost:3000,http://127.0.0.1:3000",
)
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
_allowed_origin_regex = os.getenv(
    "ALLOWED_ORIGIN_REGEX",
    r"https://(northrisk|northern-risk-analytics)[a-z0-9-]*\.vercel\.app",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_allowed_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# Request models validated deterministically with Pydantic and strict whitelists

ALLOWED_RELIEF_BUSINESS_TYPES = Literal[
    "hotel",
    "restaurant",
    "tour",
    "general_service",
    "household",
    "retail",
    "agriculture",
]
ALLOWED_RELIEF_IMPACT_TAGS = Literal[
    "overdue_debt",
    "persistent_debt",
    "disaster",
    "water_pollution",
    "pm25",
    "flood",
    "haze",
    "cost_surge",
    "revenue_drop",
    "debt_stress",
    "overdue",
]


class StaffLoginRequest(BaseModel):
    """Credentials for staff portal sign in."""

    username: str = Field(..., min_length=2, max_length=60)
    password: str = Field(..., min_length=4, max_length=120)


class ReliefCheckPayload(BaseModel):
    """Input payload for deterministic DSR calculation and grounded policy guidance."""

    province: str = Field(..., min_length=2, max_length=60)
    business_type: ALLOWED_RELIEF_BUSINESS_TYPES = Field(default="general_service")
    monthly_revenue_thb: float = Field(..., ge=0.0, le=1e9)
    monthly_debt_thb: float = Field(..., ge=0.0, le=1e9)
    total_principal_thb: float = Field(default=0.0, ge=0.0, le=1e9)
    debt_payment_unspecified: bool = Field(default=False)
    impact_tags: list[ALLOWED_RELIEF_IMPACT_TAGS] = Field(default_factory=list, max_length=8)
    language: Literal["th", "en"] = Field(default="th")


class ChatRequestPayload(BaseModel):
    """Input payload for guardrailed policy and regional economic knowledge assistant."""

    question: str = Field(..., min_length=2, max_length=600)
    recent_questions: list[str] = Field(default_factory=list, max_length=4)
    language: Literal["th", "en"] = Field(default="th")
    province: str | None = Field(default=None, min_length=2, max_length=60)
    regional_scope: bool = False


class ChatFeedbackPayload(BaseModel):
    """Minimal categorical feedback without retaining question or answer text."""

    rating: Literal["helpful", "inaccurate", "incomplete"]
    reason_tag: Literal["wrong_fact", "missing_source", "unclear", "other"] | None = None
    language: Literal["th", "en"] = "th"
    model_used: str | None = Field(default=None, max_length=80)
    top_vector_sim: float | None = Field(default=None, ge=0.0, le=1.0)
    was_refused: bool = False


# Stateless HMAC SHA256 staff token helpers and role based access control

STAFF_ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "policy_analyst": ("view_overview", "export_brief", "run_modeling"),
    "demo_policy_analyst": ("view_overview", "export_brief", "run_modeling"),
    "data_steward": ("view_health", "trigger_refresh", "publish_clusters", "view_overview", "run_modeling"),
    "demo_data_steward": ("view_health", "trigger_refresh", "publish_clusters", "view_overview", "run_modeling"),
    "admin": (
        "view_overview",
        "export_brief",
        "run_modeling",
        "publish_clusters",
        "view_health",
        "trigger_refresh",
    ),
}


def _permissions_for_role(role: str | None) -> tuple[str, ...]:
    """Return canonical permission tuple for a staff role."""
    return STAFF_ROLE_PERMISSIONS.get(str(role or "").strip().lower(), ())


def _staff_has_permission(staff: dict[str, Any], permission: str) -> bool:
    """Check whether an authenticated staff token payload grants the requested permission."""
    return permission in _permissions_for_role(staff.get("role"))


def _get_auth_secret() -> bytes:
    """Return dedicated signing secret and fail closed when unconfigured."""
    dedicated = (os.getenv("STAFF_AUTH_SECRET") or "").strip()
    if dedicated:
        return hashlib.sha256(dedicated.encode("utf-8")).digest()
    if _is_production_env():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Dedicated STAFF_AUTH_SECRET is required in production",
        )
    local_fallback = (os.getenv("DATABASE_URL") or "").strip()
    if not local_fallback:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Staff authentication signing secret is not configured",
        )
    return hashlib.sha256(local_fallback.encode("utf-8")).digest()


def _create_staff_token(username: str, role: str = "policy_analyst") -> dict[str, Any]:
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
        "permissions": list(_permissions_for_role(role)),
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


def require_staff_permission(permission: str):
    """Build a FastAPI dependency enforcing role based access control for a specific permission."""

    def _dependency(staff: dict[str, Any] = Depends(require_staff_token)) -> dict[str, Any]:
        if not _staff_has_permission(staff, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{staff.get('role', 'unknown')}' does not have permission '{permission}'.",
            )
        return staff

    return _dependency


def _configured_staff_accounts() -> list[tuple[str, str, str]]:
    """Collect configured staff login accounts mapped to their operational RBAC roles."""
    accounts: list[tuple[str, str, str]] = []
    analyst_user = (os.getenv("STAFF_ANALYST_USERNAME") or os.getenv("STAFF_DEMO_USERNAME") or "").strip()
    analyst_pass = os.getenv("STAFF_ANALYST_PASSWORD") or os.getenv("STAFF_DEMO_PASSWORD") or ""
    if analyst_user and analyst_pass:
        accounts.append((analyst_user, analyst_pass, "policy_analyst"))

    steward_user = (os.getenv("STAFF_STEWARD_USERNAME") or "").strip()
    steward_pass = os.getenv("STAFF_STEWARD_PASSWORD") or ""
    if steward_user and steward_pass:
        accounts.append((steward_user, steward_pass, "data_steward"))

    admin_user = (os.getenv("STAFF_ADMIN_USERNAME") or "").strip()
    admin_pass = os.getenv("STAFF_ADMIN_PASSWORD") or ""
    if admin_user and admin_pass:
        accounts.append((admin_user, admin_pass, "admin"))
    return accounts


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

    out: dict[str, dict[str, float | None]] = {}
    for code, m in raw_map.items():
        inc_all = m.get("monthly_income_thb_all")
        inc_sme = m.get("monthly_income_thb_sme")
        debt_all = m.get("avg_household_debt_thb_all")
        debt_sme = m.get("avg_household_debt_thb_sme")
        exp_all = m.get("expense_to_income_pct_all")
        exp_sme = m.get("expense_to_income_pct_sme")

        out[code] = {
            "debt_to_annual_income_all": round(debt_all / (inc_all * 12.0), 2)
            if (debt_all is not None and inc_all is not None and inc_all > 0)
            else None,
            "debt_to_annual_income_sme": round(debt_sme / (inc_sme * 12.0), 2)
            if (debt_sme is not None and inc_sme is not None and inc_sme > 0)
            else None,
            "expense_to_income_pct_all": round(exp_all, 1) if exp_all is not None else None,
            "expense_to_income_pct_sme": round(exp_sme, 1) if exp_sme is not None else None,
            "monthly_income_thb_all": round(inc_all, 0) if inc_all is not None else None,
            "monthly_income_thb_sme": round(inc_sme, 0) if inc_sme is not None else None,
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
@limiter.limit(LIMIT_STAFF_LOGIN)
def staff_login(request: Request, payload: StaffLoginRequest) -> dict[str, Any]:
    """Authenticate staff credentials across configured RBAC roles failing closed when unset."""
    accounts = _configured_staff_accounts()
    if not accounts:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Staff authentication credentials are not configured on this server.",
        )
    incoming_user = payload.username.strip()
    matched: tuple[str, str] | None = None
    for expected_user, expected_pass, role in accounts:
        user_ok = hmac.compare_digest(incoming_user, expected_user)
        pass_ok = hmac.compare_digest(payload.password, expected_pass)
        if user_ok and pass_ok and matched is None:
            matched = (expected_user, role)
    if matched is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid staff credentials")
    return _create_staff_token(username=matched[0], role=matched[1])


@app.post("/api/auth/demo-access")
def staff_demo_access(
    role: Literal["policy_analyst", "data_steward"] = Query(default="policy_analyst"),
) -> dict[str, Any]:
    """Block unauthenticated demo token issuance unless explicitly opted in for local testing."""
    if os.getenv("ALLOW_DEMO_STAFF_ACCESS", "false").strip().lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unauthenticated demo token issuance is disabled. Please sign in with staff credentials.",
        )
    if role == "data_steward":
        return _create_staff_token(username="demo_steward", role="demo_data_steward")
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
            p.month_date, p.composite_shock_idx, p.target_metrics, p.selected_features, p.run_id,
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

        shock_idx = (
            round(float(r["composite_shock_idx"]), 2)
            if r["composite_shock_idx"] is not None
            else None
        )
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
        has_shock = (shock_idx is not None and shock_idx >= 50.0) or live_pm_crit or has_water
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
        ORDER BY e.event_date DESC, e.severity_score DESC, e.event_id DESC
        LIMIT 40
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
        for n in _dedupe_news_rows(news_rows, limit=10)
    ]

    default_cm_detail = None
    try:
        default_cm_detail = get_province_detail("CM")
    except Exception:
        default_cm_detail = None

    result = {
        "latest_month": latest_month,
        "provenance": _build_provenance(
            "17_provinces_northern_thailand", ["MOTS", "NSO", "PCD Air4Thai", "Open-Meteo", "BOT"],
            str(latest_month) if latest_month else None,
            str(next((r["run_id"] for r in latest_rows if r.get("run_id")), "")) or None,
            ecological_fallacy_warning=True,
        ),
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
        "weight_sensitivity": compute_weight_sensitivity(provinces_out),
        "regional_timeseries": ts_out,
        "recent_verified_news": news_out,
        "default_province_detail": default_cm_detail,
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
        SELECT month_date, target_metrics, selected_features, composite_shock_idx, run_id
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
                "composite_shock_idx": float(r["composite_shock_idx"]) if r["composite_shock_idx"] is not None else None,
                "flood_shock_subidx": sf.get("flood_shock_subidx"),
                "haze_shock_subidx": sf.get("haze_shock_subidx"),
                "macro_pressure_subidx": sf.get("macro_pressure_subidx"),
                "th_cpi_yoy_pct": sf.get("th_cpi_yoy_pct"),
                "oil_brent_yoy_pct": sf.get("oil_brent_yoy_pct"),
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
        SELECT
            e.event_id, e.event_date, e.sector, e.shock_type, e.severity_score,
            e.evidence_quote, n.title, n.source_name, n.source_url
        FROM silver.news_events e
        JOIN bronze.news_raw n ON e.news_id = n.id
        WHERE e.province_code = :code
        ORDER BY e.event_date DESC, e.event_id DESC
        LIMIT 40
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
        "provenance": _build_provenance(
            f"province_{code}", ["MOTS", "NSO", "PCD Air4Thai", "Open-Meteo", "BOT"],
            str(monthly_series[-1]["month_date"]) if monthly_series else None,
            str(series_rows[-1]["run_id"]) if series_rows and series_rows[-1].get("run_id") else None,
            ecological_fallacy_warning=True,
        ),
        "monthly_series": monthly_series,
        "seasonality_calendar": seasonality,
        "verified_news": [
            {
                "event_id": int(n["event_id"]),
                "event_date": str(n["event_date"]),
                "sector": str(n["sector"]),
                "shock_type": str(n["shock_type"]),
                "severity_score": int(n["severity_score"]),
                "evidence_quote": str(n["evidence_quote"]),
                "title": str(n["title"]),
                "source_name": str(n["source_name"] or ""),
                "source_url": str(n["source_url"]),
            }
            for n in _dedupe_news_rows(news_rows, limit=10)
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
        total_principal_thb=payload.total_principal_thb,
        debt_payment_unspecified=payload.debt_payment_unspecified,
    )
    res["provenance"] = _build_provenance(
        "individual_or_business_user_inputs", ["user-provided inputs", "BOT policy documents"],
        datetime.now(ICT_TZ).date().isoformat(), ecological_fallacy_warning=False,
    )
    _invalidate_read_cache()
    return res


@app.post("/api/chat")
@limiter.limit(LIMIT_CHAT)
def post_chat(request: Request, payload: ChatRequestPayload) -> dict[str, Any]:
    """Answer from official documents and, when selected, database-backed province context."""
    chat_started_at = time.perf_counter()
    province_code = resolve_northern_province(payload.province) if payload.province else None
    if payload.province and not province_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Province must be one of the 17 official Northern Thailand provinces",
        )
    if province_code and payload.regional_scope:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose either one province or the Northern region overview, not both",
        )

    province_context = None
    data_sources: list[dict[str, Any]] = []
    asks_debt_or_policy = bool(
        re.search(
            r"หนี้|สินเชื่อ|ค่างวด|ผ่อน|มาตรการ|โครงการ|ช่วยเหลือ|ปรับโครงสร้าง|พักชำระ|พักต้น|คลินิก|ธนาคาร|เจ้าหนี้|แก้หนี้|debt|loan|installment|payment|relief|restructur|lender|program",
            payload.question,
            re.I,
        )
    )
    is_regional_news_question = bool(
        re.search(r"ข่าว|สารพิษ|สารหนู|มลพิษ|น้ำท่วม|เหตุการณ์|news|toxin|arsenic|pollution|flood|incident", payload.question, re.I)
    )
    if province_code:
        wants_weather = bool(re.search(r"ฝน|อากาศ|พยากรณ์|rain|weather|forecast", payload.question, re.I))
        wants_air = bool(re.search(r"ฝุ่น|pm\s*2\.5|คุณภาพอากาศ|air quality|haze", payload.question, re.I))
        province_context, data_sources = _build_chat_province_context(
            province_code, payload.language, payload.question, wants_weather, wants_air
        )
        province_context_data = json.loads(province_context)
        if is_regional_news_question and not asks_debt_or_policy and not province_context_data.get("verified_local_news_in_database"):
            cutoff = (datetime.now(ICT_TZ).date() - timedelta(days=120)).isoformat()
            no_match_answer = (
                "ยังไม่พบข่าวเหตุสารพิษหรือมลพิษทางน้ำที่ผ่านการคัดกรองในฐานข้อมูลจังหวัดนี้ช่วง 120 วันที่ผ่านมา ข้อนี้หมายถึงไม่พบรายการในฐานข้อมูล ไม่ได้ยืนยันว่าไม่มีเหตุเกิดขึ้น"
                if re.search(r"สารพิษ|สารหนู|arsenic|toxin", payload.question, re.I) and payload.language == "th"
                else "ยังไม่พบข่าวท้องถิ่นที่ผ่านการคัดกรองในฐานข้อมูลจังหวัดนี้ช่วง 120 วันที่ผ่านมา ข้อนี้หมายถึงไม่พบรายการในฐานข้อมูล ไม่ได้ยืนยันว่าไม่มีเหตุเกิดขึ้น"
                if payload.language == "th"
                else "No screened local news event was found in this province in the database for the last 120 days. This means no matching record was found; it does not confirm that no incident occurred."
            )
            return {
                "answer_text": no_match_answer,
                "key_points": [],
                "citations": [],
                "was_refused": False,
                "refusal_reason": None,
                "pii_redacted_count": 0,
                "top_vector_sim": 0.0,
                "model_used": "deterministic_news_lookup",
                "latency_ms": round((time.perf_counter() - chat_started_at) * 1000.0, 1),
                "data_sources": [{
                    "title": f"Province news database · 120-day search window ending {datetime.now(ICT_TZ).date().isoformat()}",
                    "source_name": "Project verified local-news database",
                    "observed_at": cutoff,
                }],
            }
    elif payload.regional_scope:
        province_context, data_sources = _build_chat_regional_context(payload.language, payload.question)
        if is_regional_news_question and not asks_debt_or_policy and not json.loads(province_context).get("verified_local_news_events"):
            is_toxin_query = bool(re.search(r"สารพิษ|สารหนู|arsenic|toxin", payload.question, re.I))
            no_match_answer = (
                "ยังไม่พบข่าวเหตุสารพิษหรือมลพิษทางน้ำที่ผ่านการยืนยันในฐานข้อมูลช่วง 120 วันที่ผ่านมา ข้อนี้หมายถึงไม่พบรายการในฐานข้อมูล ไม่ได้ยืนยันว่าไม่มีเหตุเกิดขึ้น"
                if is_toxin_query and payload.language == "th"
                else "ยังไม่พบข่าวท้องถิ่นที่ผ่านการยืนยันในฐานข้อมูลช่วง 120 วันที่ผ่านมา ข้อนี้หมายถึงไม่พบรายการในฐานข้อมูล ไม่ได้ยืนยันว่าไม่มีเหตุเกิดขึ้น"
                if payload.language == "th"
                else "No verified local news event was found in the database for the last 120 days. This means no matching record was found; it does not confirm that no incident occurred."
            )
            return {
                "answer_text": no_match_answer,
                "key_points": [],
                "citations": [],
                "was_refused": False,
                "refusal_reason": None,
                "pii_redacted_count": 0,
                "top_vector_sim": 0.0,
                "model_used": "deterministic_news_lookup",
                "latency_ms": round((time.perf_counter() - chat_started_at) * 1000.0, 1),
                "data_sources": [],
            }
    elif is_regional_news_question:
        province_context, data_sources = _build_chat_regional_news_context(payload.language, payload.question)
    is_province_data_question = bool(
        province_context
        and not asks_debt_or_policy
        and (is_regional_news_question or re.search(
            r"เศรษฐกิจ|รายได้(?:จังหวัด|ท่องเที่ยว|พื้นที่|เฉลี่ย)|ท่องเที่ยว|อัตราเข้าพัก|เข้าพัก|ฝน|ฝุ่น|อากาศ|pm\s*2\.5|มลพิษ|สารพิษ|น้ำท่วม|ข่าว|economic|(?:provincial|tourism|local|average)\s+revenue|tourism|occupancy|rain|weather|air quality|pollution|news|flood",
            payload.question,
            flags=re.IGNORECASE,
        ))
    )
    res = answer_policy_question(
        question=payload.question,
        language=payload.language,
        extra_context=province_context,
        allow_context_only=is_province_data_question,
        recent_questions=[str(q)[:600] for q in payload.recent_questions[-4:]],
    )
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
        "data_sources": data_sources,
    }


@app.post("/api/chat/feedback")
@limiter.limit("30/minute")
def post_chat_feedback(request: Request, payload: ChatFeedbackPayload) -> dict[str, Any]:
    """Store anonymous categorical RAG feedback only; never accept transcript or free text."""
    from src.db.connection import bulk_execute

    bulk_execute(
        """
        INSERT INTO gold.chat_feedback (
            rating, reason_tag, language, model_used, top_vector_sim, was_refused
        ) VALUES (
            :rating, :reason_tag, :language, :model_used, :top_vector_sim, :was_refused
        )
        """,
        [{
            "rating": payload.rating,
            "reason_tag": payload.reason_tag,
            "language": payload.language,
            "model_used": payload.model_used,
            "top_vector_sim": payload.top_vector_sim,
            "was_refused": payload.was_refused,
        }],
    )
    return {"saved": True}


def _build_chat_province_context(
    province_code: str, language: str, question: str, wants_weather: bool, wants_air: bool
) -> tuple[str, list[dict[str, Any]]]:
    """Prepare bounded, dated local metrics/news for the chat model without inventing a forecast."""
    detail = get_province_detail(province_code)
    province = detail["province"]
    latest_month = next(
        (row for row in reversed(detail["monthly_series"]) if any(
            row.get(key) is not None
            for key in ("occupancy_rate", "revenue_total_mthb", "visitors_total", "pm25_mean", "rainfall_sum_mm")
        )),
        None,
    )
    air_rows = fetch_all(
        """
        SELECT obs_date, pm25_mean, pm25_max, station_count, exceeds_37_5, exceeds_75_0
        FROM silver.air_daily
        WHERE province_code = :code
        ORDER BY obs_date DESC
        LIMIT 1
        """,
        {"code": province_code},
    )
    air = air_rows[0] if air_rows else None
    live_air = _fetch_live_air4thai_province(province_code) if wants_air else None
    live_weather = _fetch_live_weather_forecast(province) if wants_weather else None
    news_cutoff = (datetime.now(ICT_TZ).date() - timedelta(days=120)).isoformat()
    news_through = datetime.now(ICT_TZ).date().isoformat()
    recent_news = [
        item for item in detail["verified_news"]
        if news_cutoff <= str(item.get("event_date") or "") <= news_through
    ][:5]
    context = {
        "province": province["name_th" if language == "th" else "name_en"],
        "latest_monthly_observation": latest_month,
        "current_weather_and_7_day_forecast": live_weather,
        "current_air4thai_station_observations": live_air,
        "latest_air_quality_daily_observation": {
            "date": str(air["obs_date"]),
            "pm25_mean_ug_m3": float(air["pm25_mean"]) if air["pm25_mean"] is not None else None,
            "pm25_max_ug_m3": float(air["pm25_max"]) if air["pm25_max"] is not None else None,
            "station_count": int(air["station_count"]),
            "exceeded_threshold_37_5": bool(air["exceeds_37_5"]) if air["exceeds_37_5"] is not None else None,
            "exceeded_threshold_75": bool(air["exceeds_75_0"]) if air["exceeds_75_0"] is not None else None,
        } if air else None,
        "verified_local_news_in_database": [
            {key: item.get(key) for key in ("event_date", "title", "source_name", "shock_type", "severity_score", "evidence_quote")}
            for item in recent_news
        ],
        "verified_local_news_window": {
            "from": news_cutoff,
            "through": news_through,
            "days": 120,
        },
        "interpretation_limits": [
            "current_weather_and_7_day_forecast is model-based current conditions and a forecast, not a local weather-station observation; state fetched_at and forecast dates. Historical monthly rainfall is not a forecast.",
            "Prefer current_air4thai_station_observations for current PM2.5 questions, state latest_observation_at and station_count. If unavailable, use the database daily observation with its date and call it the latest stored reading, not live.",
            "The threshold flags refer to the daily province mean PM2.5 being above 37.5 or 75.0 micrograms per cubic meter; report these only if asked.",
            "News is limited to screened province-linked database records from the stated 120-day window; do not claim the list is exhaustive or that no other event occurred.",
            "If a requested value is null or absent, say it is unavailable in this data snapshot.",
        ],
    }
    sources: list[dict[str, Any]] = []
    if air and not live_air:
        sources.append({
            "title": f"PM2.5 daily observation · {air['obs_date']}",
            "source_name": "Air quality data",
            "observed_at": str(air["obs_date"]),
        })
    if live_weather:
        sources.append({
            "title": f"Weather forecast · {live_weather['fetched_at']}",
            "source_name": "Open-Meteo",
            "observed_at": live_weather["fetched_at"],
            "source_url": "https://open-meteo.com/en/docs",
        })
    if live_air:
        sources.append({
            "title": f"Air4Thai PM2.5 observations · {live_air['latest_observation_at']}",
            "source_name": "Air4Thai · Pollution Control Department",
            "observed_at": live_air["latest_observation_at"],
            "source_url": "https://air4thai.pcd.go.th/",
        })
    if latest_month:
        sources.append({
            "title": f"Economic and historical weather panel · {latest_month['month_date']}",
            "source_name": "Province monthly panel",
            "observed_at": latest_month["month_date"],
        })
    if re.search(r"ข่าว|สารพิษ|มลพิษ|น้ำท่วม|pm\s*2\.5|ฝุ่น|news|toxin|pollution|flood|haze", question, re.I):
        sources.extend({
            "title": str(item["title"]),
            "source_name": str(item.get("source_name") or "Verified local news"),
            "observed_at": str(item["event_date"]),
            "source_url": str(item.get("source_url") or ""),
        } for item in recent_news)
    return json.dumps(context, ensure_ascii=False, default=str), sources


def _build_chat_regional_news_context(language: str, question: str) -> tuple[str, list[dict[str, Any]]]:
    """Return recent verified local news across the Northern 17, with source links."""
    water_pollution_only = bool(re.search(r"สารพิษ|สารหนู|arsenic|toxin", question, re.I))
    rows = fetch_all(
        """
        SELECT
            e.event_id, e.event_date, e.sector, e.shock_type, e.severity_score,
            e.evidence_quote, d.name_th, d.name_en, n.title, n.source_name, n.source_url
        FROM silver.news_events e
        JOIN silver.dim_provinces d ON e.province_code = d.province_code
        JOIN bronze.news_raw n ON e.news_id = n.id
        WHERE e.event_date >= CURRENT_DATE - INTERVAL '120 days'
          AND e.shock_type != 'policy_relief'
          AND (NOT :water_pollution_only OR e.shock_type = 'water_pollution')
        ORDER BY e.event_date DESC, e.severity_score DESC, e.event_id DESC
        LIMIT 40
        """,
        {"water_pollution_only": water_pollution_only},
    )
    news_rows = _dedupe_news_rows(rows, limit=12)
    items = [
        {
            "date": str(row["event_date"]),
            "province": str(row["name_th"] if language == "th" else row["name_en"]),
            "title": str(row["title"]),
            "event_type": str(row["shock_type"]),
            "severity_1_to_5": int(row["severity_score"]),
            "verified_evidence_excerpt": str(row["evidence_quote"]),
            "source_name": str(row["source_name"] or ""),
        }
        for row in news_rows
    ]
    context = {
        "scope": "Northern Thailand 17 provinces",
        "coverage_window_days": 120,
        "filter": "water_pollution events only" if water_pollution_only else "all verified non-policy-relief local news event types",
        "verified_local_news_events": items,
        "limits": [
            "These are only verified events stored in the project database; the list is not an exhaustive live news search.",
            "If no matching event appears, say no matching verified event was found in this database window; do not claim that no incident occurred.",
            "Never infer toxic exposure or health impact beyond the verified evidence excerpt.",
        ],
    }
    sources = [
        {
            "title": str(row["title"]),
            "source_name": str(row["source_name"] or "Verified local news"),
            "observed_at": str(row["event_date"]),
            "source_url": str(row["source_url"] or ""),
        }
        for row in news_rows
    ]
    return json.dumps(context, ensure_ascii=False, default=str), sources


def _build_chat_regional_context(language: str, question: str) -> tuple[str, list[dict[str, Any]]]:
    """Build a Northern 17 overview from dated panel values and requested live data."""
    wants_weather = bool(re.search(r"ฝน|อากาศ|พยากรณ์|rain|weather|forecast", question, re.I))
    wants_air = bool(re.search(r"ฝุ่น|pm\s*2\.5|คุณภาพอากาศ|air quality|haze", question, re.I))
    wants_economy = bool(re.search(r"เศรษฐกิจ|รายได้|ท่องเที่ยว|เข้าพัก|economic|revenue|tourism|occupancy", question, re.I))
    wants_news = bool(re.search(r"ข่าว|สารพิษ|สารหนู|มลพิษ|น้ำท่วม|เหตุการณ์|news|toxin|arsenic|pollution|flood|incident", question, re.I))
    context: dict[str, Any] = {"scope": "ภาพรวม 17 จังหวัดภาคเหนือ", "province_count": 17}
    sources: list[dict[str, Any]] = []

    if wants_economy or re.search(r"เดือนล่าสุด|เดือนที่แล้ว|ย้อนหลัง|monthly rainfall|last month", question, re.I):
        outlook = get_risk_outlook(months=3)
        latest_series = outlook.get("regional_timeseries") or []
        latest_month = latest_series[-1].get("month_date") if latest_series else None
        context["latest_regional_economic_summary"] = outlook.get("regional_summary")
        context["latest_regional_month"] = latest_month
        context["province_coverage"] = len(outlook.get("provinces") or [])
        sources.append({
            "title": f"Northern province panel · {latest_month or 'latest month'}",
            "source_name": "Project regional monthly database",
            "observed_at": str(latest_month or ""),
        })
        rainfall_rows = fetch_all(
            """
            WITH latest AS (SELECT MAX(month_date) AS month_date FROM gold.province_monthly_panel)
            SELECT p.month_date, p.province_code, d.name_th, d.name_en,
                   NULLIF(p.selected_features->>'rainfall_sum_mm', '')::DOUBLE PRECISION AS rainfall_sum_mm
            FROM gold.province_monthly_panel p
            JOIN latest l ON p.month_date = l.month_date
            JOIN silver.dim_provinces d ON d.province_code = p.province_code
            ORDER BY p.province_code
            """
        )
        rain_values = [float(row["rainfall_sum_mm"]) for row in rainfall_rows if row["rainfall_sum_mm"] is not None]
        context["latest_observed_monthly_rainfall"] = {
            "month": str(rainfall_rows[0]["month_date"]) if rainfall_rows else None,
            "province_values_mm": [
                {"province": row["name_th"] if language == "th" else row["name_en"], "rainfall_mm": row["rainfall_sum_mm"]}
                for row in rainfall_rows if row["rainfall_sum_mm"] is not None
            ],
            "mean_of_available_province_totals_mm": round(sum(rain_values) / len(rain_values), 1) if rain_values else None,
            "coverage_provinces": len(rain_values),
            "note": "Average of available province monthly accumulated rainfall values, not an area-weighted regional total.",
        }

    if wants_weather:
        metadata = get_province_metadata()
        forecast_rows = []
        from concurrent.futures import ThreadPoolExecutor, as_completed

        with ThreadPoolExecutor(max_workers=6) as pool:
            futures = {
                pool.submit(_fetch_live_weather_forecast, {"province_code": code, **meta}): code
                for code, meta in metadata.items()
            }
            for future in as_completed(futures):
                code = futures[future]
                try:
                    value = future.result()
                    if value:
                        forecast_rows.append({"province_code": code, **value})
                except Exception:
                    continue
        context["live_weather_forecasts_by_province"] = forecast_rows
        context["weather_forecast_coverage_provinces"] = len(forecast_rows)
        if forecast_rows:
            days = forecast_rows[0].get("daily_forecast") or []
            context["regional_daily_rain_summary"] = [
                {
                    "date": day.get("date"),
                    "mean_precipitation_mm_per_available_province": round(sum(
                        float(row["daily_forecast"][idx]["precipitation_sum_mm"])
                        for row in forecast_rows
                        if len(row.get("daily_forecast") or []) > idx and row["daily_forecast"][idx].get("precipitation_sum_mm") is not None
                    ) / max(1, sum(
                        1 for row in forecast_rows
                        if len(row.get("daily_forecast") or []) > idx and row["daily_forecast"][idx].get("precipitation_sum_mm") is not None
                    )), 1),
                    "max_precipitation_probability_pct": max((
                        int(row["daily_forecast"][idx]["precipitation_probability_max_pct"])
                        for row in forecast_rows
                        if len(row.get("daily_forecast") or []) > idx and row["daily_forecast"][idx].get("precipitation_probability_max_pct") is not None
                    ), default=None),
                }
                for idx, day in enumerate(days)
            ]
            fetched_at = max(row["fetched_at"] for row in forecast_rows)
            sources.append({
                "title": f"Weather forecast · {fetched_at}",
                "source_name": "Open-Meteo",
                "observed_at": fetched_at,
                "source_url": "https://open-meteo.com/en/docs",
            })

    if wants_air:
        air_rows, _ = fetch_northern_air4thai()
        now = datetime.now(ICT_TZ)
        valid_air = []
        for row in air_rows:
            recorded_at = row.get("recorded_at")
            pm25 = row.get("pm25_raw")
            if not isinstance(recorded_at, datetime) or pm25 is None:
                continue
            if recorded_at.tzinfo is None:
                recorded_at = recorded_at.replace(tzinfo=ICT_TZ)
            age_hours = (now - recorded_at.astimezone(ICT_TZ)).total_seconds() / 3600
            if 0 <= age_hours <= 6:
                valid_air.append({
                    "province_code": resolve_northern_province(row.get("province_raw")),
                    "station_id": row["station_id"],
                    "pm25_ug_m3": float(pm25),
                    "observed_at": recorded_at.astimezone(ICT_TZ).isoformat(timespec="minutes"),
                })
        valid_air = [row for row in valid_air if row["province_code"]]
        air_by_province: dict[str, list[dict[str, Any]]] = {}
        for row in valid_air:
            air_by_province.setdefault(row["province_code"], []).append(row)
        metadata = get_province_metadata()
        context["live_air_quality_overview"] = {
            "source": "Air4Thai · Pollution Control Department",
            "latest_observation_at": max((row["observed_at"] for row in valid_air), default=None),
            "station_count": len(valid_air),
            "province_coverage": len(air_by_province),
            "mean_of_current_station_pm25_ug_m3": round(sum(row["pm25_ug_m3"] for row in valid_air) / len(valid_air), 1) if valid_air else None,
            "highest_readings_by_province": [
                {
                    "province": metadata[code]["name_th" if language == "th" else "name_en"],
                    "station_count": len(rows),
                    "mean_pm25_ug_m3": round(sum(row["pm25_ug_m3"] for row in rows) / len(rows), 1),
                    "max_station_pm25_ug_m3": round(max(row["pm25_ug_m3"] for row in rows), 1),
                }
                for code, rows in sorted(air_by_province.items(), key=lambda item: max(r["pm25_ug_m3"] for r in item[1]), reverse=True)
            ],
        }
        if valid_air:
            air_time = context["live_air_quality_overview"]["latest_observation_at"]
            sources.append({
                "title": f"Air4Thai observations · {air_time}",
                "source_name": "Air4Thai · Pollution Control Department",
                "observed_at": air_time,
                "source_url": "https://air4thai.pcd.go.th/",
            })

    if wants_news:
        news_json, news_sources = _build_chat_regional_news_context(language, question)
        context.update(json.loads(news_json))
        sources.extend(news_sources)

    context["interpretation_limits"] = [
        "Do not treat the mean across province rainfall forecasts as an area-weighted total.",
        "Weather is model-based, not a local station observation; state forecast dates and coverage.",
        "PM2.5 live station data are limited to readings no older than six hours; report station/province coverage and observation time.",
        "News includes only verified events stored in the project database; it is not an exhaustive live search.",
        "For missing or null metrics, state that data are unavailable rather than substituting document text.",
    ]
    return json.dumps(context, ensure_ascii=False, default=str), sources


def _fetch_live_weather_forecast(province: dict[str, Any]) -> dict[str, Any] | None:
    """Fetch and briefly cache current conditions plus a seven-day provincial forecast."""
    code = str(province["province_code"])
    cache_key = f"chat_weather_forecast_{code}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return None if cached.get("unavailable") else cached
    labels = {
        0: "ท้องฟ้าแจ่มใส", 1: "ท้องฟ้าโปร่งเป็นส่วนใหญ่", 2: "มีเมฆบางส่วน", 3: "มีเมฆมาก",
        45: "หมอก", 48: "หมอกเกาะน้ำแข็ง", 51: "ฝนละอองเล็กน้อย", 53: "ฝนละอองปานกลาง",
        55: "ฝนละอองหนาแน่น", 56: "ฝนละอองเยือกแข็งเล็กน้อย", 57: "ฝนละอองเยือกแข็งหนาแน่น",
        61: "ฝนเล็กน้อย", 63: "ฝนปานกลาง", 65: "ฝนตกหนัก", 66: "ฝนเยือกแข็งเล็กน้อย",
        67: "ฝนเยือกแข็งหนัก", 71: "หิมะตกเล็กน้อย", 73: "หิมะตกปานกลาง", 75: "หิมะตกหนัก",
        77: "เกล็ดหิมะ", 80: "ฝนซู่เล็กน้อย", 81: "ฝนซู่ปานกลาง", 82: "ฝนซู่หนัก",
        85: "หิมะซู่เล็กน้อย", 86: "หิมะซู่หนัก", 95: "พายุฝนฟ้าคะนอง", 96: "พายุฝนฟ้าคะนองและลูกเห็บเล็กน้อย",
        99: "พายุฝนฟ้าคะนองและลูกเห็บหนัก",
    }
    try:
        response = httpx.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": province["lat"],
                "longitude": province["lon"],
                "timezone": "Asia/Bangkok",
                "forecast_days": 7,
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,wind_speed_10m",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
            },
            timeout=8.0,
        )
        response.raise_for_status()
        payload = response.json()
        current = payload.get("current") or {}
        daily = payload.get("daily") or {}
        daily_rows = []
        for idx, forecast_date in enumerate(daily.get("time") or []):
            code_num = (daily.get("weather_code") or [None] * 7)[idx]
            daily_rows.append({
                "date": forecast_date,
                "weather": labels.get(int(code_num), "ไม่ทราบสภาพอากาศ") if code_num is not None else None,
                "temperature_min_c": (daily.get("temperature_2m_min") or [None] * 7)[idx],
                "temperature_max_c": (daily.get("temperature_2m_max") or [None] * 7)[idx],
                "precipitation_probability_max_pct": (daily.get("precipitation_probability_max") or [None] * 7)[idx],
                "precipitation_sum_mm": (daily.get("precipitation_sum") or [None] * 7)[idx],
            })
        current_code = current.get("weather_code")
        result = {
            "fetched_at": datetime.now(ICT_TZ).isoformat(timespec="minutes"),
            "timezone": payload.get("timezone", "Asia/Bangkok"),
            "current": {
                "valid_at": current.get("time"),
                "weather": labels.get(int(current_code), "ไม่ทราบสภาพอากาศ") if current_code is not None else None,
                "temperature_c": current.get("temperature_2m"),
                "feels_like_c": current.get("apparent_temperature"),
                "relative_humidity_pct": current.get("relative_humidity_2m"),
                "precipitation_mm": current.get("precipitation"),
                "rain_mm": current.get("rain"),
                "wind_speed_kmh": current.get("wind_speed_10m"),
            },
            "daily_forecast": daily_rows,
        }
        _cache_set(cache_key, result, ttl=600.0)
        return result
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        _cache_set(cache_key, {"unavailable": True}, ttl=60.0)
        return None


def _fetch_live_air4thai_province(province_code: str) -> dict[str, Any] | None:
    """Read current validated station snapshots from Air4Thai and cache briefly per province."""
    cache_key = f"chat_air4thai_{province_code}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return None if cached.get("unavailable") else cached
    try:
        station_rows, _ = fetch_northern_air4thai()
        now = datetime.now(ICT_TZ)
        valid = []
        for row in station_rows:
            if resolve_northern_province(row.get("province_raw")) != province_code:
                continue
            recorded_at = row.get("recorded_at")
            if not isinstance(recorded_at, datetime):
                continue
            if recorded_at.tzinfo is None:
                recorded_at = recorded_at.replace(tzinfo=ICT_TZ)
            age_hours = (now - recorded_at.astimezone(ICT_TZ)).total_seconds() / 3600
            pm25 = row.get("pm25_raw")
            if 0 <= age_hours <= 6 and pm25 is not None:
                valid.append({
                    "station_id": row["station_id"],
                    "pm25_ug_m3": float(pm25),
                    "observed_at": recorded_at.astimezone(ICT_TZ).isoformat(timespec="minutes"),
                })
        if not valid:
            _cache_set(cache_key, {"unavailable": True}, ttl=60.0)
            return None
        latest_time = max(row["observed_at"] for row in valid)
        result = {
            "latest_observation_at": latest_time,
            "station_count": len(valid),
            "province_mean_pm25_ug_m3": round(sum(row["pm25_ug_m3"] for row in valid) / len(valid), 1),
            "highest_station_pm25_ug_m3": round(max(row["pm25_ug_m3"] for row in valid), 1),
            "stations": valid[:20],
        }
        _cache_set(cache_key, result, ttl=120.0)
        return result
    except Exception:
        _cache_set(cache_key, {"unavailable": True}, ttl=60.0)
        return None


_PAGE_NUM_LINE_RE = re.compile(r"^[-–—\s]*(?:\d{1,3}|\d{1,2}\s*/\s*\d{1,2})[-–—\s]*$")
_MAJOR_HEADING_RE = re.compile(
    r"^(?:\d+(?:\.\d+)+(?:\s|$)|\d+\.\s+\S|เอกสารแนบ\s*\d+|หมวด\s+|ส่วนที่\s+|ข้อ\s+\d+)"
)
_ITEM_NUM_HEADING_RE = re.compile(r"^\(\d+\)\s+\S")
_SUBHEADING_PHRASE_RE = re.compile(
    r"^(?:หลักเกณฑ์|สรุปสาระสำคัญและผลลัพธ์ที่คาดหวัง|ตัวอย่าง[^\n]{0,80}|หมายเหตุ)$"
)
_BULLET_RE = re.compile(r"^[-•▪➢o]\s+")
_STRONG_BODY_STARTER_RE = re.compile(
    r"^(?:ผู้ให้บริการ(?:ต้อง|จะ|ควร|อาจ|สามารถ)|ลูกค้า(?:ต้อง|จะ)|สถาบันการเงิน(?:ต้อง|จะ|ควร)|ธนาคาร(?:ต้อง|จะ|ควร)|ทั้งนี้\s|นอกจากนี้\s|อย่างไรก็ตาม\s|แนวทางการให้ความช่วยเหลือ|เพื่อ(?:ส่งเสริม|ให้|ปรับ))"
)
_CLAUSE_SPACE_STARTER_RE = re.compile(
    r"^(?:ผู้ให้บริการ|ธนาคาร|สถาบันการเงิน|ทั้งนี้|นอกจากนี้|อย่างไรก็ตาม)"
)
_SENTENCE_BREAK_PREFIXES: tuple[str, ...] = ("ทั้งนี้ ", "นอกจากนี้ ", "อย่างไรก็ตาม ")


def _dedupe_chunk_overlap(prev_text: str, next_text: str) -> str:
    """Strip overlapping leading substring produced by sliding chunk windows."""
    if not prev_text or not next_text:
        return next_text
    max_probe = min(len(prev_text), len(next_text), 220)
    for size in range(max_probe, 24, -1):
        if prev_text.endswith(next_text[:size]):
            return next_text[size:].lstrip()
    return next_text


def _clean_policy_page_text(raw: str) -> str:
    """Reflow PDF table rows, strip page headers, and keep headings paired cleanly with body text."""
    from src.extract.bot_pdf_loader import normalize_thai_pdf_text

    text = normalize_thai_pdf_text(raw)
    raw_lines = [ln.strip() for ln in text.split("\n")]

    # Drop standalone page number and annex subpage lines at top or bottom
    while raw_lines and (not raw_lines[0] or _PAGE_NUM_LINE_RE.match(raw_lines[0])):
        raw_lines.pop(0)
    while raw_lines and (not raw_lines[-1] or _PAGE_NUM_LINE_RE.match(raw_lines[-1])):
        raw_lines.pop()

    blocks: list[str] = []
    curr = ""
    curr_kind = "body"
    pending_heading = ""

    def flush() -> None:
        nonlocal curr, curr_kind, pending_heading
        if pending_heading and curr.strip():
            blocks.append(f"{pending_heading}\n{curr.strip()}")
        elif pending_heading:
            blocks.append(pending_heading)
        elif curr.strip():
            blocks.append(curr.strip())
        curr = ""
        curr_kind = "body"
        pending_heading = ""

    def join_line(base: str, nxt: str) -> str:
        if not base:
            return nxt
        is_thai_pair = "\u0e00" <= base[-1] <= "\u0e7f" and "\u0e00" <= nxt[0] <= "\u0e7f"
        if base.endswith((")", "”", '"')) or not is_thai_pair or _CLAUSE_SPACE_STARTER_RE.match(nxt):
            return f"{base} {nxt}"
        return f"{base}{nxt}"

    idx = 0
    while idx < len(raw_lines):
        ln = raw_lines[idx]
        if not ln:
            if curr_kind == "item_head" and curr.strip():
                pending_heading = curr.strip()
                curr = ""
                curr_kind = "body"
            else:
                flush()
            idx += 1
            continue

        if ln == "หลักเกณฑ์" and idx + 1 < len(raw_lines) and raw_lines[idx + 1].startswith("สรุปสาระสำคัญ"):
            flush()
            blocks.append(f"{ln} · {raw_lines[idx + 1]}")
            idx += 2
            continue

        if _BULLET_RE.match(ln):
            flush()
            curr = ln
            curr_kind = "bullet"
            idx += 1
            continue

        if _SUBHEADING_PHRASE_RE.match(ln):
            flush()
            if ln.startswith("ตัวอย่าง"):
                blocks.append(ln)
            else:
                curr = ln
                curr_kind = "subhead"
            idx += 1
            continue

        if _ITEM_NUM_HEADING_RE.match(ln):
            item_body = re.sub(r"^\(\d+\)\s+", "", ln)
            # Treat inline multi item enumerations and full sentence clauses as body text
            if _STRONG_BODY_STARTER_RE.match(item_body) or re.search(r"\(\d+\)", item_body):
                if curr_kind != "body":
                    flush()
                    curr = ln
                    curr_kind = "body"
                else:
                    curr = join_line(curr, ln)
            else:
                flush()
                curr = ln
                curr_kind = "item_head"
            idx += 1
            continue

        if _MAJOR_HEADING_RE.match(ln):
            flush()
            clause_body = re.sub(r"^(?:\d+(?:\.\d+)*|เอกสารแนบ\s*\d+)\s*", "", ln)
            if ln.startswith("เอกสารแนบ"):
                curr = ln
                curr_kind = "annex_sub"
            elif clause_body and not _STRONG_BODY_STARTER_RE.match(clause_body) and len(ln) <= 72:
                curr = ln
                curr_kind = "major"
            else:
                curr = ln
                curr_kind = "body"
            idx += 1
            continue

        if curr_kind == "annex_sub":
            if _STRONG_BODY_STARTER_RE.match(ln):
                pending_heading = curr.strip()
                curr = ln
                curr_kind = "body"
            else:
                curr = join_line(curr, ln)
            idx += 1
            continue

        if curr_kind == "item_head":
            if _STRONG_BODY_STARTER_RE.match(ln) or len(ln) >= 34:
                pending_heading = curr.strip()
                curr = ln
                curr_kind = "body"
            else:
                curr = join_line(curr, ln)
            idx += 1
            continue

        if curr_kind == "major":
            if _STRONG_BODY_STARTER_RE.match(ln) or len(ln) >= 42:
                pending_heading = curr.strip()
                curr = ln
                curr_kind = "body"
            else:
                curr = join_line(curr, ln)
            idx += 1
            continue

        if curr and ln.startswith(_SENTENCE_BREAK_PREFIXES) and len(curr) > 80:
            flush()
            curr = ln
            curr_kind = "body"
            idx += 1
            continue

        curr = join_line(curr, ln)
        idx += 1

    flush()
    return "\n\n".join(p for p in blocks if p)


def _get_doc_indexed_pages(doc_title: str, source_table: str) -> list[int]:
    """Return sorted indexed page numbers for a document with short TTL caching."""
    cache_key = f"doc_pages_{source_table}_{doc_title}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    table_name = "bronze.bot_docs_raw" if source_table == "bronze" else "silver.policy_chunks"
    active_clause = (
        " AND is_active = TRUE"
        " AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)"
        " AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)"
        if source_table == "silver"
        else ""
    )
    rows = fetch_all(
        f"SELECT DISTINCT page_num FROM {table_name} WHERE doc_title = :title{active_clause} ORDER BY page_num ASC",
        {"title": doc_title},
    )
    pages = sorted({int(r["page_num"]) for r in rows if r.get("page_num") is not None})
    _cache_set(cache_key, pages, ttl=600.0)
    return pages


@app.get("/api/policy-page")
def get_policy_page(
    doc_title: str = Query(..., min_length=2),
    page_num: int = Query(..., ge=1, le=500),
) -> dict[str, Any]:
    """Return full intact page text with neighboring page pointers for multi page reading."""
    clean_title = doc_title.strip()
    cache_key = f"policy_page_v3_{clean_title}_{page_num}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    bronze_rows = fetch_all(
        """
        SELECT
            doc_title,
            doc_url,
            page_num,
            raw_text
        FROM bronze.bot_docs_raw
        WHERE is_active = TRUE
          AND doc_title = :title AND page_num = :pnum
        ORDER BY id DESC
        LIMIT 1
        """,
        {"title": clean_title, "pnum": int(page_num)},
    )

    if bronze_rows:
        r0 = bronze_rows[0]
        indexed_pages = _get_doc_indexed_pages(clean_title, "bronze")
        cur_page = int(r0["page_num"])
        prev_page = max((p for p in indexed_pages if p < cur_page), default=None)
        next_page = min((p for p in indexed_pages if p > cur_page), default=None)
        cleaned_full = _clean_policy_page_text(str(r0.get("raw_text") or ""))
        paragraphs = [p.strip() for p in cleaned_full.split("\n\n") if p.strip()]
        payload = {
            "doc_title": str(r0["doc_title"]),
            "doc_url": str(r0.get("doc_url") or ""),
            "page_num": cur_page,
            "total_pages": len(indexed_pages) or 1,
            "prev_page": prev_page,
            "next_page": next_page,
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
            chunk_text
        FROM silver.policy_chunks
        WHERE is_active = TRUE
          AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
          AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
          AND doc_title = :title AND page_num = :pnum
        ORDER BY chunk_id ASC
        """,
        {"title": clean_title, "pnum": int(page_num)},
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Official document page not found")

    indexed_pages = _get_doc_indexed_pages(clean_title, "silver")
    cur_page = int(rows[0]["page_num"])
    prev_page = max((p for p in indexed_pages if p < cur_page), default=None)
    next_page = min((p for p in indexed_pages if p > cur_page), default=None)

    paragraphs: list[str] = []
    prev_raw = ""
    for r in rows:
        txt = _clean_policy_page_text(str(r.get("chunk_text") or ""))
        deduped = _dedupe_chunk_overlap(prev_raw, txt)
        if deduped and deduped not in paragraphs:
            paragraphs.append(deduped)
        prev_raw = txt

    payload = {
        "doc_title": str(rows[0]["doc_title"]),
        "doc_url": str(rows[0].get("doc_url") or ""),
        "page_num": cur_page,
        "total_pages": len(indexed_pages) or 1,
        "prev_page": prev_page,
        "next_page": next_page,
        "chunks": paragraphs,
        "full_text": "\n\n".join(paragraphs),
    }
    _cache_set(cache_key, payload, ttl=600.0)
    return payload


# Authenticated staff routes requiring bearer token

@app.get("/api/policy-monitor")
def get_policy_monitor(
    fresh: bool = Query(default=False),
    staff: dict[str, Any] = Depends(require_staff_permission("view_overview")),
) -> dict[str, Any]:
    """Serve staff policy monitor with 4 quadrant clustering, screening stats, news, and anonymized demand."""
    t0 = time.perf_counter()
    if not fresh:
        cached = _cache_get("policy_monitor")
        if cached is not None:
            return {
                **cached,
                "authenticated_staff": staff["sub"],
                "staff_role": staff.get("role"),
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
        latest_panel AS (
            SELECT
                p.province_code,
                (p.target_metrics->>'occupancy_rate')::double precision AS latest_occupancy_rate,
                (p.target_metrics->>'occupancy_yoy_diff')::double precision AS latest_occupancy_yoy_diff,
                p.composite_shock_idx AS latest_shock_idx
            FROM gold.province_monthly_panel p
            CROSS JOIN panel_span ps
            WHERE p.month_date = ps.max_month
        ),
        latest_air AS (
            SELECT DISTINCT ON (province_code)
                province_code,
                pm25_mean AS live_pm25_mean
            FROM silver.air_daily
            ORDER BY province_code, obs_date DESC
        ),
        quad_cte AS (
            SELECT
                d.province_code, d.name_th, d.name_en, d.subregion,
                c.model_used, c.cluster_id, c.cluster_label,
                c.shock_intensity, c.exposure_score, c.silhouette_score, c.recommended_policy,
                r.avg_monthly_revenue_mthb, r.avg_occupancy_rate,
                lp.latest_occupancy_rate, lp.latest_occupancy_yoy_diff, lp.latest_shock_idx,
                a.live_pm25_mean,
                ps.panel_months, ps.min_month, ps.max_month
            FROM silver.dim_provinces d
            JOIN gold.province_clusters c ON d.province_code = c.province_code
            LEFT JOIN avg_rev r ON d.province_code = r.province_code
            LEFT JOIN latest_panel lp ON d.province_code = lp.province_code
            LEFT JOIN latest_air a ON d.province_code = a.province_code
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

    # Load recent verified high severity news alerts using the exact 120 day filter shared with public map
    recent_alert_rows = fetch_all(
        """
        SELECT province_code, shock_type, severity_score, event_date
        FROM silver.news_events
        WHERE event_date >= CURRENT_DATE - INTERVAL '120 days'
          AND shock_type != 'policy_relief'
          AND severity_score >= 3
        ORDER BY event_date DESC, severity_score DESC
        """
    )
    alerts_by_prov: dict[str, list[dict[str, Any]]] = {}
    for a in recent_alert_rows:
        alerts_by_prov.setdefault(str(a["province_code"]), []).append(dict(a))

    quadrant_points: list[dict[str, Any]] = []
    for q in quad_rows:
        code = str(q["province_code"])
        nso = nso_map.get(code, {})
        latest_occ = float(q["latest_occupancy_rate"]) if q.get("latest_occupancy_rate") is not None else None
        avg_occ = (
            float(q["avg_occupancy_rate"])
            if q.get("avg_occupancy_rate") is not None
            else None
        )
        item = {
            "province_code": code,
            "name_th": str(q["name_th"]),
            "name_en": str(q["name_en"]),
            "subregion": str(q["subregion"]),
            "cluster_id": int(q["cluster_id"]),
            "cluster_label": str(q["cluster_label"]),
            "shock_intensity": float(q["shock_intensity"]),
            "exposure_score": float(q["exposure_score"]),
            "avg_monthly_revenue_mthb": float(q.get("avg_monthly_revenue_mthb") or 0.0),
            "avg_occupancy_rate": avg_occ,
            "latest_occupancy_rate": round(latest_occ, 1) if latest_occ is not None else None,
            "occupancy_rate": round(latest_occ, 1) if latest_occ is not None else None,
            "latest_shock_idx": float(q["latest_shock_idx"]) if q.get("latest_shock_idx") is not None else None,
            "live_pm25_mean": float(q["live_pm25_mean"]) if q.get("live_pm25_mean") is not None else None,
            "debt_to_annual_income_all": nso.get("debt_to_annual_income_all"),
            "debt_to_annual_income_sme": nso.get("debt_to_annual_income_sme"),
            "expense_to_income_pct_sme": nso.get("expense_to_income_pct_sme"),
            "recommended_policy": str(q["recommended_policy"]),
        }
        v_eval = evaluate_province_vulnerability(item, alerts_by_prov.get(code, []))
        item["vulnerability_score"] = v_eval["vulnerability_score"]
        item["priority_score"] = v_eval["vulnerability_score"]
        item["vulnerability_tier"] = v_eval["vulnerability_tier"]
        item["tier_code"] = v_eval["tier_code"]
        item["tier_short_th"] = v_eval["tier_short_th"]
        item["tier_short_en"] = v_eval["tier_short_en"]
        item["tier_color"] = v_eval["tier_color"]
        item["insufficient_data"] = v_eval["insufficient_data"]
        quadrant_points.append(item)

    # Assign unified priority_rank strictly matching public map vulnerability_tiering ordering
    rank_order = sorted(
        quadrant_points,
        key=lambda p: (
            bool(p.get("insufficient_data")),
            int(p.get("vulnerability_tier") or 4),
            -float(p.get("vulnerability_score") or 0.0),
        ),
    )
    rank_lookup = {p["province_code"]: idx + 1 for idx, p in enumerate(rank_order)}
    for p in quadrant_points:
        p["priority_rank"] = rank_lookup[p["province_code"]]

    panel_months = int(quad_rows[0]["panel_months"]) if quad_rows and quad_rows[0].get("panel_months") else 0
    panel_start = str(quad_rows[0]["min_month"]) if quad_rows and quad_rows[0].get("min_month") else ""
    panel_end = str(quad_rows[0]["max_month"]) if quad_rows and quad_rows[0].get("max_month") else ""

    dq_row = fetch_all(
        """
        SELECT
            (SELECT metrics_json->>'status' FROM gold.pipeline_eval_runs WHERE run_type = 'layer2_data_quality' ORDER BY ran_at DESC LIMIT 1) AS latest_dq_status,
            (SELECT ran_at FROM gold.pipeline_eval_runs WHERE run_type = 'layer2_data_quality' ORDER BY ran_at DESC LIMIT 1) AS latest_dq_checked_at,
            (SELECT max(obs_date) FROM silver.air_daily) AS air_latest_date,
            (SELECT max(event_date) FROM silver.news_events) AS news_latest_date,
            (SELECT count(*) FROM silver.quarantine) AS quarantine_rows
        """
    )[0]

    payload = {
        "authenticated_staff": staff["sub"],
        "staff_role": staff.get("role"),
        "model_used": str(quad_rows[0]["model_used"]) if quad_rows else None,
        "silhouette_score": float(quad_rows[0]["silhouette_score"]) if quad_rows and quad_rows[0]["silhouette_score"] is not None else None,
        "panel_months": panel_months,
        "panel_start_month": panel_start,
        "panel_end_month": panel_end,
        "data_quality_summary": {
            "latest_dq_status": str(dq_row["latest_dq_status"]) if dq_row.get("latest_dq_status") else None,
            "latest_dq_checked_at": dq_row["latest_dq_checked_at"].isoformat() if dq_row.get("latest_dq_checked_at") else None,
            "air_latest_date": str(dq_row["air_latest_date"]) if dq_row.get("air_latest_date") else None,
            "news_latest_date": str(dq_row["news_latest_date"]) if dq_row.get("news_latest_date") else None,
            "quarantine_rows": int(dq_row.get("quarantine_rows") or 0),
        },
        "quadrant_provinces": quadrant_points,
        "feature_screening": screening_rows,
        "public_demand_signals": {
            "total_checks": sum(int(r["query_count"]) for r in demand_by_prov),
            "counting_unit": "simulation_requests_not_unique_individuals",
            "methodology_note_th": "ตัวเลขแสดงจำนวนคำขอจำลองในระบบเท่านั้น ไม่ใช่จำนวนผู้ใช้งานที่ไม่ซ้ำหรือตัวแทนความต้องการเชิงประชากร",
            "methodology_note_en": "Counts represent total anonymous simulation requests submitted, not unique individuals or population prevalence.",
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
    staff: dict[str, Any] = Depends(require_staff_permission("view_health")),
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
                (SELECT count(*) FROM silver.policy_chunks WHERE is_active = TRUE
                    AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
                    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)) AS silver_policy_chunks,
                (SELECT count(DISTINCT doc_id) FROM silver.policy_chunks WHERE is_active = TRUE
                    AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
                    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)) AS silver_policy_docs,
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
        eval_history_cte AS (
            SELECT run_type, metrics_json, token_count, estimated_cost_thb, ran_at
            FROM (
                SELECT
                    run_type,
                    CASE
                        WHEN metrics_json ? 'all_24_benchmarks' THEN metrics_json - 'all_24_benchmarks'
                        ELSE metrics_json
                    END AS metrics_json,
                    token_count,
                    estimated_cost_thb,
                    ran_at,
                    ROW_NUMBER() OVER (PARTITION BY run_type ORDER BY ran_at DESC) AS rn
                FROM gold.pipeline_eval_runs
            ) ranked
            WHERE rn <= 6
            ORDER BY run_type, ran_at DESC
        ),
        docs_cte AS (
            SELECT doc_id, doc_title, doc_url, count(*) AS chunk_count, count(DISTINCT page_num) AS page_count
            FROM silver.policy_chunks
            WHERE is_active = TRUE
              AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
              AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
            GROUP BY doc_id, doc_title, doc_url
            ORDER BY doc_title
        )
        SELECT
            (SELECT row_to_json(c) FROM counts_cte c) AS counts_json,
            coalesce((SELECT json_agg(row_to_json(q)) FROM q_cte q), '[]'::json) AS quarantine_json,
            coalesce((SELECT json_agg(row_to_json(e)) FROM eval_cte e), '[]'::json) AS evals_json,
            coalesce((SELECT json_agg(row_to_json(eh)) FROM eval_history_cte eh), '[]'::json) AS eval_history_json,
            coalesce((SELECT json_agg(row_to_json(d)) FROM docs_cte d), '[]'::json) AS docs_json
        """
    )[0]

    counts = consolidated["counts_json"] or {}
    quarantine_breakdown = consolidated["quarantine_json"] or []
    latest_evals = consolidated["evals_json"] or []
    eval_history = consolidated["eval_history_json"] or []
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

    layered_evaluation = build_layered_evaluation_summary(eval_history)
    rag_index_version = get_rag_index_version()

    payload = {
        "authenticated_staff": staff["sub"],
        "rag_index_version": rag_index_version,
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
                "doc_id": str(d["doc_id"] or ""),
                "doc_url": str(d.get("doc_url") or ""),
                "page_count": int(d["page_count"]),
                "chunk_count": int(d["chunk_count"]),
            }
            for d in indexed_docs
        ],
        "latest_eval_runs": trimmed_evals,
        "layered_evaluation": layered_evaluation,
        "cluster_run_diff": compute_cluster_run_diff(),
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
    staff: dict[str, Any] = Depends(require_staff_permission("export_brief")),
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
    staff: dict[str, Any] = Depends(require_staff_permission("trigger_refresh")),
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
    staff: dict[str, Any] = Depends(require_staff_permission("run_modeling")),
) -> dict[str, Any]:
    """Execute dynamic KMeans clustering with live VIF check and targeted policy prescriptions."""
    if payload.persist and not _staff_has_permission(staff, "publish_clusters"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Publishing clusters to the primary production map requires data_steward or admin role.",
        )
    res = run_interactive_clustering(
        k=payload.k,
        feature_keys=payload.feature_keys,
        persist=payload.persist,
    )
    if payload.persist:
        _invalidate_read_cache()
    res["triggered_by"] = staff["sub"]
    res["triggered_role"] = staff.get("role")
    return res


@app.post("/api/staff/monte-carlo")
def staff_monte_carlo(
    payload: StaffMonteCarloRequest,
    staff: dict[str, Any] = Depends(require_staff_permission("run_modeling")),
) -> dict[str, Any]:
    """Execute Empirical Bootstrap Monte Carlo cashflow stress test."""
    res = run_empirical_monte_carlo(
        horizon_months=payload.horizon_months,
        cost_shock_pct=payload.cost_shock_pct,
        include_news_regime=payload.include_news_regime,
        n_simulations=payload.n_simulations,
    )
    res["triggered_by"] = staff["sub"]
    res["triggered_role"] = staff.get("role")
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
