"""Saved views (smart folders) 라우터 — Cycle 0030.

사용자가 검색 필터(부서/태그/작성자/날짜 범위/상태/freeform 쿼리)를 이름과
함께 저장해 두고, 좌측 사이드바 "📂 내 보기" 섹션에서 한 번에 다시 적용할 수
있게 한다. AppShell 좌측에서 클릭하면 `/views/:id` 디테일 페이지가 열리고,
저장된 필터가 다시 적용된 결과 리스트가 그려진다.

Endpoints (모두 `/api/v1` prefix):

  - POST   /me/saved-views                       (reader+) → 201
        Body: { name, icon?, filters? }
  - GET    /me/saved-views                       (reader+) → 본인 view 목록
  - PATCH  /me/saved-views/{id}                  (the user)→ 200
        Body: { name?, icon?, filters?, ordering? }
  - DELETE /me/saved-views/{id}                  (the user)→ 204
  - GET    /me/saved-views/{id}/results          (reader+) → 필터를 documents 에
        적용한 결과 리스트 + 메타. ?limit= ?offset= 지원.

`filters` JSON 형:

    {
      part?:   string,  // parts.slug 매칭
      tag?:    string,  // tags.name 매칭 (document_tags 조인)
      author?: string,  // users.id (UUID) 또는 email
      from?:   string,  // YYYY-MM-DD updated_at 하한
      to?:     string,  // YYYY-MM-DD updated_at 상한
      q?:      string,  // 제목/요약 ILIKE
      status?: string   // draft|published|archived
    }

쓰기 모두 audit_logs 에 기록한다.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_reader
from app.core.db import get_db
from app.core.errors import Forbidden, NotFound, ValidationFailed, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["saved-views"])

_UUID_LEN = 36
_UUID_DASHES = 4
_MAX_NAME = 120
_MAX_ICON = 16
_ALLOWED_FILTER_KEYS = {"part", "tag", "author", "from", "to", "q", "status"}
_ALLOWED_STATUS = {"draft", "published", "archived"}


def _is_uuid(s: str) -> bool:
    return isinstance(s, str) and len(s) == _UUID_LEN and s.count("-") == _UUID_DASHES


def _parse_date(value: Any) -> str | None:
    """YYYY-MM-DD 만 허용 — 잘못된 값은 None 으로 떨어뜨려 무시."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d")
    except ValueError:
        return None


def _normalise_filters(raw: Any) -> dict[str, Any]:
    """알 수 없는 키는 버리고, 빈 문자열은 제거한다.

    Pydantic 의 자동 변환에 맡기지 않고 명시적으로 화이트리스트 + strip 처리.
    422 가 필요한 케이스(상태가 enum 밖)는 여기서 raise.
    """
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValidationFailed("filters must be an object")
    out: dict[str, Any] = {}
    for k, v in raw.items():
        if k not in _ALLOWED_FILTER_KEYS:
            continue
        if v is None:
            continue
        if isinstance(v, str):
            v = v.strip()
            if not v:
                continue
        out[k] = v
    if "status" in out and out["status"] not in _ALLOWED_STATUS:
        raise ValidationFailed(
            f"status must be one of {sorted(_ALLOWED_STATUS)}",
            details={"got": out["status"]},
        )
    return out


def _row_to_view(row: Any) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "user_id": str(row[1]),
        "name": row[2],
        "icon": row[3],
        "filters": row[4] or {},
        "ordering": int(row[5]) if row[5] is not None else 0,
        "created_at": row[6].isoformat() if row[6] else None,
        "updated_at": row[7].isoformat() if row[7] else None,
    }


# ── Pydantic input models ───────────────────────────────────────────────


class CreateSavedViewIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=_MAX_NAME)
    icon: str | None = Field(default=None, max_length=_MAX_ICON)
    filters: dict[str, Any] | None = Field(default=None)


class PatchSavedViewIn(BaseModel):
    name: str | None = Field(default=None, max_length=_MAX_NAME)
    icon: str | None = Field(default=None, max_length=_MAX_ICON)
    filters: dict[str, Any] | None = Field(default=None)
    ordering: int | None = Field(default=None)


# ── POST /me/saved-views ─────────────────────────────────────────────────


@router.post(
    "/me/saved-views",
    status_code=201,
    summary="저장된 뷰 생성 (reader+)",
)
async def create_saved_view(
    body: CreateSavedViewIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise ValidationFailed("name required")
    icon = (body.icon or "").strip() or None
    filters = _normalise_filters(body.filters)

    row = (await s.execute(
        text(
            """
            INSERT INTO saved_views (user_id, name, icon, filters)
            VALUES (CAST(:u AS uuid), :n, :i, CAST(:f AS jsonb))
            RETURNING id, user_id, name, icon, filters, ordering,
                      created_at, updated_at
            """
        ),
        {
            "u": user["id"],
            "n": name,
            "i": icon,
            "f": _jsonb(filters),
        },
    )).first()
    sv_id = str(row[0])

    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="saved_view.create",
        target=f"saved_views/{sv_id}",
        payload={"name": name, "filters": filters},
    )
    await s.commit()
    return envelope(data=_row_to_view(row))


# ── GET /me/saved-views ──────────────────────────────────────────────────


@router.get("/me/saved-views", summary="내 저장된 뷰 목록 (reader+)")
async def list_saved_views(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text(
            """
            SELECT id, user_id, name, icon, filters, ordering,
                   created_at, updated_at
            FROM saved_views
            WHERE user_id = CAST(:u AS uuid)
            ORDER BY ordering ASC, created_at ASC
            """
        ),
        {"u": user["id"]},
    )).all()
    items = [_row_to_view(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


# ── PATCH /me/saved-views/{id} ───────────────────────────────────────────


@router.patch(
    "/me/saved-views/{sv_id}",
    summary="저장된 뷰 수정 (본인)",
)
async def patch_saved_view(
    body: PatchSavedViewIn,
    sv_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not _is_uuid(sv_id):
        raise NotFound("saved view not found")
    row = (await s.execute(
        text("SELECT user_id FROM saved_views WHERE id = CAST(:id AS uuid)"),
        {"id": sv_id},
    )).first()
    if not row:
        raise NotFound("saved view not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("Only the owner may edit this saved view")

    fields = body.model_dump(exclude_unset=True)
    sets: list[str] = []
    params: dict[str, Any] = {"id": sv_id}
    if "name" in fields and fields["name"] is not None:
        n = (fields["name"] or "").strip()
        if not n:
            raise ValidationFailed("name must not be empty")
        sets.append("name = :n")
        params["n"] = n
    if "icon" in fields:
        v = fields["icon"]
        sets.append("icon = :i")
        params["i"] = (v.strip() if isinstance(v, str) and v.strip() else None)
    if "filters" in fields:
        f = _normalise_filters(fields["filters"])
        sets.append("filters = CAST(:f AS jsonb)")
        params["f"] = _jsonb(f)
    if "ordering" in fields and fields["ordering"] is not None:
        try:
            params["o"] = int(fields["ordering"])
        except (TypeError, ValueError) as e:
            raise ValidationFailed("ordering must be an integer") from e
        sets.append("ordering = :o")
    if not sets:
        raise ValidationFailed("nothing to update")
    sets.append("updated_at = NOW()")

    full = (await s.execute(
        text(
            f"""
            UPDATE saved_views SET {", ".join(sets)}
            WHERE id = CAST(:id AS uuid)
            RETURNING id, user_id, name, icon, filters, ordering,
                      created_at, updated_at
            """
        ),
        params,
    )).first()

    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="saved_view.update",
        target=f"saved_views/{sv_id}",
        payload={k: v for k, v in fields.items()},
    )
    await s.commit()
    return envelope(data=_row_to_view(full))


# ── DELETE /me/saved-views/{id} ──────────────────────────────────────────


@router.delete(
    "/me/saved-views/{sv_id}",
    summary="저장된 뷰 삭제 (본인)",
)
async def delete_saved_view(
    sv_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    if not _is_uuid(sv_id):
        raise NotFound("saved view not found")
    row = (await s.execute(
        text("SELECT user_id FROM saved_views WHERE id = CAST(:id AS uuid)"),
        {"id": sv_id},
    )).first()
    if not row:
        raise NotFound("saved view not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("Only the owner may delete this saved view")

    await s.execute(
        text("DELETE FROM saved_views WHERE id = CAST(:id AS uuid)"),
        {"id": sv_id},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="saved_view.delete",
        target=f"saved_views/{sv_id}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


# ── GET /me/saved-views/{id}/results ─────────────────────────────────────


@router.get(
    "/me/saved-views/{sv_id}/results",
    summary="저장된 뷰 결과 — 필터를 documents 에 적용 (reader+)",
)
async def get_saved_view_results(
    sv_id: str = Path(..., min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    if not _is_uuid(sv_id):
        raise NotFound("saved view not found")
    row = (await s.execute(
        text(
            "SELECT user_id, name, filters FROM saved_views "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": sv_id},
    )).first()
    if not row:
        raise NotFound("saved view not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("Only the owner may view results of this saved view")
    filters: dict[str, Any] = row[2] or {}
    items, total = await _apply_filters_to_documents(
        s, filters=filters, limit=limit, offset=offset, current_user_id=user["id"],
    )
    return envelope(
        data={"items": items},
        meta={
            "count": len(items),
            "total": total,
            "limit": limit,
            "offset": offset,
            "name": row[1],
            "filters": filters,
        },
    )


# ── helpers ──────────────────────────────────────────────────────────────


def _jsonb(d: dict[str, Any]) -> str:
    """JSON-serialise for a JSONB cast. asyncpg accepts a TEXT and CASTs."""
    import json as _json

    return _json.dumps(d, ensure_ascii=False)


async def _apply_filters_to_documents(
    s: AsyncSession,
    *,
    filters: dict[str, Any],
    limit: int,
    offset: int,
    current_user_id: str,
) -> tuple[list[dict[str, Any]], int]:
    """Translate the saved-view filter dict into a parameterised SELECT.

    All clauses are ANDed. Unknown / blank values are dropped silently so a
    half-complete filter still returns a sensible list. Author may be a UUID
    (matched against users.id) or an email; both are looked up against users.
    """
    where: list[str] = []
    params: dict[str, Any] = {"lim": limit, "off": offset}
    join = ""

    status = filters.get("status")
    if status in _ALLOWED_STATUS:
        where.append("d.status = :status")
        params["status"] = status
    else:
        # default — never include archived docs in saved-view results.
        where.append("d.status != 'archived'")

    part = filters.get("part")
    if isinstance(part, str) and part.strip():
        join += " JOIN parts p ON p.id = d.part_id "
        where.append("p.slug = :part_slug")
        params["part_slug"] = part.strip()

    tag = filters.get("tag")
    if isinstance(tag, str) and tag.strip():
        join += (
            " JOIN document_tags dt ON dt.document_id = d.id "
            " JOIN tags tg ON tg.id = dt.tag_id "
        )
        where.append("tg.name = :tag")
        params["tag"] = tag.strip()

    author = filters.get("author")
    if isinstance(author, str) and author.strip():
        a = author.strip()
        if _is_uuid(a):
            where.append("d.owner_id = CAST(:author AS uuid)")
            params["author"] = a
        else:
            # treat as email — resolve once via subquery
            where.append(
                "d.owner_id = (SELECT id FROM users WHERE email = :author)"
            )
            params["author"] = a

    df = _parse_date(filters.get("from"))
    if df:
        where.append("d.updated_at >= CAST(:date_from AS timestamptz)")
        params["date_from"] = df
    dt = _parse_date(filters.get("to"))
    if dt:
        # to-bound is end-of-day inclusive — add 1 day and use `<`.
        where.append("d.updated_at < CAST(:date_to AS timestamptz) + INTERVAL '1 day'")
        params["date_to"] = dt

    q = filters.get("q")
    if isinstance(q, str) and q.strip():
        where.append("(d.title ILIKE :q OR COALESCE(d.summary,'') ILIKE :q)")
        params["q"] = f"%{q.strip()}%"

    where_sql = " WHERE " + " AND ".join(where) if where else ""

    # `current_user_id` is currently unused for ACL — saved views are private to
    # their owner and the upstream router already enforces ownership. The arg is
    # kept on the signature so future tightening (org-scoped, RLS) is a
    # one-liner.
    _ = current_user_id

    rows = (await s.execute(
        text(
            f"""
            SELECT d.id, d.slug, d.title, d.summary, d.status,
                   d.updated_at, d.owner_id, d.part_id
            FROM documents d {join}
            {where_sql}
            ORDER BY d.updated_at DESC
            LIMIT :lim OFFSET :off
            """
        ),
        params,
    )).all()
    items = [
        {
            "id": str(r[0]),
            "slug": r[1],
            "title": r[2],
            "summary": r[3],
            "status": r[4],
            "updated_at": r[5].isoformat() if r[5] else None,
            "owner_id": str(r[6]) if r[6] else None,
            "part_id": str(r[7]) if r[7] else None,
        }
        for r in rows
    ]

    total = (await s.execute(
        text(
            f"""
            SELECT COUNT(*) FROM documents d {join} {where_sql}
            """
        ),
        {k: v for k, v in params.items() if k not in {"lim", "off"}},
    )).scalar_one()
    return items, int(total)
