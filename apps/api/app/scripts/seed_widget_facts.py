"""Seed deterministic data for widget fact tables.

Run after `alembic upgrade head` to populate:
  - sales_daily      (last 120 days, 4 teams)
  - region_metrics   (Q1 2026 across 4 regions)
  - kpi_snapshots    (latest values for the well-known KPI keys)

Idempotent — uses ON CONFLICT DO UPDATE so re-running just refreshes.

Usage:
    cd apps/api
    python -m app.scripts.seed_widget_facts
"""
from __future__ import annotations

import asyncio
import math
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import text

from app.core.db import session_scope

TEAMS = ["finance", "sales", "engineering", "design"]
REGIONS = [
    ("국내", 1240.0, 8.2, 32.5),
    ("북미",  980.0, 3.1, 25.7),
    ("유럽",  720.0, -1.5, 18.9),
    ("APAC", 1450.0, 12.4, 22.9),
]


def _sales_seed_rows() -> list[tuple[date, str, float, float]]:
    """Deterministic 120-day series. Per-team seasonal + weekly noise."""
    rows: list[tuple[date, str, float, float]] = []
    today = date(2026, 5, 1)  # frozen so seed matches sample doc dates
    for i in range(120):
        d = today - timedelta(days=i)
        for j, team in enumerate(TEAMS):
            # seasonal: sin wave with team-specific phase, scale per team
            base = (100 + j * 35) + 18 * math.sin((i + j * 7) / 14.0)
            weekly = 6 * math.sin(d.weekday() / 7.0 * 2 * math.pi)
            revenue = round(base + weekly + (j * 4), 2)
            expense = round(revenue * (0.62 + (j * 0.04)), 2)
            rows.append((d, team, revenue, expense))
    return rows


async def _upsert_sales(s) -> int:
    rows = _sales_seed_rows()
    # Batch in one statement via VALUES + unnest — 480 individual
    # round-trips were timing out under apptainer's network stack.
    if not rows:
        return 0
    days = [r[0] for r in rows]
    teams = [r[1] for r in rows]
    revenues = [r[2] for r in rows]
    expenses = [r[3] for r in rows]
    await s.execute(
        text(
            """
            INSERT INTO sales_daily (day, team, revenue, expense)
            SELECT * FROM unnest(
                CAST(:days AS DATE[]),
                CAST(:teams AS TEXT[]),
                CAST(:revenues AS NUMERIC[]),
                CAST(:expenses AS NUMERIC[])
            )
            ON CONFLICT (day, team) DO UPDATE
              SET revenue = EXCLUDED.revenue,
                  expense = EXCLUDED.expense
            """
        ),
        {"days": days, "teams": teams, "revenues": revenues, "expenses": expenses},
    )
    return len(rows)


async def _upsert_regions(s) -> int:
    period = "2026-Q1"
    for region, revenue, qoq, share in REGIONS:
        await s.execute(
            text(
                """
                INSERT INTO region_metrics (region, period, revenue, qoq_pct, share_pct)
                VALUES (:region, :period, :revenue, :qoq, :share)
                ON CONFLICT (region, period) DO UPDATE
                  SET revenue = EXCLUDED.revenue,
                      qoq_pct = EXCLUDED.qoq_pct,
                      share_pct = EXCLUDED.share_pct,
                      updated_at = NOW()
                """
            ),
            {"region": region, "period": period, "revenue": revenue,
             "qoq": qoq, "share": share},
        )
    return len(REGIONS)


KPI_SNAPSHOTS = [
    ("finance.daily.revenue",  145.0, 5.4, "up"),
    ("finance.daily.expense",  98.0, -1.2, "down"),
    ("finance.month-end-progress.percent",  68.0, 0.0, "up"),
    ("sales.q1-2026.total",  4390.0, 6.1, "up"),
    ("sales.q1-2026.target-attainment", 102.5, 2.5, "up"),
    ("engineering.dora.lead-time-hours", 18.4, -8.0, "down"),
    ("engineering.dora.change-failure-rate", 4.8, -1.1, "down"),
]


async def _upsert_kpis(s) -> int:
    captured = datetime(2026, 5, 1, 9, 0, tzinfo=UTC)
    for key, value, delta, trend in KPI_SNAPSHOTS:
        await s.execute(
            text(
                """
                INSERT INTO kpi_snapshots (key, captured_at, value, delta_pct, trend)
                VALUES (:key, :captured, :value, :delta, :trend)
                ON CONFLICT (key, captured_at) DO UPDATE
                  SET value = EXCLUDED.value,
                      delta_pct = EXCLUDED.delta_pct,
                      trend = EXCLUDED.trend
                """
            ),
            {"key": key, "captured": captured, "value": value,
             "delta": delta, "trend": trend},
        )
    return len(KPI_SNAPSHOTS)


async def _amain() -> int:
    async with session_scope() as s:
        n_sales = await _upsert_sales(s)
        n_regions = await _upsert_regions(s)
        n_kpis = await _upsert_kpis(s)
        await s.commit()
    print(f"✓ sales_daily        : {n_sales} rows")
    print(f"✓ region_metrics     : {n_regions} rows")
    print(f"✓ kpi_snapshots      : {n_kpis} rows")
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    import sys
    sys.exit(main())
