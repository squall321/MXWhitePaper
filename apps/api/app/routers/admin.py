"""관리자 대시보드 라우터 (Tier 2D).

  - GET    /api/v1/admin/users                  유저 검색/목록
  - PATCH  /api/v1/admin/users/{id}             role / is_active 갱신
  - GET    /api/v1/admin/audit                  감사 로그 조회 (action/user/since 필터)
  - GET    /api/v1/admin/health                 시스템 헬스 카운터
  - POST   /api/v1/admin/maintenance/run        sweep + version compaction 트리거

모든 엔드포인트 admin RBAC. 결과는 envelope() 로 감싼다.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_db
from app.core.errors import NotFound, envelope
from app.repos import document_repo
from app.search import meili_indexer
from app.services.maintenance import (
    compact_versions,
    purge_expired_pending_uploads,
)


router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ── Users ────────────────────────────────────────────────────────────────
@router.get("/users", summary="유저 목록 (검색/role 필터)")
async def list_users(
    q: str | None = Query(default=None, description="이름/이메일 부분 검색"),
    role: str | None = Query(default=None, description="reader/editor/owner/admin"),
    limit: int = Query(default=50, ge=1, le=200),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    where: list[str] = []
    params: dict[str, Any] = {"lim": limit}
    if q:
        where.append("(LOWER(u.email) LIKE LOWER(:q) OR LOWER(u.name) LIKE LOWER(:q))")
        params["q"] = f"%{q}%"
    if role:
        where.append("u.role = :role")
        params["role"] = role
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT u.id, u.email, u.name, u.role, u.team_id, u.is_active,
               u.created_at, u.last_login_at
        FROM users u
        {where_sql}
        ORDER BY u.created_at DESC
        LIMIT :lim
    """
    rows = (await s.execute(text(sql), params)).all()
    items = [
        {
            "id": str(r[0]),
            "email": r[1],
            "name": r[2],
            "role": r[3],
            "team_id": str(r[4]) if r[4] else None,
            "is_active": bool(r[5]),
            "created_at": r[6].isoformat() if r[6] else None,
            "last_login_at": r[7].isoformat() if r[7] else None,
        }
        for r in rows
    ]
    return envelope(data=items, meta={"count": len(items)})


class UserPatch(BaseModel):
    role: str | None = Field(default=None, pattern=r"^(reader|editor|owner|admin)$")
    is_active: bool | None = None


@router.patch("/users/{user_id}", summary="유저 role/활성 갱신")
async def patch_user(
    user_id: str,
    payload: UserPatch,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    row = (await s.execute(
        text("SELECT id FROM users WHERE id = CAST(:id AS uuid)"),
        {"id": user_id},
    )).first()
    if not row:
        raise NotFound(f"user not found: {user_id}")

    fields: list[str] = []
    params: dict[str, Any] = {"id": user_id}
    if payload.role is not None:
        fields.append("role = :role")
        params["role"] = payload.role
    if payload.is_active is not None:
        fields.append("is_active = :active")
        params["active"] = payload.is_active
    if fields:
        await s.execute(
            text(f"UPDATE users SET {', '.join(fields)} WHERE id = CAST(:id AS uuid)"),
            params,
        )
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="admin.user.update",
            target=f"user:{user_id}",
            payload={k: params[k] for k in params if k != "id"},
        )
        await s.commit()

    out = (await s.execute(
        text("""
            SELECT id, email, name, role, team_id, is_active, last_login_at
            FROM users WHERE id = CAST(:id AS uuid)
        """),
        {"id": user_id},
    )).first()
    assert out is not None
    return envelope(data={
        "id": str(out[0]),
        "email": out[1],
        "name": out[2],
        "role": out[3],
        "team_id": str(out[4]) if out[4] else None,
        "is_active": bool(out[5]),
        "last_login_at": out[6].isoformat() if out[6] else None,
    })


# ── Audit logs ───────────────────────────────────────────────────────────
@router.get("/audit", summary="감사 로그 조회")
async def list_audit(
    action: str | None = Query(default=None, description="prefix or exact match"),
    user: str | None = Query(default=None, description="user uuid 또는 email 부분일치"),
    since: str | None = Query(
        default=None,
        description="ISO timestamp; 이 시점 이후 로그만 반환",
    ),
    limit: int = Query(default=50, ge=1, le=500),
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    where: list[str] = []
    params: dict[str, Any] = {"lim": limit}
    if action:
        # prefix 매칭. 정확 매칭은 prefix 결과가 같으므로 OK.
        where.append("a.action LIKE :action")
        params["action"] = f"{action}%"
    if user:
        # uuid 인지 email 인지 헷갈리면 둘 다 매칭.
        where.append(
            "(CAST(a.user_id AS TEXT) = :u OR LOWER(u.email) LIKE LOWER(:ulike))"
        )
        params["u"] = user
        params["ulike"] = f"%{user}%"
    if since:
        where.append("a.created_at >= CAST(:since AS timestamptz)")
        params["since"] = since
    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    sql = f"""
        SELECT a.id, a.user_id, u.email, u.name, a.action, a.target,
               a.payload, a.created_at
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        {where_sql}
        ORDER BY a.created_at DESC
        LIMIT :lim
    """
    rows = (await s.execute(text(sql), params)).all()
    items: list[dict[str, Any]] = []
    for r in rows:
        payload = r[6]
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except (TypeError, ValueError):
                payload = None
        items.append({
            "id": str(r[0]),
            "user_id": str(r[1]) if r[1] else None,
            "user_email": r[2],
            "user_name": r[3],
            "action": r[4],
            "target": r[5],
            "payload": payload,
            "created_at": r[7].isoformat() if r[7] else None,
        })
    return envelope(data=items, meta={"count": len(items)})


# ── Health ───────────────────────────────────────────────────────────────
@router.get("/health", summary="시스템 헬스/카운터")
async def admin_health(
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    counters: dict[str, int] = {}
    counters["docs_active"] = int((await s.execute(
        text("SELECT COUNT(*) FROM documents WHERE status != 'archived'")
    )).scalar() or 0)
    counters["docs_archived"] = int((await s.execute(
        text("SELECT COUNT(*) FROM documents WHERE status = 'archived'")
    )).scalar() or 0)
    counters["users_active"] = int((await s.execute(
        text("SELECT COUNT(*) FROM users WHERE is_active = TRUE")
    )).scalar() or 0)
    counters["users_inactive"] = int((await s.execute(
        text("SELECT COUNT(*) FROM users WHERE is_active = FALSE")
    )).scalar() or 0)
    counters["audit_24h"] = int((await s.execute(
        text(
            "SELECT COUNT(*) FROM audit_logs "
            "WHERE created_at >= NOW() - INTERVAL '24 hours'"
        )
    )).scalar() or 0)
    counters["images"] = int((await s.execute(
        text("SELECT COUNT(*) FROM images")
    )).scalar() or 0)
    counters["pending_uploads"] = int((await s.execute(
        text("SELECT COUNT(*) FROM images_pending")
    )).scalar() or 0)

    # Meilisearch 인덱스 사이즈 (실패해도 0 으로 폴백)
    meili_count = 0
    try:
        cli = meili_indexer.get_client()
        idx = cli.index(meili_indexer.INDEX_UID)
        st = idx.get_stats()
        # meilisearch 0.30+ 는 IndexStats 객체. dict 도 fallback.
        nd = getattr(st, "number_of_documents", None)
        if nd is None and isinstance(st, dict):
            nd = st.get("numberOfDocuments")
        meili_count = int(nd or 0)
    except Exception:
        meili_count = 0
    counters["meilisearch_docs"] = meili_count

    return envelope(data=counters)


# ── Maintenance ──────────────────────────────────────────────────────────
@router.post("/maintenance/run", summary="유지보수 일괄 실행")
async def run_maintenance(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    purged = await purge_expired_pending_uploads(s)
    compacted = await compact_versions(s)
    await document_repo.insert_audit(
        s,
        user_id=user.get("id"),
        action="admin.maintenance.run",
        target="maintenance:all",
        payload={"purged_pending": purged, "compacted_versions": compacted},
    )
    await s.commit()
    return envelope(data={
        "purged_pending": purged,
        "compacted_versions": compacted,
    })
