"""Series router — document series / book navigation.

A "series" (책 / 시리즈) groups N documents in a fixed order so readers can
walk a multi-part procedure manual or training course with prev/next links.

Endpoints (all prefixed `/api/v1`):

  - POST   /series                            (editor+) → 201 series detail
        Body: { slug, title, description?, cover_image_id? }

  - GET    /series                            (reader+) — list with first item
        title for preview.

  - GET    /series/{slug}                     (reader+) — detail with
        `items: [{document_id, slug, title, position}]`.

  - PATCH  /series/{slug}                     (owner | admin) — partial update.

  - DELETE /series/{slug}                     (owner | admin) — 204.

  - POST   /series/{slug}/items               (editor+) — add doc; position
        defaults to last.

  - DELETE /series/{slug}/items/{document_id} (editor+) — remove.

  - PATCH  /series/{slug}/items/{document_id} (editor+) — reorder.

  - GET    /documents/{slug}/series           (reader+) — list series this doc
        belongs to + neighbor docs (prev/next within each series).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor, require_reader
from app.core.db import get_db
from app.core.errors import APIError, Conflict, Forbidden, NotFound, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["series"])


class SeriesValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


# ── Pydantic bodies ─────────────────────────────────────────────────────


class SeriesIn(BaseModel):
    slug: str = Field(..., min_length=1, max_length=200)
    title: str = Field(..., min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    cover_image_id: str | None = Field(default=None, max_length=200)


class SeriesPatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    cover_image_id: str | None = Field(default=None, max_length=200)


class SeriesItemIn(BaseModel):
    document_id: str = Field(..., min_length=1)
    position: int | None = Field(default=None, ge=0)


class SeriesItemPatchIn(BaseModel):
    position: int = Field(..., ge=0)


# ── helpers ─────────────────────────────────────────────────────────────


async def _fetch_series_by_slug(
    s: AsyncSession, slug: str
) -> dict[str, Any] | None:
    row = (await s.execute(
        text("""
            SELECT id, slug, title, description, cover_image_id,
                   owner_user_id, created_at, updated_at
            FROM doc_series
            WHERE slug = :slug
        """),
        {"slug": slug},
    )).first()
    if not row:
        return None
    return {
        "id": str(row[0]),
        "slug": row[1],
        "title": row[2],
        "description": row[3],
        "cover_image_id": row[4],
        "owner_user_id": str(row[5]),
        "created_at": row[6].isoformat() if row[6] else None,
        "updated_at": row[7].isoformat() if row[7] else None,
    }


async def _require_series(s: AsyncSession, slug: str) -> dict[str, Any]:
    found = await _fetch_series_by_slug(s, slug)
    if not found:
        raise NotFound(f"series not found: {slug}")
    return found


async def _list_items(s: AsyncSession, series_id: str) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text("""
            SELECT i.document_id, i.position, i.added_at,
                   d.slug, d.title
            FROM doc_series_items i
            JOIN documents d ON d.id = i.document_id
            WHERE i.series_id = CAST(:sid AS uuid)
            ORDER BY i.position ASC, i.added_at ASC
        """),
        {"sid": series_id},
    )).all()
    return [
        {
            "document_id": str(r[0]),
            "position": int(r[1]),
            "added_at": r[2].isoformat() if r[2] else None,
            "slug": r[3],
            "title": r[4],
        }
        for r in rows
    ]


def _ensure_owner_or_admin(series: dict[str, Any], user: dict[str, Any]) -> None:
    if series["owner_user_id"] == user["id"]:
        return
    if user.get("role") == "admin":
        return
    raise Forbidden("only the series owner or admin may modify this series")


# ── series CRUD ─────────────────────────────────────────────────────────


@router.post("/series", status_code=201, summary="시리즈 생성 (editor+)")
async def create_series(
    body: SeriesIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    slug = body.slug.strip()
    title = body.title.strip()
    if not slug or not title:
        raise SeriesValidationError("slug and title are required")
    desc = body.description.strip() if body.description else None
    cover = body.cover_image_id.strip() if body.cover_image_id else None
    try:
        row = (await s.execute(
            text("""
                INSERT INTO doc_series
                  (slug, title, description, cover_image_id, owner_user_id)
                VALUES (:slug, :title, :desc, :cover, CAST(:u AS uuid))
                RETURNING id
            """),
            {
                "slug": slug,
                "title": title,
                "desc": desc,
                "cover": cover,
                "u": user["id"],
            },
        )).first()
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(f"series slug already exists: {slug}") from e
    assert row is not None  # INSERT...RETURNING always emits one row
    str(row[0])
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="series.create",
        target=f"series/{slug}",
        payload={"title": title},
    )
    await s.commit()
    series = await _fetch_series_by_slug(s, slug)
    assert series is not None
    return envelope(data={**series, "items": []})


@router.get("/series", summary="시리즈 목록 (reader+)")
async def list_series(
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(text("""
        SELECT
          ds.id, ds.slug, ds.title, ds.description, ds.cover_image_id,
          ds.owner_user_id, ds.created_at, ds.updated_at,
          (SELECT COUNT(*) FROM doc_series_items i WHERE i.series_id = ds.id)
            AS item_count,
          (SELECT d.title
             FROM doc_series_items i
             JOIN documents d ON d.id = i.document_id
            WHERE i.series_id = ds.id
            ORDER BY i.position ASC, i.added_at ASC LIMIT 1) AS first_title
        FROM doc_series ds
        ORDER BY ds.updated_at DESC
    """))).all()
    items = [
        {
            "id": str(r[0]),
            "slug": r[1],
            "title": r[2],
            "description": r[3],
            "cover_image_id": r[4],
            "owner_user_id": str(r[5]),
            "created_at": r[6].isoformat() if r[6] else None,
            "updated_at": r[7].isoformat() if r[7] else None,
            "item_count": int(r[8] or 0),
            "first_item_title": r[9],
        }
        for r in rows
    ]
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.get("/series/{slug}", summary="시리즈 상세 (reader+)")
async def get_series(
    slug: str,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    series = await _require_series(s, slug)
    items = await _list_items(s, series["id"])
    return envelope(data={**series, "items": items})


@router.patch("/series/{slug}", summary="시리즈 수정 (owner | admin)")
async def patch_series(
    slug: str,
    body: SeriesPatchIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    series = await _require_series(s, slug)
    _ensure_owner_or_admin(series, user)

    fields = body.model_dump(exclude_unset=True)
    sets: list[str] = []
    params: dict[str, Any] = {"id": series["id"]}
    if "title" in fields:
        v = (fields["title"] or "").strip()
        if not v:
            raise SeriesValidationError("title cannot be empty")
        sets.append("title = :title")
        params["title"] = v
    if "description" in fields:
        v = fields["description"]
        sets.append("description = :desc")
        params["desc"] = (
            v.strip() if isinstance(v, str) and v.strip() else None
        )
    if "cover_image_id" in fields:
        v = fields["cover_image_id"]
        sets.append("cover_image_id = :cover")
        params["cover"] = (
            v.strip() if isinstance(v, str) and v.strip() else None
        )
    if not sets:
        raise SeriesValidationError("nothing to update")
    sets.append("updated_at = NOW()")

    await s.execute(
        text(
            f"UPDATE doc_series SET {', '.join(sets)} "
            "WHERE id = CAST(:id AS uuid)"
        ),
        params,
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="series.update",
        target=f"series/{slug}",
        payload=fields,
    )
    await s.commit()
    fresh = await _fetch_series_by_slug(s, slug)
    assert fresh is not None
    items = await _list_items(s, fresh["id"])
    return envelope(data={**fresh, "items": items})


@router.delete(
    "/series/{slug}", status_code=204, summary="시리즈 삭제 (owner | admin)"
)
async def delete_series(
    slug: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    series = await _require_series(s, slug)
    _ensure_owner_or_admin(series, user)
    await s.execute(
        text("DELETE FROM doc_series WHERE id = CAST(:id AS uuid)"),
        {"id": series["id"]},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="series.delete",
        target=f"series/{slug}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


# ── series item ops ─────────────────────────────────────────────────────


@router.post(
    "/series/{slug}/items",
    status_code=201,
    summary="시리즈에 문서 추가 (editor+)",
)
async def add_series_item(
    slug: str,
    body: SeriesItemIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    series = await _require_series(s, slug)

    doc_id = body.document_id.strip()
    if len(doc_id) != 36 or doc_id.count("-") != 4:
        raise SeriesValidationError("document_id must be a UUID")

    doc = await document_repo.find_by_id(s, doc_id)
    if not doc:
        raise NotFound(f"document not found: {doc_id}")

    # Determine target position. None → append to the end.
    if body.position is None:
        last = (await s.execute(
            text("""
                SELECT COALESCE(MAX(position), -1) FROM doc_series_items
                WHERE series_id = CAST(:sid AS uuid)
            """),
            {"sid": series["id"]},
        )).first()
        assert last is not None  # aggregate query always returns one row
        position = int(last[0]) + 1
    else:
        position = body.position

    try:
        await s.execute(
            text("""
                INSERT INTO doc_series_items
                  (series_id, document_id, position)
                VALUES (CAST(:sid AS uuid), CAST(:did AS uuid), :pos)
            """),
            {"sid": series["id"], "did": doc_id, "pos": position},
        )
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(
            f"document already in series: {doc['slug']}"
        ) from e

    # Bump series updated_at so list ordering reflects activity.
    await s.execute(
        text(
            "UPDATE doc_series SET updated_at = NOW() "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": series["id"]},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="series.item_added",
        target=f"series/{slug}",
        payload={"document_id": doc_id, "position": position},
    )
    await s.commit()
    items = await _list_items(s, series["id"])
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.delete(
    "/series/{slug}/items/{document_id}",
    status_code=204,
    summary="시리즈에서 문서 제거 (editor+)",
)
async def remove_series_item(
    slug: str,
    document_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> Response:
    series = await _require_series(s, slug)
    await s.execute(
        text("""
            DELETE FROM doc_series_items
            WHERE series_id = CAST(:sid AS uuid)
              AND document_id = CAST(:did AS uuid)
        """),
        {"sid": series["id"], "did": document_id},
    )
    await s.execute(
        text(
            "UPDATE doc_series SET updated_at = NOW() "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": series["id"]},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="series.item_removed",
        target=f"series/{slug}",
        payload={"document_id": document_id},
    )
    await s.commit()
    return Response(status_code=204)


@router.patch(
    "/series/{slug}/items/{document_id}",
    summary="시리즈 항목 위치 변경 (editor+)",
)
async def reorder_series_item(
    slug: str,
    document_id: str,
    body: SeriesItemPatchIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    series = await _require_series(s, slug)
    row = (await s.execute(
        text("""
            UPDATE doc_series_items
               SET position = :pos
             WHERE series_id = CAST(:sid AS uuid)
               AND document_id = CAST(:did AS uuid)
            RETURNING document_id
        """),
        {"sid": series["id"], "did": document_id, "pos": body.position},
    )).first()
    if not row:
        raise NotFound("series item not found")
    await s.execute(
        text(
            "UPDATE doc_series SET updated_at = NOW() "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": series["id"]},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="series.item_reordered",
        target=f"series/{slug}",
        payload={"document_id": document_id, "position": body.position},
    )
    await s.commit()
    items = await _list_items(s, series["id"])
    return envelope(data={"items": items}, meta={"count": len(items)})


# ── per-document series view (with neighbours) ───────────────────────────


@router.get(
    "/documents/{slug}/series",
    summary="이 문서가 속한 시리즈 + 이웃 (reader+)",
)
async def list_document_series(
    slug: str,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc:
        raise NotFound(f"document not found: {slug}")

    rows = (await s.execute(
        text("""
            SELECT ds.id, ds.slug, ds.title, ds.description,
                   ds.cover_image_id, i.position
            FROM doc_series_items i
            JOIN doc_series ds ON ds.id = i.series_id
            WHERE i.document_id = CAST(:did AS uuid)
            ORDER BY ds.title
        """),
        {"did": doc["id"]},
    )).all()

    out: list[dict[str, Any]] = []
    for r in rows:
        series_id = str(r[0])
        all_items = await _list_items(s, series_id)
        cur_pos = int(r[5])
        prev_item = next(
            (it for it in reversed(all_items) if it["position"] < cur_pos),
            None,
        )
        next_item = next(
            (it for it in all_items if it["position"] > cur_pos), None
        )
        out.append({
            "id": series_id,
            "slug": r[1],
            "title": r[2],
            "description": r[3],
            "cover_image_id": r[4],
            "position": cur_pos,
            "total": len(all_items),
            "prev": (
                {"slug": prev_item["slug"], "title": prev_item["title"]}
                if prev_item else None
            ),
            "next": (
                {"slug": next_item["slug"], "title": next_item["title"]}
                if next_item else None
            ),
        })

    return envelope(data={"items": out}, meta={"count": len(out)})
