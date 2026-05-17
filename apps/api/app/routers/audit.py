"""감사 로그 라우터 — admin 전용 조회/필터/CSV 내보내기.

  - GET /api/v1/audit                — 페이지네이션 + 다중 필터
  - GET /api/v1/audit/actions        — distinct action 목록 (5분 캐시)
  - GET /api/v1/audit/csv            — 동일 필터, CSV 스트리밍 다운로드

기존 `audit_logs` 테이블은 단일 `target TEXT` (`"document:slug"` 형태) 를
사용한다. 응답 row 는 `target_kind` / `target_id` 로 분리한 친숙한 형태로
회신한다 (구조 변경 없이 ":" 기준 split). 결과는 항상 `created_at DESC`.

`apps/api/app/routers/admin.py` 의 GET /admin/audit 와 기능적으로 일부 겹치
지만 — admin.py 쪽은 더 단순한 prefix 매칭 + 작은 limit 만 제공하고, 이
라우터는 다중 필터 + 페이지 + CSV 를 책임진다. 단일 책임을 분리해 둔다.
"""
from __future__ import annotations

import csv
import io
import json
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_db
from app.core.errors import envelope

router = APIRouter(prefix="/api/v1/audit", tags=["admin"])


# ── /audit/actions 5분 in-process 캐시 ────────────────────────────────
_ACTIONS_TTL_SECONDS = 300.0
_actions_cache: dict[str, tuple[float, list[str]]] = {}


def _actions_cache_get() -> list[str] | None:
    entry = _actions_cache.get("all")
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        _actions_cache.pop("all", None)
        return None
    return value


def _actions_cache_set(value: list[str]) -> None:
    _actions_cache["all"] = (time.monotonic() + _ACTIONS_TTL_SECONDS, value)


def _actions_cache_clear() -> None:
    """테스트 hook — 캐시를 비운다."""
    _actions_cache.clear()


# ── 공통 필터 파서 ────────────────────────────────────────────────────
def _build_filter_sql(
    *,
    since: str | None,
    until: str | None,
    actor_user_id: str | None,
    action: str | None,
    target_kind: str | None,
) -> tuple[list[str], dict[str, Any]]:
    """WHERE 절 fragment + bind 파라미터를 만든다."""
    where: list[str] = []
    params: dict[str, Any] = {}
    # asyncpg refuses to infer a bare string's type when bound to a CAST
    # placeholder, so we parse to datetime first. Accept "...Z" suffixes.
    from datetime import datetime as _dt
    def _parse_iso(s: str) -> _dt:
        return _dt.fromisoformat(s.replace("Z", "+00:00"))
    if since:
        where.append("a.created_at >= :since")
        params["since"] = _parse_iso(since)
    if until:
        where.append("a.created_at < :until")
        params["until"] = _parse_iso(until)
    if actor_user_id:
        where.append("CAST(a.user_id AS TEXT) = :uid")
        params["uid"] = actor_user_id
    if action:
        where.append("a.action = :action")
        params["action"] = action
    if target_kind:
        where.append("split_part(a.target, ':', 1) = :tkind")
        params["tkind"] = target_kind
    return where, params


def _split_target(target: str | None) -> tuple[str | None, str | None]:
    if not target:
        return None, None
    if ":" in target:
        kind, _, tid = target.partition(":")
        return (kind or None), (tid or None)
    return target, None


def _row_to_dict(row: Any) -> dict[str, Any]:
    payload = row[6]
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError):
            payload = None
    target_kind, target_id = _split_target(row[5])
    return {
        "id": str(row[0]),
        "actor_user_id": str(row[1]) if row[1] else None,
        "actor_name": row[2] or row[3],  # name fallback to email
        "action": row[4],
        "target_kind": target_kind,
        "target_id": target_id,
        "payload": payload,
        "created_at": row[7].isoformat() if row[7] else None,
    }


# ── GET /audit ────────────────────────────────────────────────────────
@router.get("", summary="감사 로그 조회 (페이지+필터)")
async def list_audit(
    since: str | None = Query(default=None, description="ISO 시점 — 이상 포함"),
    until: str | None = Query(default=None, description="ISO 시점 — 미만"),
    actor_user_id: str | None = Query(default=None, description="actor uuid 정확매칭"),
    action: str | None = Query(default=None, description="action 정확매칭"),
    target_kind: str | None = Query(default=None, description="target prefix (':' 앞)"),
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    where, params = _build_filter_sql(
        since=since,
        until=until,
        actor_user_id=actor_user_id,
        action=action,
        target_kind=target_kind,
    )
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""

    total = int((await s.execute(
        text(f"SELECT COUNT(*) FROM audit_logs a {where_sql}"),
        params,
    )).scalar() or 0)

    params["lim"] = limit
    params["off"] = offset
    sql = f"""
        SELECT a.id, a.user_id, u.name, u.email, a.action, a.target,
               a.payload, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        {where_sql}
        ORDER BY a.created_at DESC
        LIMIT :lim OFFSET :off
    """
    rows = (await s.execute(text(sql), params)).all()
    items = [_row_to_dict(r) for r in rows]
    return envelope(
        data=items,
        meta={
            "count": len(items),
            "total": total,
            "limit": limit,
            "offset": offset,
        },
    )


# ── GET /audit/actions ────────────────────────────────────────────────
@router.get("/actions", summary="distinct action 목록 (5분 캐시)")
async def list_actions(
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    cached = _actions_cache_get()
    if cached is not None:
        return envelope(data=cached, meta={"count": len(cached), "cached": True})
    rows = (await s.execute(
        text("SELECT DISTINCT action FROM audit_logs ORDER BY action"),
    )).all()
    actions = [r[0] for r in rows if r[0]]
    _actions_cache_set(actions)
    return envelope(data=actions, meta={"count": len(actions), "cached": False})


# ── GET /audit/csv ────────────────────────────────────────────────────
_CSV_HEADER = [
    "id",
    "created_at",
    "actor_user_id",
    "actor_name",
    "action",
    "target_kind",
    "target_id",
    "payload",
]


@router.get(
    "/csv",
    summary="감사 로그 CSV 내보내기 (스트리밍)",
    response_class=StreamingResponse,
)
async def export_csv(
    since: str | None = Query(default=None),
    until: str | None = Query(default=None),
    actor_user_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    target_kind: str | None = Query(default=None),
    limit: int = Query(default=10000, ge=1, le=100000),
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> StreamingResponse:
    where, params = _build_filter_sql(
        since=since,
        until=until,
        actor_user_id=actor_user_id,
        action=action,
        target_kind=target_kind,
    )
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    params["lim"] = limit
    sql = f"""
        SELECT a.id, a.user_id, u.name, u.email, a.action, a.target,
               a.payload, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        {where_sql}
        ORDER BY a.created_at DESC
        LIMIT :lim
    """
    rows = (await s.execute(text(sql), params)).all()

    async def gen() -> AsyncIterator[str]:
        # Header row.
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(_CSV_HEADER)
        yield buf.getvalue()

        # Body — 한 행씩 따로 yield 하여 큰 결과도 chunked 로 흐른다.
        for r in rows:
            row = _row_to_dict(r)
            buf = io.StringIO()
            writer = csv.writer(buf)
            payload = row.get("payload")
            payload_str = (
                json.dumps(payload, ensure_ascii=False)
                if payload is not None else ""
            )
            writer.writerow([
                row["id"],
                row["created_at"] or "",
                row["actor_user_id"] or "",
                row["actor_name"] or "",
                row["action"] or "",
                row["target_kind"] or "",
                row["target_id"] or "",
                payload_str,
            ])
            yield buf.getvalue()

    filename = "audit-log.csv"
    return StreamingResponse(
        gen(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
