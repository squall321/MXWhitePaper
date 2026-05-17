"""관리자 대시보드 라우터 (Tier 2D).

  - GET    /api/v1/admin/users                  유저 검색/목록
  - PATCH  /api/v1/admin/users/{id}             role / is_active 갱신
  - GET    /api/v1/admin/audit                  감사 로그 조회 (action/user/since 필터)
  - GET    /api/v1/admin/health                 시스템 헬스 카운터
  - POST   /api/v1/admin/maintenance/run        sweep + version compaction 트리거
  - POST   /api/v1/admin/bulk-docs              다중 문서 일괄 작업 (move/tag/transition/delete)

모든 엔드포인트 admin RBAC. 결과는 envelope() 로 감싼다.
"""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import ROLE_ORDER, get_current_user, require_admin
from app.core.db import get_db
from app.core.errors import NotFound, ValidationFailed, envelope
from app.middleware.rate_limit import get_limiter
from app.repos import document_repo
from app.search import meili_indexer
from app.services.document_service import refresh_search_view, reindex_meili
from app.services.maintenance import (
    compact_versions,
    purge_expired_pending_uploads,
)

VALID_STATUSES: set[str] = {
    "draft",
    "in_review",
    "approved",
    "published",
    "archived",
}
TAG_OPS: set[str] = {"add-tag", "remove-tag"}
ADMIN_ONLY_OPS: set[str] = {"move-part", "transition", "delete"}


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


# ── Bulk doc operations ─────────────────────────────────────────────────


class BulkDocPayload(BaseModel):
    """Op-specific payload. Only relevant fields are read per op."""

    part_id: str | None = Field(default=None, description="move-part 대상 part uuid")
    tag: str | None = Field(default=None, description="add-tag/remove-tag 대상 태그")
    status: str | None = Field(default=None, description="transition 대상 status")


class BulkDocsIn(BaseModel):
    slugs: list[str] = Field(default_factory=list, max_length=500)
    op: Literal["move-part", "add-tag", "remove-tag", "transition", "delete"]
    payload: BulkDocPayload = Field(default_factory=BulkDocPayload)


def _is_admin(user: dict[str, Any]) -> bool:
    return ROLE_ORDER.get(user.get("role", ""), 0) >= ROLE_ORDER["admin"]


def _is_editor_plus(user: dict[str, Any]) -> bool:
    return ROLE_ORDER.get(user.get("role", ""), 0) >= ROLE_ORDER["editor"]


async def _apply_tag_change(
    s: AsyncSession,
    *,
    doc_id: str,
    content: dict[str, Any],
    op: str,
    tag: str,
) -> bool:
    """Mutate document_json metadata.tags + document_tags. Returns True if changed."""
    meta = content.get("metadata")
    if not isinstance(meta, dict):
        meta = {}
    raw = meta.get("tags")
    tags = [t for t in raw if isinstance(t, str)] if isinstance(raw, list) else []
    new_tags = list(tags)
    if op == "add-tag":
        if tag in new_tags:
            return False
        new_tags.append(tag)
    else:  # remove-tag
        if tag not in new_tags:
            return False
        new_tags = [t for t in new_tags if t != tag]
    meta["tags"] = new_tags
    content["metadata"] = meta
    await s.execute(
        text(
            """
            UPDATE documents
            SET content_json = CAST(:body AS JSONB),
                version = version + 1,
                updated_at = NOW()
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": doc_id, "body": json.dumps(content, ensure_ascii=False)},
    )
    await document_repo.replace_document_tags(
        s, document_id=doc_id, tag_names=new_tags
    )
    return True


@router.post(
    "/bulk-docs",
    summary="다중 문서 일괄 작업 (move/tag/transition/delete)",
    description=(
        "여러 문서에 한 번의 op 를 적용한다. partial-failure 모델: 한 슬러그가 실패해도 "
        "나머지는 진행한다. delete 는 status='archived' 로의 soft-delete 와 동일."
    ),
)
async def bulk_docs(
    body: BulkDocsIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    op = body.op
    # AuthZ. tag ops: editor+ on docs they own. all other ops: admin.
    if op in ADMIN_ONLY_OPS:
        if not _is_admin(user):
            from app.core.errors import Forbidden  # local to avoid top-level cycle
            raise Forbidden("bulk-docs requires admin role")
    elif op in TAG_OPS:
        if not _is_editor_plus(user):
            from app.core.errors import Forbidden
            raise Forbidden("bulk-docs tag ops require editor+ role")

    # Op-level validation (fail fast — no work done yet).
    payload = body.payload
    if op == "move-part":
        if not payload.part_id:
            raise ValidationFailed("payload.part_id required for move-part")
        prow = (await s.execute(
            text("SELECT id FROM parts WHERE id = CAST(:id AS uuid)"),
            {"id": payload.part_id},
        )).first()
        if not prow:
            raise ValidationFailed(f"part not found: {payload.part_id}")
    elif op in TAG_OPS:
        if not payload.tag or not payload.tag.strip():
            raise ValidationFailed("payload.tag required for tag ops")
    elif op == "transition":
        if payload.status not in VALID_STATUSES:
            raise ValidationFailed(
                f"payload.status must be one of {sorted(VALID_STATUSES)}"
            )

    actor_id = user.get("id")
    is_editor_only = op in TAG_OPS and not _is_admin(user)

    ok = 0
    failed = 0
    errors: list[dict[str, Any]] = []
    affected_doc_ids: list[str] = []

    for slug in body.slugs:
        slug = (slug or "").strip()
        if not slug:
            failed += 1
            errors.append({"slug": slug, "message": "empty slug"})
            continue
        try:
            doc = await document_repo.find_by_slug(s, slug)
            if not doc:
                raise NotFound(f"document not found: {slug}")
            # Tag ops by editors are restricted to docs they own.
            if is_editor_only and str(doc.get("owner_id")) != str(actor_id):
                from app.core.errors import Forbidden
                raise Forbidden("editor may only tag docs they own")

            if op == "move-part":
                await s.execute(
                    text(
                        """
                        UPDATE documents
                        SET part_id = CAST(:p AS uuid), updated_at = NOW()
                        WHERE id = CAST(:id AS uuid)
                        """
                    ),
                    {"p": payload.part_id, "id": doc["id"]},
                )
                await document_repo.insert_audit(
                    s,
                    user_id=actor_id,
                    action="bulk.docs.move",
                    target=f"document:{slug}",
                    payload={"to_part_id": payload.part_id},
                )
                affected_doc_ids.append(doc["id"])

            elif op in TAG_OPS:
                content = doc.get("content_json") or {}
                if isinstance(content, str):
                    content = json.loads(content)
                changed = await _apply_tag_change(
                    s,
                    doc_id=doc["id"],
                    content=content,
                    op=op,
                    tag=payload.tag.strip(),  # type: ignore[union-attr]
                )
                if changed:
                    await document_repo.insert_audit(
                        s,
                        user_id=actor_id,
                        action=f"bulk.docs.{op.replace('-', '_')}",
                        target=f"document:{slug}",
                        payload={"tag": payload.tag},
                    )
                    affected_doc_ids.append(doc["id"])

            elif op == "transition":
                await s.execute(
                    text(
                        """
                        UPDATE documents SET status = :st, updated_at = NOW()
                        WHERE id = CAST(:id AS uuid)
                        """
                    ),
                    {"st": payload.status, "id": doc["id"]},
                )
                await document_repo.insert_audit(
                    s,
                    user_id=actor_id,
                    action="bulk.docs.transition",
                    target=f"document:{slug}",
                    payload={"from": doc["status"], "to": payload.status},
                )
                affected_doc_ids.append(doc["id"])

            elif op == "delete":
                # Soft delete = transition to archived. Idempotent.
                await document_repo.soft_delete_document(s, doc["id"])
                await document_repo.insert_audit(
                    s,
                    user_id=actor_id,
                    action="bulk.docs.delete",
                    target=f"document:{slug}",
                )
                affected_doc_ids.append(doc["id"])

            ok += 1
        except Exception as e:
            failed += 1
            msg = getattr(e, "message", None) or str(e) or e.__class__.__name__
            errors.append({"slug": slug, "message": msg})

    await s.commit()

    # Best-effort search reindex (failures don't roll back the commit).
    if affected_doc_ids:
        try:
            await refresh_search_view(s)
        except Exception:
            pass
        archived_now = op == "delete" or (
            op == "transition" and payload.status == "archived"
        )
        for did in affected_doc_ids:
            try:
                await reindex_meili(s, doc_id=did, archived=archived_now)
            except Exception:
                pass

    return envelope(
        data={"ok": ok, "failed": failed, "errors": errors},
        meta={"op": op, "count": len(body.slugs)},
    )


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


# ── Archived documents (cycle 8) ─────────────────────────────────────────
class ArchiveBulkIn(BaseModel):
    slugs: list[str] = Field(default_factory=list, max_length=500)
    # When true, an admin may purge documents that were archived less than
    # 7 days ago. The default keeps the safety net for accidental clicks.
    force: bool = False


@router.get("/archived-docs", summary="보관 문서 목록")
async def list_archived_docs(
    since_days: int | None = Query(
        default=None, ge=1, le=3650,
        description="이 일수 이내에 보관된 문서만 (updated_at 기준)",
    ),
    author: str | None = Query(
        default=None,
        description="작성자 이름/이메일 부분 일치",
    ),
    team_id: str | None = Query(
        default=None,
        description="부서(team) UUID — 작성자 team_id 기준",
    ),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    where: list[str] = ["d.status = 'archived'"]
    params: dict[str, Any] = {"lim": limit, "off": offset}
    if since_days is not None:
        where.append(
            "d.updated_at >= NOW() - (CAST(:days AS text) || ' days')::interval"
        )
        params["days"] = str(since_days)
    if author:
        where.append(
            "(LOWER(u.name) LIKE LOWER(:a) OR LOWER(u.email) LIKE LOWER(:a))"
        )
        params["a"] = f"%{author}%"
    if team_id:
        where.append("u.team_id = CAST(:tid AS uuid)")
        params["tid"] = team_id
    where_sql = " AND ".join(where)
    sql = f"""
        SELECT d.slug, d.title, d.updated_at,
               u.id, u.name, u.email,
               (SELECT MAX(dv.edited_at) FROM document_versions dv
                WHERE dv.document_id = d.id) AS last_edited_at
        FROM documents d
        LEFT JOIN users u ON u.id = d.owner_id
        WHERE {where_sql}
        ORDER BY d.updated_at DESC
        LIMIT :lim OFFSET :off
    """
    rows = (await s.execute(text(sql), params)).all()
    total_sql = f"""
        SELECT COUNT(*) FROM documents d
        LEFT JOIN users u ON u.id = d.owner_id
        WHERE {where_sql}
    """
    total = int((await s.execute(
        text(total_sql),
        {k: v for k, v in params.items() if k not in ("lim", "off")},
    )).scalar() or 0)
    items = [
        {
            "slug": r[0],
            "title": r[1],
            "archived_at": r[2].isoformat() if r[2] else None,
            "owner_id": str(r[3]) if r[3] else None,
            "owner_name": r[4],
            "owner_email": r[5],
            "last_edited_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]
    return envelope(
        data=items,
        meta={"count": len(items), "total": total, "limit": limit, "offset": offset},
    )


@router.post("/archived-docs/restore", summary="보관 문서 일괄 복원 (→ draft)")
async def restore_archived_docs(
    body: ArchiveBulkIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    restored: list[str] = []
    skipped: list[dict[str, str]] = []
    for slug in body.slugs:
        row = (await s.execute(
            text("SELECT id, status FROM documents WHERE slug = :s"),
            {"s": slug},
        )).first()
        if not row:
            skipped.append({"slug": slug, "reason": "not_found"})
            continue
        if row[1] != "archived":
            skipped.append({"slug": slug, "reason": "not_archived"})
            continue
        await s.execute(
            text(
                "UPDATE documents SET status='draft', updated_at=NOW() "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"id": str(row[0])},
        )
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="admin.archive.restore",
            target=f"document:{slug}",
            payload={"from": "archived", "to": "draft"},
        )
        restored.append(slug)
    await s.commit()
    return envelope(data={"restored": restored, "skipped": skipped})


@router.delete("/archived-docs/purge", summary="보관 문서 영구 삭제 (irreversible)")
async def purge_archived_docs(
    body: ArchiveBulkIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Hard-delete archived docs.

    By default refuses if any doc was archived <7 days ago — the 7-day grace
    window catches accidental archives. Admins can pass `force=true` to bypass
    the grace check and purge immediately (audit log records the bypass).
    """
    purged: list[str] = []
    skipped: list[dict[str, str]] = []
    too_recent: list[str] = []
    for slug in body.slugs:
        row = (await s.execute(
            text(
                "SELECT id, status, updated_at FROM documents WHERE slug = :s"
            ),
            {"s": slug},
        )).first()
        if not row:
            skipped.append({"slug": slug, "reason": "not_found"})
            continue
        if row[1] != "archived":
            skipped.append({"slug": slug, "reason": "not_archived"})
            continue
        # 7-day safety: refuse purge if archived less than 7 days ago,
        # unless the admin explicitly opts in via force=true.
        if not body.force:
            chk = (await s.execute(
                text(
                    "SELECT (NOW() - updated_at) >= INTERVAL '7 days' "
                    "FROM documents WHERE id = CAST(:id AS uuid)"
                ),
                {"id": str(row[0])},
            )).first()
            if not chk or not bool(chk[0]):
                too_recent.append(slug)
                continue
        await s.execute(
            text("DELETE FROM documents WHERE id = CAST(:id AS uuid)"),
            {"id": str(row[0])},
        )
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="admin.archive.purge",
            target=f"document:{slug}",
            payload={"slug": slug, "force": body.force},
        )
        purged.append(slug)

    if too_recent:
        # Roll back any partial state — purge is all-or-nothing per request.
        await s.rollback()
        raise ValidationFailed(
            "보관된 지 7일이 지나지 않은 문서는 영구 삭제할 수 없습니다.",
            details={"too_recent": too_recent},
        )
    await s.commit()
    return envelope(data={"purged": purged, "skipped": skipped})


# ── Rate-limit telemetry ─────────────────────────────────────────────────
@router.get("/rate-limit-stats", summary="In-memory per-IP rate-limit 스냅샷")
async def rate_limit_stats(
    top: int = Query(default=10, ge=1, le=100),
    _user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Return current in-process bucket stats — admin only.

    Single-replica only (process-local). Multi-replica aggregation would
    require Redis; flagged as future work.
    """
    snap = get_limiter().snapshot(top_n=top)
    return envelope(data=snap)
