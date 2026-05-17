"""Version tags + branch-from-tag (Cycle 16).

Cycle 5 added numbered ``document_versions`` (v1, v2, …). Editors and admins
want to label specific snapshots ("v1.0 release", "RC1") and optionally
branch a brand new document off any tagged snapshot. This router owns the
CRUD on ``version_tags`` plus the branch-from-tag flow.

Endpoints (all under ``/api/v1``):

  - POST   /documents/{slug}/versions/{n}/tags    (editor+) → 201
        Body: {tag_name, description?, is_locked?}
  - GET    /documents/{slug}/version-tags         (reader+) → list
  - DELETE /documents/{slug}/version-tags/{tag}   (editor+ for unlocked,
                                                    admin for locked)
  - POST   /documents/{slug}/branch-from-tag      (editor+) → 201
        Body: {tag_name, target_slug}

All writes hit ``audit_logs``. Branch creation reuses the existing
``insert_document`` + ``insert_version`` repo helpers so the new doc shows
up in search/feed pipelines via the same lifecycle (status='draft', v1).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_editor, require_reader
from app.core.db import get_db
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed, envelope
from app.repos import document_repo
from app.services import document_service

router = APIRouter(prefix="/api/v1", tags=["version-tags"])

_MAX_TAG_NAME = 80
_MAX_DESCRIPTION = 500


class CreateTagIn(BaseModel):
    tag_name: str = Field(..., min_length=1, max_length=_MAX_TAG_NAME)
    description: str | None = Field(default=None, max_length=_MAX_DESCRIPTION)
    is_locked: bool = Field(default=False)


class BranchFromTagIn(BaseModel):
    tag_name: str = Field(..., min_length=1, max_length=_MAX_TAG_NAME)
    target_slug: str = Field(..., min_length=1, max_length=200)


def _row_to_tag(row: Any) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "document_id": str(row[1]),
        "version": int(row[2]),
        "tag_name": row[3],
        "description": row[4],
        "tagged_by": str(row[5]) if row[5] else None,
        "tagged_by_name": row[6],
        "tagged_at": row[7].isoformat() if row[7] else None,
        "is_locked": bool(row[8]),
    }


# ── POST /documents/{slug}/versions/{n}/tags ─────────────────────────────


@router.post(
    "/documents/{slug}/versions/{n}/tags",
    status_code=201,
    summary="버전에 태그 추가 (editor+)",
)
async def create_version_tag(
    body: CreateTagIn,
    slug: str = Path(..., min_length=1),
    n: int = Path(..., ge=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    doc = await document_service.get_document_or_404(s, slug)

    # The version row must exist before we can tag it.
    ver = await document_repo.find_version(s, doc_id=doc["id"], version=n)
    if not ver:
        raise NotFound(f"version not found: {slug}@{n}")

    name = body.tag_name.strip()
    if not name:
        raise ValidationFailed("tag_name required")
    description = (body.description or "").strip() or None

    try:
        row = (await s.execute(
            text(
                """
                INSERT INTO version_tags
                  (document_id, version, tag_name, description,
                   tagged_by, is_locked)
                VALUES
                  (CAST(:d AS uuid), :v, :n, :desc,
                   CAST(:u AS uuid), :locked)
                RETURNING id, document_id, version, tag_name, description,
                          tagged_by, tagged_at, is_locked
                """
            ),
            {
                "d": doc["id"],
                "v": n,
                "n": name,
                "desc": description,
                "u": user["id"],
                "locked": body.is_locked,
            },
        )).first()
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(
            f"tag already exists for document: {slug} / {name}"
        ) from e

    assert row is not None  # INSERT...RETURNING always emits one row
    tag_id = str(row[0])
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="version_tag.create",
        target=f"document:{slug}/v{n}/tag:{name}",
        payload={"tag_name": name, "version": n, "is_locked": body.is_locked},
    )
    await s.commit()

    # Re-read with author name joined for the response.
    full = await _fetch_tag_by_id(s, tag_id)
    return envelope(data=full)


# ── GET /documents/{slug}/version-tags ───────────────────────────────────


@router.get(
    "/documents/{slug}/version-tags",
    summary="문서 버전 태그 목록 (reader+)",
)
async def list_version_tags(
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    doc = await document_service.get_document_or_404(s, slug)
    rows = (await s.execute(
        text(
            """
            SELECT vt.id, vt.document_id, vt.version, vt.tag_name,
                   vt.description, vt.tagged_by, u.name AS tagged_by_name,
                   vt.tagged_at, vt.is_locked
            FROM version_tags vt
            LEFT JOIN users u ON u.id = vt.tagged_by
            WHERE vt.document_id = CAST(:d AS uuid)
            ORDER BY vt.version DESC, vt.tagged_at DESC
            """
        ),
        {"d": doc["id"]},
    )).all()
    items = [_row_to_tag(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


# ── DELETE /documents/{slug}/version-tags/{tag_name} ─────────────────────


@router.delete(
    "/documents/{slug}/version-tags/{tag_name}",
    summary="버전 태그 삭제 (잠금 해제: editor+, 잠금: admin)",
)
async def delete_version_tag(
    slug: str = Path(..., min_length=1),
    tag_name: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> Response:
    doc = await document_service.get_document_or_404(s, slug)
    row = (await s.execute(
        text(
            """
            SELECT id, version, is_locked
            FROM version_tags
            WHERE document_id = CAST(:d AS uuid) AND tag_name = :n
            """
        ),
        {"d": doc["id"], "n": tag_name},
    )).first()
    if not row:
        raise NotFound(f"tag not found: {slug} / {tag_name}")
    is_locked = bool(row[2])
    if is_locked and user.get("role") != "admin":
        raise Forbidden("Locked tags require admin to delete")

    await s.execute(
        text("DELETE FROM version_tags WHERE id = :id"),
        {"id": row[0]},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="version_tag.delete",
        target=f"document:{slug}/v{int(row[1])}/tag:{tag_name}",
        payload={"tag_name": tag_name, "was_locked": is_locked},
    )
    await s.commit()
    return Response(status_code=204)


# ── POST /documents/{slug}/branch-from-tag ───────────────────────────────


@router.post(
    "/documents/{slug}/branch-from-tag",
    status_code=201,
    summary="태그된 버전에서 새 문서 분기 (editor+)",
)
async def branch_from_tag(
    body: BranchFromTagIn,
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    src = await document_service.get_document_or_404(s, slug)

    tag_row = (await s.execute(
        text(
            """
            SELECT version FROM version_tags
            WHERE document_id = CAST(:d AS uuid) AND tag_name = :n
            """
        ),
        {"d": src["id"], "n": body.tag_name.strip()},
    )).first()
    if not tag_row:
        raise NotFound(f"tag not found: {slug} / {body.tag_name}")
    version_at_tag = int(tag_row[0])

    snapshot = await document_repo.find_version(
        s, doc_id=src["id"], version=version_at_tag
    )
    if not snapshot:
        # Defensive — the tag references a version row that vanished.
        raise NotFound(
            f"tagged version snapshot missing: {slug}@{version_at_tag}"
        )

    target_slug = body.target_slug.strip()
    if not target_slug:
        raise ValidationFailed("target_slug required")

    # The branched payload is the snapshot's content_json with the slug + title
    # rewritten. We deliberately avoid full re-validation through
    # validate_documentjson because the snapshot already passed validation when
    # it was first written.
    content = dict(snapshot["content_json"])
    content["slug"] = target_slug
    branched_title = content.get("title") or src.get("title") or target_slug
    content["title"] = branched_title

    inserted = await document_repo.insert_document(
        s,
        slug=target_slug,
        title=branched_title,
        summary=src.get("summary"),
        content_json=content,
        owner_id=user["id"],
        part_id=src.get("part_id"),
    )
    await document_repo.insert_version(
        s,
        doc_id=inserted["id"],
        version=inserted["version"],
        content_json=content,
        edited_by=user["id"],
        change_log=f"branched from {slug}@{body.tag_name}",
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="version_tag.branch",
        target=f"document:{target_slug}",
        payload={
            "source_slug": slug,
            "source_version": version_at_tag,
            "tag_name": body.tag_name,
        },
    )
    await s.commit()

    return envelope(
        data={
            "slug": inserted["slug"],
            "version": inserted["version"],
            "branched_from": {
                "slug": slug,
                "version": version_at_tag,
                "tag_name": body.tag_name,
            },
        }
    )


# ── helpers ──────────────────────────────────────────────────────────────


async def _fetch_tag_by_id(s: AsyncSession, tag_id: str) -> dict[str, Any]:
    row = (await s.execute(
        text(
            """
            SELECT vt.id, vt.document_id, vt.version, vt.tag_name,
                   vt.description, vt.tagged_by, u.name AS tagged_by_name,
                   vt.tagged_at, vt.is_locked
            FROM version_tags vt
            LEFT JOIN users u ON u.id = vt.tagged_by
            WHERE vt.id = :id
            """
        ),
        {"id": tag_id},
    )).first()
    assert row is not None
    return _row_to_tag(row)
