"""Comments 라우터 (Tier 2C).

문서/섹션/블록 단위의 선형 댓글 스레드.

  - POST   /api/v1/documents/:slug/comments       editor+  → 신규 댓글
  - GET    /api/v1/documents/:slug/comments                → 트리 조회
  - PATCH  /api/v1/comments/:id                            → 본문/상태 수정 (작성자 OR admin)
  - DELETE /api/v1/comments/:id                            → soft delete

audit_logs 에 모든 쓰기 이벤트가 기록된다.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Header, Path, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor
from app.core.db import get_db
from app.core.errors import APIError, Forbidden, NotFound, envelope
from app.repos import document_repo

router_doc = APIRouter(prefix="/api/v1/documents", tags=["comments"])
router_one = APIRouter(prefix="/api/v1/comments", tags=["comments"])


class CommentIn(BaseModel):
    anchor_kind: str = Field(..., pattern="^(document|section|block)$")
    anchor_id: str | None = Field(default=None, max_length=200)
    body_md: str = Field(..., min_length=1, max_length=10_000)
    parent_id: str | None = Field(default=None)


class CommentPatchIn(BaseModel):
    body_md: str | None = Field(default=None, max_length=10_000)
    status: str | None = Field(default=None, pattern="^(visible|hidden|deleted)$")


class CommentValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


def _row_to_dict(row: Any) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "document_id": str(row[1]),
        "anchor_kind": row[2],
        "anchor_id": row[3],
        "body_md": row[4],
        "author_id": str(row[5]),
        "parent_id": str(row[6]) if row[6] else None,
        "status": row[7],
        "created_at": row[8].isoformat() if row[8] else None,
        "updated_at": row[9].isoformat() if row[9] else None,
        "author_name": row[10],
        "author_email": row[11],
    }


async def _resolve_doc_id(s: AsyncSession, slug: str) -> str:
    row = (await s.execute(
        text("SELECT id FROM documents WHERE slug = :slug AND status != 'archived'"),
        {"slug": slug},
    )).first()
    if not row:
        raise NotFound(f"document '{slug}' not found")
    return str(row[0])


@router_doc.post(
    "/{slug}/comments",
    status_code=201,
    summary="댓글 작성 (editor+)",
)
async def create_comment(
    body: CommentIn,
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
    x_mxwp_user: str | None = Header(default=None),
) -> dict[str, Any]:
    doc_id = await _resolve_doc_id(s, slug)
    if body.anchor_kind != "document" and not body.anchor_id:
        raise CommentValidationError("anchor_id required for section/block")

    # author_id 확정: X-MXWP-User 헤더가 있으면 우선
    actor_id = user["id"]
    if x_mxwp_user:
        uid = await document_repo.fetch_user_by_email(s, x_mxwp_user)
        if uid:
            actor_id = uid

    # parent_id 검증 — 존재하고 같은 document 인지 확인
    if body.parent_id:
        parent = (await s.execute(
            text("SELECT document_id FROM comments WHERE id = CAST(:id AS uuid)"),
            {"id": body.parent_id},
        )).first()
        if not parent or str(parent[0]) != doc_id:
            raise CommentValidationError("parent_id invalid")

    row = (await s.execute(
        text("""
            INSERT INTO comments
              (document_id, anchor_kind, anchor_id, body_md, author_id, parent_id)
            VALUES
              (CAST(:doc AS uuid), :ak, :aid, :bd, CAST(:au AS uuid),
               CAST(:pid AS uuid))
            RETURNING id, document_id, anchor_kind, anchor_id, body_md,
                      author_id, parent_id, status, created_at, updated_at
        """),
        {
            "doc": doc_id, "ak": body.anchor_kind, "aid": body.anchor_id,
            "bd": body.body_md, "au": actor_id, "pid": body.parent_id,
        },
    )).first()

    await document_repo.insert_audit(
        s, user_id=actor_id, action="comment.create",
        target=f"comments/{row[0]}",
        payload={"document_id": doc_id, "anchor_kind": body.anchor_kind},
    )
    await s.commit()

    # author 정보 join 한 번 더
    full = (await s.execute(
        text("""
            SELECT c.id, c.document_id, c.anchor_kind, c.anchor_id, c.body_md,
                   c.author_id, c.parent_id, c.status, c.created_at, c.updated_at,
                   u.name, u.email
            FROM comments c JOIN users u ON u.id = c.author_id
            WHERE c.id = :id
        """),
        {"id": row[0]},
    )).first()
    return envelope(data=_row_to_dict(full))


@router_doc.get(
    "/{slug}/comments",
    summary="댓글 목록 (anchor 별 그룹)",
)
async def list_comments(
    slug: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user
    doc_id = await _resolve_doc_id(s, slug)
    rows = (await s.execute(
        text("""
            SELECT c.id, c.document_id, c.anchor_kind, c.anchor_id, c.body_md,
                   c.author_id, c.parent_id, c.status, c.created_at, c.updated_at,
                   u.name, u.email
            FROM comments c JOIN users u ON u.id = c.author_id
            WHERE c.document_id = CAST(:doc AS uuid)
            ORDER BY c.created_at ASC
        """),
        {"doc": doc_id},
    )).all()
    items = [_row_to_dict(r) for r in rows]

    # anchor 별 그룹핑 + 트리 구성
    by_anchor: dict[str, list[dict[str, Any]]] = {}
    for it in items:
        key = f"{it['anchor_kind']}:{it['anchor_id'] or ''}"
        by_anchor.setdefault(key, []).append(it)

    return envelope(
        data={"items": items, "by_anchor": by_anchor},
        meta={"count": len(items)},
    )


@router_one.patch(
    "/{cid}",
    summary="댓글 수정 (작성자 OR admin)",
)
async def patch_comment(
    cid: str,
    body: CommentPatchIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    row = (await s.execute(
        text("SELECT author_id FROM comments WHERE id = CAST(:id AS uuid)"),
        {"id": cid},
    )).first()
    if not row:
        raise NotFound("comment not found")
    is_author = str(row[0]) == user["id"]
    is_admin = user.get("role") == "admin"
    if not (is_author or is_admin):
        raise Forbidden("Only the author or an admin may edit a comment")

    sets: list[str] = []
    params: dict[str, Any] = {"id": cid}
    if body.body_md is not None:
        sets.append("body_md = :body")
        params["body"] = body.body_md
    if body.status is not None:
        sets.append("status = :status")
        params["status"] = body.status
    if not sets:
        raise CommentValidationError("nothing to update")
    sets.append("updated_at = NOW()")

    updated = (await s.execute(
        text(f"""
            UPDATE comments SET {', '.join(sets)}
            WHERE id = CAST(:id AS uuid)
            RETURNING id, document_id, anchor_kind, anchor_id, body_md,
                      author_id, parent_id, status, created_at, updated_at
        """),
        params,
    )).first()

    await document_repo.insert_audit(
        s, user_id=user["id"], action="comment.update",
        target=f"comments/{cid}",
        payload={k: v for k, v in body.model_dump().items() if v is not None},
    )
    await s.commit()

    full = (await s.execute(
        text("""
            SELECT c.id, c.document_id, c.anchor_kind, c.anchor_id, c.body_md,
                   c.author_id, c.parent_id, c.status, c.created_at, c.updated_at,
                   u.name, u.email
            FROM comments c JOIN users u ON u.id = c.author_id
            WHERE c.id = :id
        """),
        {"id": updated[0]},
    )).first()
    return envelope(data=_row_to_dict(full))


@router_one.delete(
    "/{cid}",
    summary="댓글 삭제 — soft delete (작성자 OR admin)",
)
async def delete_comment(
    cid: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    row = (await s.execute(
        text("SELECT author_id FROM comments WHERE id = CAST(:id AS uuid)"),
        {"id": cid},
    )).first()
    if not row:
        raise NotFound("comment not found")
    is_author = str(row[0]) == user["id"]
    is_admin = user.get("role") == "admin"
    if not (is_author or is_admin):
        raise Forbidden("Only the author or an admin may delete a comment")

    await s.execute(
        text("""
            UPDATE comments SET status='deleted', updated_at=NOW()
            WHERE id = CAST(:id AS uuid)
        """),
        {"id": cid},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="comment.delete",
        target=f"comments/{cid}", payload={},
    )
    await s.commit()
    return Response(status_code=204)
