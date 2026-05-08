"""Widget read-only API (Sprint 6, Phase 3 stub).

GET /api/v1/widgets/registry              → widgets/registry.yaml 카탈로그
GET /api/v1/widgets/kpi/finance-daily     → mock 데이터 (deterministic)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, Depends, Query

from app.core.auth import require_reader
from app.core.errors import envelope

router = APIRouter(prefix="/api/v1/widgets", tags=["widgets"])

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "widgets" / "registry.yaml"


def _load_registry() -> dict[str, Any]:
    if not REGISTRY_PATH.exists():
        return {"widgets": []}
    return yaml.safe_load(REGISTRY_PATH.read_text(encoding="utf-8")) or {"widgets": []}


@router.get("/registry")
async def get_registry(
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    data = _load_registry()
    widgets = data.get("widgets", []) or []
    return envelope(data=widgets, meta={"total": len(widgets)})


@router.get("/kpi/finance-daily")
async def get_kpi_finance_daily(
    team: str = Query(default="finance"),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    # Deterministic mock — Phase 3 가 실 구현으로 대체 예정.
    labels = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    revenue = [120, 132, 101, 134, 145]
    expense = [80, 92, 95, 99, 110]
    return envelope(
        data={
            "labels": labels,
            "series": [
                {"name": "revenue", "values": revenue},
                {"name": "expense", "values": expense},
            ],
        },
        meta={"team": team, "stub": True},
    )
