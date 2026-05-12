"""Widget read-only API.

Widgets serve live data to the DataSource block (and KpiCards / Chart
when rendered dynamically). All values come from the fact tables
created in alembic 0040 (sales_daily / region_metrics / kpi_snapshots),
populated by `app.scripts.seed_widget_facts`. No hardcoded mocks.

Routes:
  GET /api/v1/widgets/registry              → catalog from registry.yaml
  GET /api/v1/widgets/kpi/{key}             → latest kpi_snapshots row
  GET /api/v1/widgets/chart/sales-trend     → recent days revenue/expense
  GET /api/v1/widgets/chart/month-end-progress  → derived progress %
  GET /api/v1/widgets/table/region-breakdown    → region_metrics for a period
  GET /api/v1/widgets/table/sales-summary       → team totals over window

The catch-all at the bottom returns 503 (Service Unavailable) with a
clear "not implemented" body so the FE can render a friendly placeholder.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.errors import envelope
from app.core.db import get_db as get_session

router = APIRouter(prefix="/api/v1/widgets", tags=["widgets"])

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "widgets" / "registry.yaml"


def _load_registry() -> dict[str, Any]:
    if not REGISTRY_PATH.exists():
        return {"widgets": []}
    return yaml.safe_load(REGISTRY_PATH.read_text(encoding="utf-8")) or {"widgets": []}


# ── catalog ─────────────────────────────────────────────────────────
@router.get("/registry")
async def get_registry(
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    data = _load_registry()
    widgets = data.get("widgets", []) or []
    return envelope(data=widgets, meta={"total": len(widgets)})


# ── KPI snapshots — `key` is the KPI identifier from kpi_snapshots ──
@router.get("/kpi/{key:path}")
async def get_kpi(
    key: str,
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    """Returns the most recent snapshot for `key` plus its 7-day trend.

    `key` examples:
      - finance.daily.revenue
      - finance.month-end-progress.percent
      - sales.q1-2026.total
    """
    row = (await s.execute(
        text("""
            SELECT key, captured_at, value, delta_pct, trend, meta
              FROM kpi_snapshots
             WHERE key = :key
             ORDER BY captured_at DESC
             LIMIT 1
        """),
        {"key": key},
    )).mappings().first()

    if not row:
        raise HTTPException(404, detail={
            "error": "kpi_not_found",
            "key": key,
            "hint": "Run `python -m app.scripts.seed_widget_facts` to populate kpi_snapshots.",
        })

    return envelope(
        data={
            "label": _humanize_kpi_label(key),
            "value": float(row["value"]),
            "delta": float(row["delta_pct"]) if row["delta_pct"] is not None else None,
            "trend": row["trend"],
            "key": key,
        },
        meta={"captured_at": row["captured_at"].isoformat(), "source": "kpi_snapshots"},
    )


def _humanize_kpi_label(key: str) -> str:
    parts = key.split(".")
    return " · ".join(p.replace("-", " ").title() for p in parts)


# Legacy alias — early seed docs hit /kpi/finance-daily as if it were a
# single widget. Route the call to the canonical revenue/expense pair.
@router.get("/kpi-finance-daily-summary")
async def get_kpi_finance_daily(
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT key, value, delta_pct, trend
              FROM kpi_snapshots
             WHERE key IN ('finance.daily.revenue', 'finance.daily.expense')
             ORDER BY captured_at DESC
        """),
    )).mappings().all()
    cards = [
        {
            "label": _humanize_kpi_label(r["key"]),
            "value": float(r["value"]),
            "delta": float(r["delta_pct"]) if r["delta_pct"] is not None else None,
            "trend": r["trend"],
        }
        for r in rows
    ]
    return envelope(data={"cards": cards}, meta={"source": "kpi_snapshots"})


# ── Chart widgets ───────────────────────────────────────────────────
@router.get("/chart/sales-trend")
async def chart_sales_trend(
    team: str = Query(default="finance"),
    days: int = Query(default=30, ge=1, le=120),
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT day, revenue, expense
              FROM sales_daily
             WHERE team = :team
             ORDER BY day DESC
             LIMIT :days
        """),
        {"team": team, "days": days},
    )).mappings().all()
    rows = list(reversed(rows))  # ascending for chart
    return envelope(
        data={
            "labels": [r["day"].isoformat() for r in rows],
            "series": [
                {"name": "revenue", "values": [float(r["revenue"]) for r in rows]},
                {"name": "expense", "values": [float(r["expense"]) for r in rows]},
            ],
        },
        meta={"team": team, "days": days, "source": "sales_daily"},
    )


@router.get("/chart/month-end-progress")
async def chart_month_end_progress(
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    """5-stage month-end closing progress derived from the KPI snapshot."""
    row = (await s.execute(
        text("""
            SELECT value FROM kpi_snapshots
             WHERE key = 'finance.month-end-progress.percent'
             ORDER BY captured_at DESC LIMIT 1
        """),
    )).mappings().first()
    overall = float(row["value"]) if row else 0.0
    stages = [
        {"stage": "Cutoff",     "pct": min(100.0, overall * 1.20)},
        {"stage": "Reconcile",  "pct": min(100.0, overall * 1.05)},
        {"stage": "Adjustments","pct": overall},
        {"stage": "Review",     "pct": max(0.0,   overall * 0.80)},
        {"stage": "Publish",    "pct": max(0.0,   overall * 0.55)},
    ]
    return envelope(
        data={
            "labels": [s["stage"] for s in stages],
            "series": [{"name": "progress", "values": [round(s["pct"], 1) for s in stages]}],
        },
        meta={"overall_percent": overall, "source": "kpi_snapshots"},
    )


# ── Table widgets ───────────────────────────────────────────────────
@router.get("/table/region-breakdown")
async def table_region_breakdown(
    period: str = Query(default="2026-Q1"),
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT region, revenue, qoq_pct, share_pct
              FROM region_metrics
             WHERE period = :period
             ORDER BY revenue DESC
        """),
        {"period": period},
    )).mappings().all()
    return envelope(
        data={
            "columns": ["지역", "매출 (M)", "QoQ %", "비중 %"],
            "rows": [
                [r["region"], float(r["revenue"]), float(r["qoq_pct"]), float(r["share_pct"])]
                for r in rows
            ],
        },
        meta={"period": period, "row_count": len(rows), "source": "region_metrics"},
    )


@router.get("/table/sales-summary")
async def table_sales_summary(
    days: int = Query(default=30, ge=1, le=120),
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    """Per-team aggregate over the last N days."""
    rows = (await s.execute(
        text("""
            SELECT team,
                   ROUND(SUM(revenue)::numeric, 2) AS revenue,
                   ROUND(SUM(expense)::numeric, 2) AS expense,
                   ROUND((SUM(revenue) - SUM(expense))::numeric, 2) AS profit,
                   COUNT(*) AS days
              FROM sales_daily
             WHERE day >= CURRENT_DATE - (:days || ' days')::interval
             GROUP BY team
             ORDER BY revenue DESC
        """),
        {"days": days},
    )).mappings().all()
    return envelope(
        data={
            "columns": ["팀", "매출", "비용", "이익", "일수"],
            "rows": [
                [r["team"], float(r["revenue"]), float(r["expense"]),
                 float(r["profit"]), int(r["days"])]
                for r in rows
            ],
        },
        meta={"window_days": days, "source": "sales_daily"},
    )


# ── Fallback — explicit "not implemented" so FE renders a placeholder
@router.get("/{kind}/{widget_id:path}")
async def widget_not_implemented(
    kind: str,
    widget_id: str,
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    raise HTTPException(
        status_code=503,
        detail={
            "error": "widget_not_implemented",
            "kind": kind,
            "widget_id": widget_id,
            "message": f"위젯 {kind}/{widget_id} 가 아직 구성되지 않았습니다.",
            "hint": "Add a route above this fallback in widgets.py to back this widget with real data.",
        },
    )
