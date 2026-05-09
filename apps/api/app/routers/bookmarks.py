"""Bookmarks + reads 라우터.

서버 영속 책갈피와 열람 기록.

  - POST   /api/v1/bookmarks                 (reader+) → 신규 책갈피 (201)
  - DELETE /api/v1/bookmarks/{id}            (owner)   → 삭제 (204)
  - GET    /api/v1/bookmarks?folder=         (reader+) → 책갈피 목록 (조인 슬러그/제목)
  - PATCH  /api/v1/bookmarks/{id}            (owner)   → folder/notes 수정
  - GET    /api/v1/bookmarks/folders         (reader+) → 폴더별 카운트
  - POST   /api/v1/reads                     (reader+) → 열람 기록 upsert (read_seconds 누적)
  - GET    /api/v1/reads/recent?limit=20     (reader+) → 최근 열람 문서

쓰기 전부 audit_logs 에 기록한다.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_reader
from app.core.db import get_db
from app.core.errors import APIError, Conflict, Forbidden, NotFound, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["bookmarks"])


class BookmarkValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


class BookmarkIn(BaseModel):
    document_id: str = Field(..., min_length=1)
    folder: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)


class BookmarkPatchIn(BaseModel):
    folder: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)


class ReadIn(BaseModel):
    document_id: str = Field(..., min_length=1)
    read_seconds: int = Field(..., ge=0, le=24 * 60 * 60)


_UUID_LEN = 36
_UUID_DASHES = 4


def _is_uuid(s: str) -> bool:
    return isinstance(s, str) and len(s) == _UUID_LEN and s.count("-") == _UUID_DASHES


def _bm_row(row: Any) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "document_id": str(row[1]),
        "slug": row[2],
        "title": row[3],
        "folder": row[4],
        "notes": row[5],
        "created_at": row[6].isoformat() if row[6] else None,
    }


async def _resolve_doc_id(s: AsyncSession, doc_id_or_slug: str) -> str:
    """document_id 가 UUID 가 아니라 slug 로 들어와도 받아준다 — FE 가
    어떤 경우든 한 번의 호출로 책갈피를 만들 수 있게."""
    # UUID 모양이면 id 매칭부터 시도
    val = doc_id_or_slug.strip()
    if not val:
        raise BookmarkValidationError("document_id required")

    # try id first
    if len(val) == 36 and val.count("-") == 4:
        row = (await s.execute(
            text("SELECT id FROM documents WHERE id = CAST(:v AS uuid) AND status != 'archived'"),
            {"v": val},
        )).first()
        if row:
            return str(row[0])

    # fallback to slug
    row = (await s.execute(
        text("SELECT id FROM documents WHERE slug = :v AND status != 'archived'"),
        {"v": val},
    )).first()
    if not row:
        raise NotFound(f"document '{val}' not found")
    return str(row[0])


# ── Bookmarks ────────────────────────────────────────────────────────────


@router.post("/bookmarks", status_code=201, summary="책갈피 추가 (reader+)")
async def create_bookmark(
    body: BookmarkIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    doc_id = await _resolve_doc_id(s, body.document_id)
    folder = (body.folder or None) and body.folder.strip() or None
    notes = (body.notes or None) and body.notes.strip() or None

    # UNIQUE (user_id, document_id) — duplicate insert returns 409.
    existing = (await s.execute(
        text("""
            SELECT id FROM bookmarks
            WHERE user_id = CAST(:u AS uuid) AND document_id = CAST(:d AS uuid)
        """),
        {"u": user["id"], "d": doc_id},
    )).first()
    if existing:
        raise Conflict("Bookmark already exists for this document")

    row = (await s.execute(
        text("""
            INSERT INTO bookmarks (user_id, document_id, folder, notes)
            VALUES (CAST(:u AS uuid), CAST(:d AS uuid), :f, :n)
            RETURNING id
        """),
        {"u": user["id"], "d": doc_id, "f": folder, "n": notes},
    )).first()

    await document_repo.insert_audit(
        s, user_id=user["id"], action="bookmark.create",
        target=f"bookmarks/{row[0]}",
        payload={"document_id": doc_id, "folder": folder},
    )
    await s.commit()

    return envelope(data={"bookmark_id": str(row[0])})


@router.delete("/bookmarks/{bid}", summary="책갈피 삭제 (owner)")
async def delete_bookmark(
    bid: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    if not _is_uuid(bid):
        raise NotFound("bookmark not found")
    row = (await s.execute(
        text("SELECT user_id FROM bookmarks WHERE id = CAST(:id AS uuid)"),
        {"id": bid},
    )).first()
    if not row:
        raise NotFound("bookmark not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("Only the owner may delete a bookmark")

    await s.execute(
        text("DELETE FROM bookmarks WHERE id = CAST(:id AS uuid)"),
        {"id": bid},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="bookmark.delete",
        target=f"bookmarks/{bid}", payload={},
    )
    await s.commit()
    return Response(status_code=204)


@router.get("/bookmarks", summary="책갈피 목록 (reader+)")
async def list_bookmarks(
    folder: str | None = Query(default=None, max_length=120),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    sql = """
        SELECT b.id, b.document_id, d.slug, d.title, b.folder, b.notes, b.created_at
        FROM bookmarks b
        JOIN documents d ON d.id = b.document_id
        WHERE b.user_id = CAST(:u AS uuid)
    """
    params: dict[str, Any] = {"u": user["id"]}
    if folder is not None:
        if folder == "":
            sql += " AND b.folder IS NULL"
        else:
            sql += " AND b.folder = :f"
            params["f"] = folder
    sql += " ORDER BY b.created_at DESC"
    rows = (await s.execute(text(sql), params)).all()
    items = [_bm_row(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.patch("/bookmarks/{bid}", summary="책갈피 수정 (owner)")
async def patch_bookmark(
    bid: str,
    body: BookmarkPatchIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not _is_uuid(bid):
        raise NotFound("bookmark not found")
    row = (await s.execute(
        text("SELECT user_id FROM bookmarks WHERE id = CAST(:id AS uuid)"),
        {"id": bid},
    )).first()
    if not row:
        raise NotFound("bookmark not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("Only the owner may edit a bookmark")

    sets: list[str] = []
    params: dict[str, Any] = {"id": bid}
    fields = body.model_dump(exclude_unset=True)
    if "folder" in fields:
        sets.append("folder = :f")
        v = fields["folder"]
        params["f"] = (v.strip() if isinstance(v, str) and v.strip() else None)
    if "notes" in fields:
        sets.append("notes = :n")
        v = fields["notes"]
        params["n"] = (v.strip() if isinstance(v, str) and v.strip() else None)
    if not sets:
        raise BookmarkValidationError("nothing to update")

    full = (await s.execute(
        text(f"""
            UPDATE bookmarks SET {', '.join(sets)}
            WHERE id = CAST(:id AS uuid)
            RETURNING id, document_id,
              (SELECT slug FROM documents WHERE id = bookmarks.document_id),
              (SELECT title FROM documents WHERE id = bookmarks.document_id),
              folder, notes, created_at
        """),
        params,
    )).first()

    await document_repo.insert_audit(
        s, user_id=user["id"], action="bookmark.update",
        target=f"bookmarks/{bid}",
        payload={k: v for k, v in fields.items()},
    )
    await s.commit()

    return envelope(data=_bm_row(full))


@router.get("/bookmarks/folders", summary="폴더별 카운트 (reader+)")
async def list_folders(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT folder, COUNT(*) AS cnt
            FROM bookmarks
            WHERE user_id = CAST(:u AS uuid)
            GROUP BY folder
            ORDER BY (folder IS NULL) ASC, folder ASC
        """),
        {"u": user["id"]},
    )).all()
    items = [{"folder": r[0], "count": int(r[1])} for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


# ── Reads ─────────────────────────────────────────────────────────────────


@router.post("/reads", summary="열람 기록 (reader+, accumulate read_seconds)")
async def post_read(
    body: ReadIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    doc_id = await _resolve_doc_id(s, body.document_id)
    row = (await s.execute(
        text("""
            INSERT INTO document_reads (user_id, document_id, read_at, read_seconds)
            VALUES (CAST(:u AS uuid), CAST(:d AS uuid), NOW(), :sec)
            ON CONFLICT (user_id, document_id) DO UPDATE
              SET read_at = NOW(),
                  read_seconds = document_reads.read_seconds + EXCLUDED.read_seconds
            RETURNING read_seconds, read_at
        """),
        {"u": user["id"], "d": doc_id, "sec": body.read_seconds},
    )).first()
    await s.commit()
    return envelope(data={
        "document_id": doc_id,
        "read_seconds": int(row[0]),
        "read_at": row[1].isoformat() if row[1] else None,
    })


@router.get("/reads/recent", summary="최근 열람 문서 (reader+)")
async def get_recent_reads(
    limit: int = Query(default=20, ge=1, le=100),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT r.document_id, d.slug, d.title, d.summary,
                   r.read_at, r.read_seconds,
                   (SELECT 1 FROM bookmarks b
                      WHERE b.user_id = r.user_id AND b.document_id = r.document_id) AS is_bm
            FROM document_reads r
            JOIN documents d ON d.id = r.document_id
            WHERE r.user_id = CAST(:u AS uuid)
              AND d.status != 'archived'
            ORDER BY r.read_at DESC
            LIMIT :lim
        """),
        {"u": user["id"], "lim": limit},
    )).all()
    items = [
        {
            "document_id": str(r[0]),
            "slug": r[1],
            "title": r[2],
            "summary": r[3],
            "read_at": r[4].isoformat() if r[4] else None,
            "read_seconds": int(r[5]),
            "bookmarked": bool(r[6]),
        }
        for r in rows
    ]
    return envelope(data={"items": items}, meta={"count": len(items)})
