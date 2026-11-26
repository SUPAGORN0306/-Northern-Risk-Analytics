"""Small opt-in HTTP load probe for staging; not a substitute for managed load testing."""

from __future__ import annotations

import argparse
import asyncio
import os
import time

import httpx


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.getenv("LOAD_TEST_URL", "http://127.0.0.1:8000/api/health"))
    parser.add_argument("--requests", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=10)
    args = parser.parse_args()
    if args.requests < 1 or args.concurrency < 1:
        parser.error("--requests and --concurrency must be positive")

    semaphore = asyncio.Semaphore(args.concurrency)
    latencies: list[float] = []
    statuses: list[int] = []

    async with httpx.AsyncClient(timeout=20.0) as client:
        async def request_once() -> None:
            async with semaphore:
                started = time.perf_counter()
                try:
                    response = await client.get(args.url)
                    statuses.append(response.status_code)
                except httpx.HTTPError:
                    statuses.append(0)
                latencies.append((time.perf_counter() - started) * 1000)

        total_started = time.perf_counter()
        await asyncio.gather(*(request_once() for _ in range(args.requests)))
        elapsed = time.perf_counter() - total_started

    ordered = sorted(latencies)
    percentile = lambda p: round(ordered[min(int((len(ordered) - 1) * p), len(ordered) - 1)], 2)
    print({
        "url": args.url,
        "requests": args.requests,
        "concurrency": args.concurrency,
        "elapsed_seconds": round(elapsed, 3),
        "requests_per_second": round(args.requests / max(elapsed, 1e-9), 2),
        "p50_ms": percentile(0.50),
        "p95_ms": percentile(0.95),
        "p99_ms": percentile(0.99),
        "http_2xx": sum(200 <= code < 300 for code in statuses),
        "http_errors": sum(code == 0 or code >= 400 for code in statuses),
        "warning": "Run against staging with approval; these results do not establish production capacity.",
    })


if __name__ == "__main__":
    asyncio.run(main())
