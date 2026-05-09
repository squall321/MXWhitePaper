"""Snippets 라우터 — 재사용 가능한 블록 라이브러리.

  - POST   /api/v1/snippets                (editor+) → 신규 스니펫 (201)
  - GET    /api/v1/snippets?scope=&q=&...  (reader+) → 본인 + 접근 가능 목록
  - GET    /api/v1/snippets/{id}           (reader+) → 본문 + use_count++
  - PATCH  /api/v1/snippets/{id}           (owner)   → name/description/scope/tags
  - DELETE /api/v1/snippets/{id}           (owner|admin) → 204
  - POST   /api/v1/snippets/{id}/use       (reader+) → use_count++ (마커)

스코프 정책:
  private — 작성자만.
  team    — 같은 users.team_id (없으면 'org' 와 동일하게 폴백).
  org     — 모든 활성 사용자.

블록 본문은 JSONB array. 스키마는 DocumentJSON Block 과 동일하나,
본문 자체는 BE 가 검증하지 않는다 — FE 에서 이미 selection 으로 검증된 채로 들어옴.
다만 빈 배열은 거부한다 (의미 없음).
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor, require_reader
from app.core.db import get_db
from app.core.errors import APIError, Forbidden, NotFound, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["snippets"])


class SnippetValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


_VALID_SCOPES = {"private", "team", "org"}


class SnippetIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    blocks: list[dict[str, Any]] = Field(..., min_length=1)
    scope: str = Field(default="private")
    tags: list[str] = Field(default_factory=list)


class SnippetPatchIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    scope: str | None = Field(default=None)
    tags: list[str] | None = Field(default=None)


_UUID_LEN = 36
_UUID_DASHES = 4


def _is_uuid(s: str) -> bool:
    return isinstance(s, str) and len(s) == _UUID_LEN and s.count("-") == _UUID_DASHES


def _check_scope(value: str) -> None:
    if value not in _VALID_SCOPES:
        raise SnippetValidationError(
            f"scope must be one of {sorted(_VALID_SCOPES)}"
        )


def _summary_row(row: Any) -> dict[str, Any]:
    """List item — does NOT include the heavy `blocks` payload."""
    blocks = row[5]
    if isinstance(blocks, str):
        try:
            parsed = json.loads(blocks)
        except json.JSONDecodeError:
            parsed = []
    else:
        parsed = blocks or []
    block_count = len(parsed) if isinstance(parsed, list) else 0
    # 1-line preview from the first block's text-ish fields. Keep it cheap —
    # the manager grid renders dozens of these.
    preview = ""
    if isinstance(parsed, list) and parsed:
        first = parsed[0]
        if isinstance(first, dict):
            for k in ("text", "title", "code", "expression"):
                v = first.get(k)
                if isinstance(v, str) and v.strip():
                    preview = v.strip()[:160]
                    break
    tags = row[6]
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except json.JSONDecodeError:
            tags = []
    return {
        "id": str(row[0]),
        "owner_user_id": str(row[1]),
        "scope": row[2],
        "name": row[3],
        "description": row[4],
        "block_count": block_count,
        "preview": preview,
        "tags": tags or [],
        "use_count": int(row[7] or 0),
        "created_at": row[8].isoformat() if row[8] else None,
        "updated_at": row[9].isoformat() if row[9] else None,
    }


def _full_row(row: Any) -> dict[str, Any]:
    blocks = row[5]
    if isinstance(blocks, str):
        try:
            blocks = json.loads(blocks)
        except json.JSONDecodeError:
            blocks = []
    tags = row[6]
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except json.JSONDecodeError:
            tags = []
    return {
        "id": str(row[0]),
        "owner_user_id": str(row[1]),
        "scope": row[2],
        "name": row[3],
        "description": row[4],
        "blocks": blocks or [],
        "tags": tags or [],
        "use_count": int(row[7] or 0),
        "created_at": row[8].isoformat() if row[8] else None,
        "updated_at": row[9].isoformat() if row[9] else None,
    }


# ── CRUD ─────────────────────────────────────────────────────────────────


@router.post("/snippets", status_code=201, summary="스니펫 저장 (editor+)")
async def create_snippet(
    body: SnippetIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    _check_scope(body.scope)
    name = body.name.strip()
    if not name:
        raise SnippetValidationError("name required")
    desc = body.description.strip() if body.description else None
    tags_clean = [t.strip() for t in (body.tags or []) if t and t.strip()]

    row = (await s.execute(
        text("""
            INSERT INTO snippets (
              owner_user_id, scope, name, description, blocks, tags
            ) VALUES (
              CAST(:u AS uuid), :sc, :n, :d, CAST(:b AS JSONB), CAST(:t AS JSONB)
            )
            RETURNING id
        """),
        {
            "u": user["id"],
            "sc": body.scope,
            "n": name,
            "d": desc,
            "b": json.dumps(body.blocks, ensure_ascii=False),
            "t": json.dumps(tags_clean, ensure_ascii=False),
        },
    )).first()

    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="snippet.create",
        target=f"snippets/{row[0]}",
        payload={"scope": body.scope, "name": name, "block_count": len(body.blocks)},
    )
    await s.commit()
    return envelope(data={"snippet_id": str(row[0])})


@router.get("/snippets", summary="스니펫 목록 (reader+)")
async def list_snippets(
    scope: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    if scope is not None:
        _check_scope(scope)

    # Visibility: own + team (if team_id matches an OTHER snippet owner) + org.
    # Implemented as an EXISTS join on users so we don't have to denormalize team_id
    # onto snippets.
    sql = """
        SELECT s.id, s.owner_user_id, s.scope, s.name, s.description,
               s.blocks, s.tags, s.use_count, s.created_at, s.updated_at
        FROM snippets s
        WHERE (
            s.owner_user_id = CAST(:u AS uuid)
            OR s.scope = 'org'
            OR (
              s.scope = 'team'
              AND CAST(:tid AS uuid) IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM users u
                WHERE u.id = s.owner_user_id AND u.team_id = CAST(:tid AS uuid)
              )
            )
        )
    """
    params: dict[str, Any] = {
        "u": user["id"],
        "tid": user.get("team_id"),
    }
    if scope is not None:
        sql += " AND s.scope = :sc"
        params["sc"] = scope
    if q:
        sql += " AND (s.name ILIKE :q OR COALESCE(s.description,'') ILIKE :q)"
        params["q"] = f"%{q.strip()}%"
    sql += " ORDER BY s.updated_at DESC LIMIT :lim OFFSET :off"
    params["lim"] = limit
    params["off"] = offset

    rows = (await s.execute(text(sql), params)).all()
    items = [_summary_row(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


async def _fetch_with_visibility(
    s: AsyncSession, sid: str, user: dict[str, Any]
) -> tuple[Any, bool]:
    """Returns (row, can_read). Raises NotFound if missing."""
    row = (await s.execute(
        text("""
            SELECT s.id, s.owner_user_id, s.scope, s.name, s.description,
                   s.blocks, s.tags, s.use_count, s.created_at, s.updated_at
            FROM snippets s
            WHERE s.id = CAST(:id AS uuid)
        """),
        {"id": sid},
    )).first()
    if not row:
        raise NotFound("snippet not found")

    owner_id = str(row[1])
    scope = row[2]
    if owner_id == user["id"]:
        return row, True
    if scope == "org":
        return row, True
    if scope == "team":
        team_id = user.get("team_id")
        if not team_id:
            return row, False
        owner = (await s.execute(
            text("SELECT team_id FROM users WHERE id = CAST(:id AS uuid)"),
            {"id": owner_id},
        )).first()
        owner_team = owner[0] if owner else None
        if owner_team and str(owner_team) == team_id:
            return row, True
        return row, False
    # private and not the owner
    if user.get("role") == "admin":
        return row, True
    return row, False


@router.get("/snippets/{sid}", summary="스니펫 단건 조회 (reader+, use_count++)")
async def get_snippet(
    sid: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    if not _is_uuid(sid):
        raise NotFound("snippet not found")
    row, ok = await _fetch_with_visibility(s, sid, user)
    if not ok:
        raise Forbidden("not allowed to read this snippet")
    # Bump use_count + updated_at on each fetch (insert/use marker semantics).
    bumped = (await s.execute(
        text("""
            UPDATE snippets
               SET use_count = use_count + 1,
                   updated_at = NOW()
             WHERE id = CAST(:id AS uuid)
             RETURNING id, owner_user_id, scope, name, description,
                       blocks, tags, use_count, created_at, updated_at
        """),
        {"id": sid},
    )).first()
    await s.commit()
    return envelope(data=_full_row(bumped or row))


@router.patch("/snippets/{sid}", summary="스니펫 수정 (owner)")
async def patch_snippet(
    sid: str,
    body: SnippetPatchIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not _is_uuid(sid):
        raise NotFound("snippet not found")
    row = (await s.execute(
        text("SELECT owner_user_id FROM snippets WHERE id = CAST(:id AS uuid)"),
        {"id": sid},
    )).first()
    if not row:
        raise NotFound("snippet not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("only the owner may edit a snippet")

    sets: list[str] = []
    params: dict[str, Any] = {"id": sid}
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields:
        v = (fields["name"] or "").strip()
        if not v:
            raise SnippetValidationError("name cannot be empty")
        sets.append("name = :n")
        params["n"] = v
    if "description" in fields:
        v = fields["description"]
        sets.append("description = :d")
        params["d"] = (v.strip() if isinstance(v, str) and v.strip() else None)
    if "scope" in fields:
        sc = fields["scope"]
        if sc is None:
            raise SnippetValidationError("scope cannot be null")
        _check_scope(sc)
        sets.append("scope = :sc")
        params["sc"] = sc
    if "tags" in fields:
        tags_clean = [t.strip() for t in (fields["tags"] or []) if t and t.strip()]
        sets.append("tags = CAST(:t AS JSONB)")
        params["t"] = json.dumps(tags_clean, ensure_ascii=False)
    if not sets:
        raise SnippetValidationError("nothing to update")
    sets.append("updated_at = NOW()")

    full = (await s.execute(
        text(f"""
            UPDATE snippets SET {", ".join(sets)}
            WHERE id = CAST(:id AS uuid)
            RETURNING id, owner_user_id, scope, name, description,
                      blocks, tags, use_count, created_at, updated_at
        """),
        params,
    )).first()
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="snippet.update",
        target=f"snippets/{sid}",
        payload={k: v for k, v in fields.items() if k != "blocks"},
    )
    await s.commit()
    return envelope(data=_full_row(full))


@router.delete("/snippets/{sid}", summary="스니펫 삭제 (owner|admin)")
async def delete_snippet(
    sid: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    if not _is_uuid(sid):
        raise NotFound("snippet not found")
    row = (await s.execute(
        text("SELECT owner_user_id FROM snippets WHERE id = CAST(:id AS uuid)"),
        {"id": sid},
    )).first()
    if not row:
        raise NotFound("snippet not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("only the owner or admin may delete a snippet")

    await s.execute(
        text("DELETE FROM snippets WHERE id = CAST(:id AS uuid)"),
        {"id": sid},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="snippet.delete",
        target=f"snippets/{sid}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


@router.post("/snippets/{sid}/use", summary="사용 마커 — use_count 만 ++ (reader+)")
async def use_snippet(
    sid: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    if not _is_uuid(sid):
        raise NotFound("snippet not found")
    _, ok = await _fetch_with_visibility(s, sid, user)
    if not ok:
        raise Forbidden("not allowed to use this snippet")
    bumped = (await s.execute(
        text("""
            UPDATE snippets
               SET use_count = use_count + 1,
                   updated_at = NOW()
             WHERE id = CAST(:id AS uuid)
             RETURNING use_count
        """),
        {"id": sid},
    )).first()
    await s.commit()
    return envelope(data={"snippet_id": sid, "use_count": int(bumped[0])})
