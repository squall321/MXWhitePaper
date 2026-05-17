"""Comments 라우터 (Tier 2C → Threaded).

문서/섹션/블록 단위의 댓글 + 답글 트리 + 멘션.

  - POST   /api/v1/documents/:slug/comments       editor+  → 신규 댓글 (parent_id, mention_user_ids 지원)
  - GET    /api/v1/documents/:slug/comments                → 트리 조회 (replies 깊이 ≤ 3)
  - PATCH  /api/v1/comments/:id                            → 본문/상태 수정 (작성자 OR admin)
  - DELETE /api/v1/comments/:id                            → soft delete
  - POST   /api/v1/comments/:id/resolve                    → 스레드 전체 'resolved' 토글

audit_logs 에 모든 쓰기 이벤트가 기록되며, mention_user_ids 가 채워지면
notifications 테이블에 'comment_mention' 한 row 가 멘션 대상 별로 INSERT 된다.
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
from app.services import notification_prefs as prefs_svc
from app.services.document_service import fire_webhook

router_doc = APIRouter(prefix="/api/v1/documents", tags=["comments"])
router_one = APIRouter(prefix="/api/v1/comments", tags=["comments"])

# 답글 깊이 cap. parent → child → grandchild 까지만 (depth 0,1,2 → 3 levels).
MAX_REPLY_DEPTH = 3


class CommentIn(BaseModel):
    anchor_kind: str = Field(..., pattern="^(document|section|block)$")
    anchor_id: str | None = Field(default=None, max_length=200)
    body_md: str = Field(..., min_length=1, max_length=10_000)
    parent_id: str | None = Field(default=None)
    mention_user_ids: list[str] = Field(default_factory=list, max_length=20)


class CommentPatchIn(BaseModel):
    body_md: str | None = Field(default=None, max_length=10_000)
    status: str | None = Field(default=None, pattern="^(visible|hidden|deleted|resolved)$")


class CommentValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


def _row_to_dict(row: Any) -> dict[str, Any]:
    raw_mentions = row[10]
    if isinstance(raw_mentions, str):
        try:
            raw_mentions = json.loads(raw_mentions)
        except json.JSONDecodeError:
            raw_mentions = []
    if not isinstance(raw_mentions, list):
        raw_mentions = []
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
        "mention_user_ids": [str(x) for x in raw_mentions],
        "author_name": row[11],
        "author_email": row[12],
    }


_SELECT_COMMENT_COLUMNS = """
    SELECT c.id, c.document_id, c.anchor_kind, c.anchor_id, c.body_md,
           c.author_id, c.parent_id, c.status, c.created_at, c.updated_at,
           c.mention_user_ids, u.name, u.email
    FROM comments c JOIN users u ON u.id = c.author_id
"""


async def _resolve_doc_id(s: AsyncSession, slug: str) -> str:
    row = (await s.execute(
        text("SELECT id FROM documents WHERE slug = :slug AND status != 'archived'"),
        {"slug": slug},
    )).first()
    if not row:
        raise NotFound(f"document '{slug}' not found")
    return str(row[0])


async def _root_comment_id(s: AsyncSession, cid: str) -> str:
    """주어진 댓글의 스레드 root id (parent_id 가 NULL 인 조상)."""
    row = (await s.execute(
        text("""
            WITH RECURSIVE up AS (
              SELECT id, parent_id FROM comments
              WHERE id = CAST(:id AS uuid)
              UNION ALL
              SELECT c.id, c.parent_id FROM comments c
              JOIN up ON c.id = up.parent_id
            )
            SELECT id FROM up WHERE parent_id IS NULL LIMIT 1
        """),
        {"id": cid},
    )).first()
    if not row:
        # parent_id 무결성이 깨졌거나 cid 자체가 root.
        return cid
    return str(row[0])


def _build_tree(
    items: list[dict[str, Any]],
    *,
    max_depth: int = MAX_REPLY_DEPTH,
) -> list[dict[str, Any]]:
    """linear list → tree, depth cap 을 넘는 답글은 가장 깊은 허용 노드 밑에 평탄화."""
    by_id: dict[str, dict[str, Any]] = {}
    for it in items:
        by_id[it["id"]] = {**it, "replies": []}

    roots: list[dict[str, Any]] = []
    # 깊이 (root = 0) 캐시.
    depth: dict[str, int] = {}

    # 트리 순서를 입력 순서대로 (created_at ASC) 유지하기 위해 두 패스.
    # parent 가 먼저 추가됐을 거라는 보장이 ASC 정렬에서 성립한다.
    for it in items:
        node = by_id[it["id"]]
        pid = it.get("parent_id")
        if pid and pid in by_id:
            parent_depth = depth.get(pid, 0)
            target_depth = parent_depth + 1
            if target_depth >= max_depth:
                # cap 초과 → 가장 마지막 허용 조상 밑에 매단다.
                ancestor = pid
                while depth.get(ancestor, 0) >= max_depth - 1 and by_id[ancestor].get(
                    "parent_id"
                ) in by_id:
                    ancestor = by_id[ancestor]["parent_id"]
                by_id[ancestor]["replies"].append(node)
                depth[node["id"]] = depth.get(ancestor, 0) + 1
            else:
                by_id[pid]["replies"].append(node)
                depth[node["id"]] = target_depth
        else:
            roots.append(node)
            depth[node["id"]] = 0
    return roots


async def _insert_mention_notifications(
    s: AsyncSession,
    *,
    comment_id: str,
    document_id: str,
    document_slug: str,
    author_id: str,
    mention_user_ids: list[str],
) -> int:
    """멘션 대상 별로 notifications 1 row 씩 INSERT.

    자기 자신 멘션은 무시. UUID 형식이 아닌 값/존재하지 않는 user 는 skip.

    NOTE: rollback 을 피하려고 INSERT 전에 user 존재 여부를 미리 확인한다 —
    한 번의 FK 위반만 나도 현재 트랜잭션이 폐기되면서 같이 묶인 comment INSERT
    까지 무효가 되기 때문.
    """
    if not mention_user_ids:
        return 0
    inserted = 0
    seen: set[str] = set()
    for uid in mention_user_ids:
        if not isinstance(uid, str):
            continue
        u = uid.strip()
        if not u or u == author_id or u in seen:
            continue
        if not (len(u) == 36 and u.count("-") == 4):
            continue
        seen.add(u)
        # user 존재 사전 확인 — FK 위반으로 트랜잭션이 깨지지 않도록.
        exists = (await s.execute(
            text(
                "SELECT 1 FROM users WHERE id = CAST(:u AS uuid) AND is_active = TRUE"
            ),
            {"u": u},
        )).first()
        if not exists:
            continue
        # Honour the recipient's per-user notification_prefs.
        if not await prefs_svc.is_channel_enabled(
            s, user_id=u, kind="comment_mention", channel="in_app"
        ):
            continue
        await s.execute(
            text("""
                INSERT INTO notifications (user_id, kind, payload)
                VALUES (
                    CAST(:uid AS uuid),
                    'comment_mention',
                    CAST(:p AS jsonb)
                )
            """),
            {
                "uid": u,
                "p": json.dumps({
                    "comment_id": comment_id,
                    "document_id": document_id,
                    "slug": document_slug,
                    "from_user_id": author_id,
                }),
            },
        )
        inserted += 1
    return inserted


@router_doc.post(
    "/{slug}/comments",
    status_code=201,
    summary="댓글 작성 (editor+) — parent_id, mention_user_ids 지원",
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

    mentions_json = json.dumps(body.mention_user_ids or [])
    row = (await s.execute(
        text("""
            INSERT INTO comments
              (document_id, anchor_kind, anchor_id, body_md, author_id,
               parent_id, mention_user_ids)
            VALUES
              (CAST(:doc AS uuid), :ak, :aid, :bd, CAST(:au AS uuid),
               CAST(:pid AS uuid), CAST(:mn AS jsonb))
            RETURNING id
        """),
        {
            "doc": doc_id, "ak": body.anchor_kind, "aid": body.anchor_id,
            "bd": body.body_md, "au": actor_id, "pid": body.parent_id,
            "mn": mentions_json,
        },
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row
    new_id = str(row[0])

    await document_repo.insert_audit(
        s, user_id=actor_id, action="comment.create",
        target=f"comments/{new_id}",
        payload={
            "document_id": doc_id,
            "anchor_kind": body.anchor_kind,
            "mention_count": len(body.mention_user_ids or []),
        },
    )

    # 멘션 대상에게 알림 INSERT
    if body.mention_user_ids:
        await _insert_mention_notifications(
            s,
            comment_id=new_id,
            document_id=doc_id,
            document_slug=slug,
            author_id=actor_id,
            mention_user_ids=body.mention_user_ids,
        )

    await s.commit()

    full = (await s.execute(
        text(f"{_SELECT_COMMENT_COLUMNS} WHERE c.id = CAST(:id AS uuid)"),
        {"id": new_id},
    )).first()

    # Webhook fan-out — `comment_added`. Resolve part_id once for filtering.
    part_row = (await s.execute(
        text("SELECT part_id FROM documents WHERE id = CAST(:d AS uuid)"),
        {"d": doc_id},
    )).first()
    part_id = str(part_row[0]) if part_row and part_row[0] else None
    await fire_webhook(
        "comment_added",
        {
            "event": "comment_added",
            "document_id": doc_id,
            "slug": slug,
            "comment_id": new_id,
            "anchor_kind": body.anchor_kind,
            "anchor_id": body.anchor_id,
            "author_user_id": actor_id,
            "body_md": body.body_md,
        },
        target_part_id=part_id,
    )

    return envelope(data=_row_to_dict(full))


@router_doc.get(
    "/{slug}/comments",
    summary="댓글 트리 조회 (anchor 별 그룹 + replies, depth ≤ 3)",
)
async def list_comments(
    slug: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    _ = user
    doc_id = await _resolve_doc_id(s, slug)
    rows = (await s.execute(
        text(f"""
            {_SELECT_COMMENT_COLUMNS}
            WHERE c.document_id = CAST(:doc AS uuid)
            ORDER BY c.created_at ASC
        """),
        {"doc": doc_id},
    )).all()
    items = [_row_to_dict(r) for r in rows]
    tree = _build_tree(items, max_depth=MAX_REPLY_DEPTH)

    # anchor 별 그룹핑 (root 노드만)
    by_anchor: dict[str, list[dict[str, Any]]] = {}
    for node in tree:
        key = f"{node['anchor_kind']}:{node['anchor_id'] or ''}"
        by_anchor.setdefault(key, []).append(node)

    return envelope(
        data={"items": items, "tree": tree, "by_anchor": by_anchor},
        meta={"count": len(items), "thread_count": len(tree)},
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
            RETURNING id
        """),
        params,
    )).first()
    assert updated is not None  # existence verified above at line 380

    await document_repo.insert_audit(
        s, user_id=user["id"], action="comment.update",
        target=f"comments/{cid}",
        payload={k: v for k, v in body.model_dump().items() if v is not None},
    )
    await s.commit()

    full = (await s.execute(
        text(f"{_SELECT_COMMENT_COLUMNS} WHERE c.id = CAST(:id AS uuid)"),
        {"id": updated[0]},
    )).first()
    assert full is not None  # row just updated in the same transaction
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


class ResolveIn(BaseModel):
    resolved: bool = True


@router_one.post(
    "/{cid}/resolve",
    summary="스레드 resolve 토글 (어느 댓글 id 든 root 로 올라가 status 갱신)",
)
async def resolve_thread(
    cid: str,
    body: ResolveIn | None = None,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    row = (await s.execute(
        text("SELECT id FROM comments WHERE id = CAST(:id AS uuid)"),
        {"id": cid},
    )).first()
    if not row:
        raise NotFound("comment not found")

    root_id = await _root_comment_id(s, cid)
    target_status = "resolved" if (body is None or body.resolved) else "visible"

    await s.execute(
        text("""
            UPDATE comments SET status = :st, updated_at = NOW()
            WHERE id = CAST(:rid AS uuid)
        """),
        {"rid": root_id, "st": target_status},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action=f"comment.{target_status}",
        target=f"comments/{root_id}",
        payload={"triggered_by": cid},
    )
    await s.commit()

    full = (await s.execute(
        text(f"{_SELECT_COMMENT_COLUMNS} WHERE c.id = CAST(:id AS uuid)"),
        {"id": root_id},
    )).first()
    return envelope(data=_row_to_dict(full))
