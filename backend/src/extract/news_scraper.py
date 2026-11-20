"""Concurrent RSS news extractor for Northern Thailand tourism, haze, flood, and SME signals."""

from __future__ import annotations

import hashlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import feedparser
import httpx
import yaml
from bs4 import BeautifulSoup

from src.db.connection import bulk_execute

BACKEND_DIR = Path(__file__).resolve().parents[2]


@lru_cache(maxsize=1)
def _load_news_config() -> dict[str, Any]:
    """Load RSS base URL, concurrency limits, and search queries from config/sources.yaml."""
    cfg = yaml.safe_load((BACKEND_DIR / "config" / "sources.yaml").read_text(encoding="utf-8"))
    return cfg["news"]


def _google_news_rss_url(base_url: str, query: str) -> str:
    """Build a Thailand localized Google News RSS search URL."""
    encoded = quote_plus(query)
    return f"{base_url}?q={encoded}&hl=th&gl=TH&ceid=TH:th"


def _strip_html(raw_html: str) -> str:
    """Remove HTML markup cleanly from RSS summaries."""
    if not raw_html:
        return ""
    return BeautifulSoup(raw_html, "html.parser").get_text(" ", strip=True)


def _parse_published(entry: Any) -> datetime | None:
    """Parse RFC 2822 RSS publish timestamps into UTC aware datetimes."""
    raw = entry.get("published") or entry.get("updated")
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _fetch_single_feed(base_url: str, query: str, max_items: int) -> list[dict[str, Any]]:
    """Fetch and parse one RSS feed query into normalized Bronze dictionaries."""
    url = _google_news_rss_url(base_url, query)
    try:
        resp = httpx.get(
            url,
            timeout=12.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 NorthernRiskAnalytics/1.0"},
        )
        resp.raise_for_status()
        feed = feedparser.parse(resp.text)
    except Exception:
        return []

    items: list[dict[str, Any]] = []

    for entry in feed.entries[:max_items]:
        title = (entry.get("title") or "").strip()
        link = (entry.get("link") or "").strip()
        if not title or not link:
            continue

        summary = _strip_html(entry.get("summary") or "")
        source_obj = entry.get("source") or {}
        source_name = (source_obj.get("title") or "Google News Thailand").strip()
        raw_text = f"{title}. {summary}".strip()
        digest = hashlib.sha256(f"{title.lower()}|{link}".encode("utf-8")).hexdigest()

        items.append(
            {
                "source_name": source_name,
                "source_url": link,
                "title": title,
                "published_at": _parse_published(entry),
                "raw_text": raw_text,
                "content_sha256": digest,
            }
        )
    return items


def _normalize_headline_key(title: str) -> str:
    """Normalize a news headline by stripping trailing outlet names to catch cross outlet duplicates."""
    base = title.rsplit(" - ", 1)[0] if " - " in title else title
    return "".join(base.lower().split())[:72]


def fetch_northern_news(queries_override: list[str] | None = None) -> list[dict[str, Any]]:
    """Fetch Northern regional news concurrently with O(1) SHA256 and headline deduplication."""
    cfg = _load_news_config()
    base_url = cfg["google_rss_base"]
    max_items = int(cfg["max_items_per_query"])
    queries = queries_override if queries_override is not None else cfg["queries"]

    deduped: list[dict[str, Any]] = []
    seen_hashes: set[str] = set()
    seen_headlines: set[str] = set()

    with ThreadPoolExecutor(max_workers=int(cfg["max_workers"])) as pool:
        futures = [pool.submit(_fetch_single_feed, base_url, q, max_items) for q in queries]
        for future in as_completed(futures):
            for item in future.result():
                digest = item["content_sha256"]
                hl_key = _normalize_headline_key(item["title"])
                if digest not in seen_hashes and hl_key not in seen_headlines:
                    seen_hashes.add(digest)
                    seen_headlines.add(hl_key)
                    deduped.append(item)

    return deduped


def load_news_to_bronze(queries_override: list[str] | None = None) -> dict[str, int]:
    """Extract deduplicated Northern news feeds and bulk upsert into bronze.news_raw."""
    rows = fetch_northern_news(queries_override=queries_override)
    upsert_sql = """
        INSERT INTO bronze.news_raw (
            source_name, source_url, title, published_at, raw_text, content_sha256
        ) VALUES (
            :source_name, :source_url, :title, :published_at, :raw_text, :content_sha256
        )
        ON CONFLICT (content_sha256) DO NOTHING
    """
    inserted = bulk_execute(upsert_sql, rows)
    return {"fetched_unique": len(rows), "inserted_bronze": inserted}
