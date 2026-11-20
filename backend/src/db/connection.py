"""Pure Python Neon PostgreSQL connection helper, schema setup, and multi row batch operations."""

from __future__ import annotations

import os
import queue
import re
import ssl
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator, Sequence
from urllib.parse import parse_qs, unquote, urlparse

import pg8000.dbapi as pg_dbapi
import yaml
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")

# Precompiled regex matching named bind parameters while ignoring PostgreSQL type casts
_NAMED_PARAM_RE = re.compile(r"(?<!:):([A-Za-z_][A-Za-z0-9_]*)")
_VALUES_RE = re.compile(r"\bVALUES\s*\(", re.IGNORECASE)
_CONN_POOL: queue.LifoQueue[Any] = queue.LifoQueue(maxsize=8)


@lru_cache(maxsize=1)
def _parse_database_url() -> dict[str, Any]:
    """Parse DATABASE_URL into pg8000 connection arguments with SSL enabled for Neon."""
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy backend/.env.example to backend/.env "
            "and paste your Neon pooled connection string."
        )

    parsed = urlparse(db_url)
    query = parse_qs(parsed.query)
    sslmode = (query.get("sslmode", ["require"])[0] or "require").lower()

    kwargs: dict[str, Any] = {
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "host": parsed.hostname or "localhost",
        "port": int(parsed.port or 5432),
        "database": unquote((parsed.path or "/neondb").lstrip("/")),
        "timeout": 30,
    }
    if sslmode != "disable":
        kwargs["ssl_context"] = ssl.create_default_context()
    return kwargs


def _compile_named_sql(sql: str) -> tuple[str, list[str]]:
    """Convert named parameter SQL into positional format SQL and ordered key list."""
    keys: list[str] = []

    def _replace(match: re.Match[str]) -> str:
        keys.append(match.group(1))
        return "%s"

    compiled_sql = _NAMED_PARAM_RE.sub(_replace, sql)
    return compiled_sql, keys


def _parse_multi_row_insert(sql: str) -> tuple[str, str, str, list[str]] | None:
    """Split an INSERT VALUES statement using O(L) parenthesis depth scan for multi row batching."""
    match = _VALUES_RE.search(sql)
    if not match:
        return None

    open_idx = match.end() - 1
    depth = 0
    close_idx = -1
    for i in range(open_idx, len(sql)):
        ch = sql[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                close_idx = i
                break

    if close_idx == -1:
        return None

    prefix = sql[:open_idx]
    raw_tuple = sql[open_idx : close_idx + 1]
    suffix = sql[close_idx + 1 :]
    compiled_tuple, keys = _compile_named_sql(raw_tuple)
    if not keys:
        return None
    return prefix, compiled_tuple, suffix, keys


def _acquire_pooled_connection() -> Any:
    """Borrow a warm pooled Neon PostgreSQL connection without extra ping round trips."""
    try:
        return _CONN_POOL.get_nowait()
    except queue.Empty:
        return pg_dbapi.connect(**_parse_database_url())


def _release_pooled_connection(conn: Any, healthy: bool) -> None:
    """Return a healthy connection to the LIFO pool or close it if broken."""
    if not healthy:
        try:
            conn.close()
        except Exception:
            pass
        return
    try:
        _CONN_POOL.put_nowait(conn)
    except queue.Full:
        try:
            conn.close()
        except Exception:
            pass


@contextmanager
def get_connection() -> Iterator[Any]:
    """Yield a transactional pooled Neon PostgreSQL connection for write operations."""
    conn = _acquire_pooled_connection()
    healthy = True
    try:
        yield conn
        conn.commit()
    except Exception:
        healthy = False
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        _release_pooled_connection(conn, healthy)


def _split_sql_statements(ddl_sql: str) -> list[str]:
    """Split a DDL script into non empty executable SQL statements."""
    lines = [line for line in ddl_sql.splitlines() if not line.strip().startswith("--")]
    cleaned = "\n".join(lines)
    return [stmt.strip() for stmt in cleaned.split(";") if stmt.strip()]


def init_database() -> None:
    """Apply idempotent medallion schemas, indexes, and seed the 17 Northern provinces."""
    sql_path = Path(__file__).resolve().parent / "init_schemas.sql"
    statements = _split_sql_statements(sql_path.read_text(encoding="utf-8"))

    with get_connection() as conn:
        cur = conn.cursor()
        try:
            for stmt in statements:
                cur.execute(stmt)
        finally:
            cur.close()

    seed_provinces()


def seed_provinces() -> int:
    """Load the 17 Northern provinces from YAML into silver.dim_provinces."""
    yaml_path = BACKEND_DIR / "config" / "provinces_north_17.yaml"
    payload = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    rows = [
        {
            "province_code": item["code"],
            "name_th": item["name_th"],
            "name_en": item["name_en"],
            "subregion": item["subregion"],
            "lat": float(item["lat"]),
            "lon": float(item["lon"]),
        }
        for item in payload["provinces"]
    ]
    upsert_sql = """
        INSERT INTO silver.dim_provinces (
            province_code, name_th, name_en, subregion, lat, lon
        ) VALUES (
            :province_code, :name_th, :name_en, :subregion, :lat, :lon
        )
        ON CONFLICT (province_code) DO UPDATE SET
            name_th = EXCLUDED.name_th,
            name_en = EXCLUDED.name_en,
            subregion = EXCLUDED.subregion,
            lat = EXCLUDED.lat,
            lon = EXCLUDED.lon
    """
    return bulk_execute(upsert_sql, rows)


def bulk_execute(sql: str, rows: Sequence[dict[str, Any]], batch_size: int = 250) -> int:
    """Execute true multi row parameterized INSERT batches in O(N/B) network round trips."""
    if not rows:
        return 0

    parsed = _parse_multi_row_insert(sql)
    total_affected = 0

    with get_connection() as conn:
        cur = conn.cursor()
        try:
            if parsed is not None:
                prefix, compiled_tuple, suffix, keys = parsed
                for start in range(0, len(rows), batch_size):
                    batch = rows[start : start + batch_size]
                    multi_sql = f"{prefix}{', '.join([compiled_tuple] * len(batch))}{suffix}"
                    flat_params = [row[k] for row in batch for k in keys]
                    cur.execute(multi_sql, flat_params)
                    if cur.rowcount is not None and cur.rowcount >= 0:
                        total_affected += cur.rowcount
            else:
                compiled_sql, keys = _compile_named_sql(sql)
                for start in range(0, len(rows), batch_size):
                    batch = rows[start : start + batch_size]
                    param_tuples = [tuple(row[k] for k in keys) for row in batch]
                    cur.executemany(compiled_sql, param_tuples)
                    if cur.rowcount is not None and cur.rowcount >= 0:
                        total_affected += cur.rowcount
        finally:
            cur.close()
    return total_affected


def fetch_all(sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Execute a parameterized SELECT query in a single network round trip with stale connection retry."""
    compiled_sql, keys = _compile_named_sql(sql)
    values = tuple((params or {})[k] for k in keys) if keys else ()

    for attempt in range(2):
        conn = _acquire_pooled_connection()
        try:
            conn.autocommit = True
        except Exception:
            pass
        cur = conn.cursor()
        try:
            cur.execute(compiled_sql, values)
            columns = [desc[0] for desc in (cur.description or [])]
            rows = [dict(zip(columns, row)) for row in cur.fetchall()]
            cur.close()
            _release_pooled_connection(conn, True)
            return rows
        except Exception:
            try:
                cur.close()
            except Exception:
                pass
            _release_pooled_connection(conn, False)
            if attempt == 1:
                raise
    return []
