"""Reactions 라우터 — 문서/블록 단위 이모지 반응 (Cycle 0021).

Lightweight social signals separate from the comment thread.

  - POST  /api/v1/reactions                   (reader+) → 토글 insert/delete (201)
  - GET   /api/v1/documents/:slug/reactions   (reader+) → 집계 (doc + per-block)
  - GET   /api/v1/me/reactions/:slug          (reader+) → 현재 유저가 남긴 반응

Doc/block 작성자에게 `reaction_added` notification 을 INSERT 한다 (in_app 기본 on,
email 기본 off). 자기 자신이 자기 doc/block 에 단 반응에는 알림이 가지 않는다.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.db import get_db
from app.core.errors import APIError, NotFound, envelope
from app.services import notification_prefs as prefs_svc

router = APIRouter(prefix="/api/v1", tags=["reactions"])

# Allowed emoji codes — must match the migration CHECK + the FE ReactionBar.
EMOJI_CODES: tuple[str, ...] = (
    "thumbs-up",
    "heart",
    "thinking",
    "pray",
    "tada",
)


class ReactionValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


class ReactionIn(BaseModel):
    document_id: str = Field(..., min_length=1)
    block_id: str | None = Field(default=None, max_length=200)
    emoji: str = Field(...)


async def _resolve_doc(s: AsyncSession, doc_id_or_slug: str) -> tuple[str, str, str]:
    """Accept either a UUID or a slug; return (id, slug, owner_id)."""
    is_uuid = (
        isinstance(doc_id_or_slug, str)
        and len(doc_id_or_slug) == 36
        and doc_id_or_slug.count("-") == 4
    )
    if is_uuid:
        row = (await s.execute(
            text(
                "SELECT id, slug, owner_id FROM documents "
                "WHERE id = CAST(:v AS uuid)"
            ),
            {"v": doc_id_or_slug},
        )).first()
    else:
        row = (await s.execute(
            text("SELECT id, slug, owner_id FROM documents WHERE slug = :v"),
            {"v": doc_id_or_slug},
        )).first()
    if not row:
        raise NotFound(f"document '{doc_id_or_slug}' not found")
    return str(row[0]), row[1], str(row[2])


def _block_author_id(content: Any, block_id: str) -> str | None:
    """Best-effort lookup of `block.meta.author_id` for the matching ULID.

    The DocumentJSON tree is `sections[].blocks[]` with optional `subsections`.
    We walk recursively. Returns None if the block isn't found or has no
    `meta.author_id`.
    """
    if isinstance(content, str):
        try:
            content = json.loads(content)
        except json.JSONDecodeError:
            return None
    if not isinstance(content, dict):
        return None
    sections = content.get("sections") or []
    stack: list[Any] = list(sections)
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        for blk in node.get("blocks") or []:
            if not isinstance(blk, dict):
                continue
            if blk.get("id") == block_id:
                meta = blk.get("meta") or {}
                aid = meta.get("author_id") if isinstance(meta, dict) else None
                return str(aid) if aid else None
        for sub in node.get("subsections") or []:
            stack.append(sub)
    return None


async def _maybe_notify(
    s: AsyncSession,
    *,
    document_id: str,
    document_slug: str,
    doc_owner_id: str,
    block_id: str | None,
    emoji: str,
    actor_id: str,
) -> None:
    """Insert a `reaction_added` notification for the doc/block author."""
    target_user: str | None = None
    if block_id:
        row = (await s.execute(
            text("SELECT content_json FROM documents WHERE id = CAST(:d AS uuid)"),
            {"d": document_id},
        )).first()
        if row:
            target_user = _block_author_id(row[0], block_id)
        if not target_user:
            target_user = doc_owner_id
    else:
        target_user = doc_owner_id

    if not target_user or target_user == actor_id:
        return
    if not await prefs_svc.is_channel_enabled(
        s, user_id=target_user, kind="reaction_added", channel="in_app"
    ):
        return
    await s.execute(
        text("""
            INSERT INTO notifications (user_id, kind, payload)
            VALUES (
                CAST(:uid AS uuid),
                'reaction_added',
                CAST(:p AS jsonb)
            )
        """),
        {
            "uid": target_user,
            "p": json.dumps({
                "document_id": document_id,
                "slug": document_slug,
                "block_id": block_id,
                "emoji": emoji,
                "from_user_id": actor_id,
            }),
        },
    )


@router.post(
    "/reactions",
    status_code=201,
    summary="이모지 반응 토글 — 같은 emoji 가 이미 있으면 삭제, 없으면 INSERT",
)
async def toggle_reaction(
    body: ReactionIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    if body.emoji not in EMOJI_CODES:
        raise ReactionValidationError(
            f"emoji must be one of: {', '.join(EMOJI_CODES)}"
        )

    doc_id, slug, owner_id = await _resolve_doc(s, body.document_id)

    # Find existing row for (user, doc, block, emoji).
    if body.block_id is None:
        existing = (await s.execute(
            text("""
                SELECT id FROM reactions
                WHERE user_id = CAST(:u AS uuid)
                  AND document_id = CAST(:d AS uuid)
                  AND block_id IS NULL
                  AND emoji = :e
            """),
            {"u": user["id"], "d": doc_id, "e": body.emoji},
        )).first()
    else:
        existing = (await s.execute(
            text("""
                SELECT id FROM reactions
                WHERE user_id = CAST(:u AS uuid)
                  AND document_id = CAST(:d AS uuid)
                  AND block_id = :b
                  AND emoji = :e
            """),
            {
                "u": user["id"], "d": doc_id, "b": body.block_id,
                "e": body.emoji,
            },
        )).first()

    if existing:
        await s.execute(
            text("DELETE FROM reactions WHERE id = CAST(:id AS uuid)"),
            {"id": str(existing[0])},
        )
        await s.commit()
        return envelope(
            data={
                "removed": True,
                "id": str(existing[0]),
                "document_id": doc_id,
                "block_id": body.block_id,
                "emoji": body.emoji,
            }
        )

    row = (await s.execute(
        text("""
            INSERT INTO reactions (user_id, document_id, block_id, emoji)
            VALUES (CAST(:u AS uuid), CAST(:d AS uuid), :b, :e)
            RETURNING id, created_at
        """),
        {
            "u": user["id"], "d": doc_id, "b": body.block_id,
            "e": body.emoji,
        },
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row

    await _maybe_notify(
        s,
        document_id=doc_id,
        document_slug=slug,
        doc_owner_id=owner_id,
        block_id=body.block_id,
        emoji=body.emoji,
        actor_id=user["id"],
    )

    await s.commit()

    return envelope(
        data={
            "removed": False,
            "id": str(row[0]),
            "document_id": doc_id,
            "block_id": body.block_id,
            "emoji": body.emoji,
            "created_at": row[1].isoformat() if row[1] else None,
        }
    )


@router.get(
    "/documents/{slug}/reactions",
    summary="문서 + 블록별 반응 집계 — { doc: {...}, blocks: { id: {...} } }",
)
async def aggregate_reactions(
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    _ = user
    doc_id, _slug, _owner = await _resolve_doc(s, slug)
    rows = (await s.execute(
        text("""
            SELECT block_id, emoji, COUNT(*) AS cnt
            FROM reactions
            WHERE document_id = CAST(:d AS uuid)
            GROUP BY block_id, emoji
        """),
        {"d": doc_id},
    )).all()

    doc_counts: dict[str, int] = {}
    block_counts: dict[str, dict[str, int]] = {}
    for r in rows:
        block_id = r[0]
        emoji = r[1]
        cnt = int(r[2] or 0)
        if block_id is None:
            doc_counts[emoji] = cnt
        else:
            block_counts.setdefault(block_id, {})[emoji] = cnt

    return envelope(data={"doc": doc_counts, "blocks": block_counts})


@router.get(
    "/me/reactions/{slug}",
    summary="현재 유저가 이 문서/블록에 남긴 반응 — toggle 표시용",
)
async def my_reactions(
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    doc_id, _slug, _owner = await _resolve_doc(s, slug)
    rows = (await s.execute(
        text("""
            SELECT block_id, emoji
            FROM reactions
            WHERE document_id = CAST(:d AS uuid)
              AND user_id = CAST(:u AS uuid)
        """),
        {"d": doc_id, "u": user["id"]},
    )).all()

    doc_emojis: list[str] = []
    block_emojis: dict[str, list[str]] = {}
    for r in rows:
        block_id = r[0]
        emoji = r[1]
        if block_id is None:
            doc_emojis.append(emoji)
        else:
            block_emojis.setdefault(block_id, []).append(emoji)

    return envelope(data={"doc": doc_emojis, "blocks": block_emojis})
