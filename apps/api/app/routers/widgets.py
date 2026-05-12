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

import time
from pathlib import Path
from typing import Any, Callable

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.errors import envelope
from app.core.db import get_db as get_session

router = APIRouter(prefix="/api/v1/widgets", tags=["widgets"])


# ── Tiny in-process TTL cache ───────────────────────────────────────
# Most widget reads are deterministic against the fact tables and the
# same value is hit again within seconds when 10 cards on a doc all
# call the same endpoint. Avoid hammering the DB for that — keep a
# 60-second cache keyed on the full path + querystring.
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL_SEC = 60


def _cache_key(request: Request) -> str:
    return f"{request.url.path}?{request.url.query}"


def _cache_get(key: str) -> Any | None:
    entry = _CACHE.get(key)
    if not entry:
        return None
    if time.monotonic() - entry[0] > _CACHE_TTL_SEC:
        _CACHE.pop(key, None)
        return None
    return entry[1]


def _cache_set(key: str, value: Any) -> Any:
    _CACHE[key] = (time.monotonic(), value)
    return value


async def cached(request: Request, computer: Callable[[], Any]) -> Any:
    key = _cache_key(request)
    hit = _cache_get(key)
    if hit is not None:
        return hit
    value = await computer()
    return _cache_set(key, value)

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
# Chart widget responses include chartType / engine / interactions / options
# alongside the data so the FE renderer has a complete recipe — no separate
# config block needed. The DataSourceBlock can OVERRIDE any of these via its
# `chartOptions` field (deep-merged on top of the widget defaults).
@router.get("/chart/sales-trend")
async def chart_sales_trend(
    request: Request,
    team: str = Query(default="finance"),
    days: int = Query(default=30, ge=1, le=120),
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    async def _compute() -> dict[str, Any]:
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
        rows = list(reversed(rows))
        return envelope(
            data={
                "labels": [r["day"].isoformat() for r in rows],
                "series": [
                    {"name": "revenue", "values": [float(r["revenue"]) for r in rows]},
                    {"name": "expense", "values": [float(r["expense"]) for r in rows]},
                ],
                # Widget-provided chart defaults — FE merges with block-level
                # chartOptions if present.
                "chartType": "line",
                "engine":    "echarts",
                "interactions": {},
                "options": {
                    "title":   {"text": f"매출 추세 — {team} (최근 {days}일)", "left": "center", "textStyle": {"fontSize": 14}},
                    "legend":  {"top": 28},
                    "tooltip": {"trigger": "axis"},
                    "color":   ["#1428A0", "#06b6d4"],
                    "yAxis":   {"axisLabel": {"formatter": "{value}M"}},
                    "dataZoom": [{"type": "slider", "start": 50, "end": 100, "height": 18}],
                },
            },
            meta={"team": team, "days": days, "source": "sales_daily", "cached_ttl_sec": _CACHE_TTL_SEC},
        )
    return await cached(request, _compute)


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
            "chartType": "bar",
            "engine": "echarts",
            "interactions": {},
            "options": {
                "title":   {"text": "월결산 단계별 진행률", "left": "center", "textStyle": {"fontSize": 14}},
                "tooltip": {"trigger": "axis", "valueFormatter": "(v) => v + '%'"},
                "color":   ["#16a34a"],
                "yAxis":   {"max": 100, "axisLabel": {"formatter": "{value}%"}},
            },
        },
        meta={"overall_percent": overall, "source": "kpi_snapshots"},
    )


# ── Table widgets ───────────────────────────────────────────────────
@router.get("/table/region-breakdown")
async def table_region_breakdown(
    request: Request,
    period: str = Query(default="2026-Q1"),
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    async def _compute() -> dict[str, Any]:
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
            meta={"period": period, "row_count": len(rows), "source": "region_metrics", "cached_ttl_sec": _CACHE_TTL_SEC},
        )
    return await cached(request, _compute)


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


# ── Launch program widgets (sample 06 — galaxy-flip-2026) ──────────
@router.get("/launch/{program}/tasks")
async def launch_tasks(
    program: str,
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT task, start_date, end_date, progress_pct, owner
              FROM launch_tasks
             WHERE program_slug = :p
             ORDER BY sort_order
        """),
        {"p": program},
    )).mappings().all()
    return envelope(
        data={
            "columns": ["task", "start", "end", "progress", "owner"],
            "rows": [
                [r["task"], r["start_date"].isoformat(), r["end_date"].isoformat(),
                 float(r["progress_pct"]), r["owner"]]
                for r in rows
            ],
        },
        meta={"program": program, "row_count": len(rows), "source": "launch_tasks"},
    )


@router.get("/launch/{program}/timeline")
async def launch_timeline(
    program: str,
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT week_label, activity, owner, deliverable
              FROM launch_timeline
             WHERE program_slug = :p
             ORDER BY sort_order
        """),
        {"p": program},
    )).mappings().all()
    return envelope(
        data={
            "columns": ["주차", "활동", "담당", "산출물"],
            "rows": [[r["week_label"], r["activity"], r["owner"], r["deliverable"]] for r in rows],
        },
        meta={"program": program, "row_count": len(rows), "source": "launch_timeline"},
    )


@router.get("/launch/{program}/forecast")
async def launch_forecast(
    program: str,
    s: AsyncSession = Depends(get_session),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT quarter, scenario, units
              FROM demand_forecast
             WHERE program_slug = :p
             ORDER BY quarter, scenario
        """),
        {"p": program},
    )).mappings().all()
    # Pivot to chart shape: labels = quarters, series = scenarios
    quarters: list[str] = []
    by_scenario: dict[str, dict[str, float]] = {}
    for r in rows:
        if r["quarter"] not in quarters:
            quarters.append(r["quarter"])
        by_scenario.setdefault(r["scenario"], {})[r["quarter"]] = float(r["units"])
    return envelope(
        data={
            "labels": quarters,
            "series": [
                {"name": scen, "values": [by_scenario[scen].get(q, 0.0) for q in quarters]}
                for scen in sorted(by_scenario.keys())
            ],
            "chartType": "line",
            "engine": "echarts",
            "interactions": {},
            "options": {
                "title":   {"text": f"수요 시나리오 — {program}", "left": "center", "textStyle": {"fontSize": 14}},
                "legend":  {"top": 28},
                "tooltip": {"trigger": "axis"},
                "color":   ["#1428A0", "#dc2626", "#16a34a"],  # baseline / bear / bull
                "yAxis":   {"name": "단위 (천 대)", "axisLabel": {"formatter": "{value}K"}},
                "smooth":  True,
            },
        },
        meta={"program": program, "source": "demand_forecast"},
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
