"""Doc Templates 라우터 — 조직 공유 문서 템플릿.

Cycle 7 의 14개 하드코딩 템플릿을 보완하는 서버측 템플릿 저장소다.
관리자 또는 publish 권한이 있는 에디터가 자신의 템플릿을 발행해 조직
전체가 사용할 수 있다. snippets 라우터와 거의 동일한 패턴이지만,
저장 단위가 블록이 아니라 DocumentJSON sections 배열이다.

  - POST   /api/v1/doc-templates                  (editor+) → 신규 템플릿 (201)
  - GET    /api/v1/doc-templates?scope=&category=&q=
                                                 (reader+) → 접근 가능한 목록
  - GET    /api/v1/doc-templates/{slug}           (reader+) → 본문 + use_count++
  - PATCH  /api/v1/doc-templates/{slug}           (owner|admin)
  - DELETE /api/v1/doc-templates/{slug}           (owner|admin) → 204
  - POST   /api/v1/doc-templates/{slug}/use       (editor+)
        → 템플릿의 sections 로 새 문서를 만들고 use_count++.

스코프 정책은 snippets 와 동일:
  private — 작성자만.
  team    — 같은 users.team_id (팀 미설정이면 보이지 않음).
  org     — 모든 활성 사용자.
"""
from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor, require_reader
from app.core.db import get_db
from app.core.errors import APIError, Conflict, Forbidden, NotFound, envelope
from app.repos import document_repo
from app.services import document_service

router = APIRouter(prefix="/api/v1", tags=["doc-templates"])


class TemplateValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


_VALID_SCOPES = {"private", "team", "org"}
_VALID_CATEGORIES = {"report", "collab", "tech", "announce", "custom"}
# Mirrors DocumentJSON Slug pattern (lowercase ASCII / digits / hyphen / Hangul).
_SLUG_RE = re.compile(r"^[a-z0-9가-힣][a-z0-9가-힣-]{0,99}$")


class TemplateIn(BaseModel):
    slug: str | None = Field(default=None, max_length=100)
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: str = Field(...)
    thumb_image_id: str | None = Field(default=None, max_length=64)
    sections: list[dict[str, Any]] = Field(..., min_length=1)
    scope: str = Field(default="private")


class TemplatePatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: str | None = Field(default=None)
    thumb_image_id: str | None = Field(default=None, max_length=64)
    scope: str | None = Field(default=None)
    sections: list[dict[str, Any]] | None = Field(default=None, min_length=1)


class TemplateUseIn(BaseModel):
    target_slug: str = Field(..., min_length=1, max_length=100)
    title: str | None = Field(default=None, min_length=1, max_length=200)


def _check_scope(value: str) -> None:
    if value not in _VALID_SCOPES:
        raise TemplateValidationError(
            f"scope must be one of {sorted(_VALID_SCOPES)}"
        )


def _check_category(value: str) -> None:
    if value not in _VALID_CATEGORIES:
        raise TemplateValidationError(
            f"category must be one of {sorted(_VALID_CATEGORIES)}"
        )


def _check_slug(value: str) -> None:
    if not _SLUG_RE.match(value):
        raise TemplateValidationError(
            "slug must be lowercase ASCII / digits / hyphen / Hangul, "
            "1–100 chars, no leading hyphen"
        )


def _slugify(title: str) -> str:
    """Best-effort slug generator used when caller omits an explicit slug.

    The result is validated against `_SLUG_RE` and falls back to
    `template-<n>` if the title produces an empty slug (e.g. all-symbol).
    """
    base = title.strip().lower()
    # collapse whitespace + drop disallowed chars
    base = re.sub(r"[\s_]+", "-", base)
    base = re.sub(r"[^a-z0-9가-힣-]", "", base)
    base = re.sub(r"-+", "-", base).strip("-")
    if not base:
        base = "template"
    if not _SLUG_RE.match(base):
        base = "template"
    return base[:100]


def _summary_row(row: Any) -> dict[str, Any]:
    sections = row[6]
    if isinstance(sections, str):
        try:
            sections = json.loads(sections)
        except json.JSONDecodeError:
            sections = []
    section_count = len(sections) if isinstance(sections, list) else 0
    return {
        "id": str(row[0]),
        "slug": row[1],
        "title": row[2],
        "description": row[3],
        "category": row[4],
        "thumb_image_id": row[5],
        "section_count": section_count,
        "scope": row[7],
        "use_count": int(row[8] or 0),
        "created_by": str(row[9]) if row[9] else None,
        "author_name": row[10],
        "created_at": row[11].isoformat() if row[11] else None,
        "updated_at": row[12].isoformat() if row[12] else None,
    }


def _full_row(row: Any) -> dict[str, Any]:
    sections = row[6]
    if isinstance(sections, str):
        try:
            sections = json.loads(sections)
        except json.JSONDecodeError:
            sections = []
    return {
        "id": str(row[0]),
        "slug": row[1],
        "title": row[2],
        "description": row[3],
        "category": row[4],
        "thumb_image_id": row[5],
        "sections": sections or [],
        "scope": row[7],
        "use_count": int(row[8] or 0),
        "created_by": str(row[9]) if row[9] else None,
        "author_name": row[10],
        "created_at": row[11].isoformat() if row[11] else None,
        "updated_at": row[12].isoformat() if row[12] else None,
    }


_SELECT_COLS = """
    SELECT t.id, t.slug, t.title, t.description, t.category, t.thumb_image_id,
           t.sections, t.scope, t.use_count, t.created_by,
           u.name AS author_name, t.created_at, t.updated_at
    FROM doc_templates t
    LEFT JOIN users u ON u.id = t.created_by
"""


# ── CRUD ─────────────────────────────────────────────────────────────────


@router.post("/doc-templates", status_code=201, summary="템플릿 등록 (editor+)")
async def create_template(
    body: TemplateIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    _check_scope(body.scope)
    _check_category(body.category)
    title = body.title.strip()
    if not title:
        raise TemplateValidationError("title required")
    slug = (body.slug or _slugify(title)).strip().lower()
    _check_slug(slug)
    desc = body.description.strip() if body.description else None

    # Uniqueness check first — friendlier error than the raw DB constraint.
    existing = (await s.execute(
        text("SELECT 1 FROM doc_templates WHERE slug = :sl"),
        {"sl": slug},
    )).first()
    if existing:
        raise Conflict(f"slug already used: {slug}")

    row = (await s.execute(
        text("""
            INSERT INTO doc_templates (
              slug, title, description, category, thumb_image_id,
              sections, scope, created_by
            ) VALUES (
              :sl, :ti, :de, :ca, :th,
              CAST(:se AS JSONB), :sc, CAST(:u AS uuid)
            )
            RETURNING id
        """),
        {
            "sl": slug,
            "ti": title,
            "de": desc,
            "ca": body.category,
            "th": body.thumb_image_id,
            "se": json.dumps(body.sections, ensure_ascii=False),
            "sc": body.scope,
            "u": user["id"],
        },
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row

    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="doc_template.create",
        target=f"doc_templates/{slug}",
        payload={
            "scope": body.scope,
            "category": body.category,
            "title": title,
            "section_count": len(body.sections),
        },
    )
    await s.commit()
    return envelope(data={"template_id": str(row[0]), "slug": slug})


@router.get("/doc-templates", summary="템플릿 목록 (reader+)")
async def list_templates(
    scope: str | None = Query(default=None),
    category: str | None = Query(default=None),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    if scope is not None:
        _check_scope(scope)
    if category is not None:
        _check_category(category)

    sql = _SELECT_COLS + """
        WHERE (
            t.created_by = CAST(:u AS uuid)
            OR t.scope = 'org'
            OR (
              t.scope = 'team'
              AND CAST(:tid AS uuid) IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM users uu
                WHERE uu.id = t.created_by AND uu.team_id = CAST(:tid AS uuid)
              )
            )
        )
    """
    params: dict[str, Any] = {"u": user["id"], "tid": user.get("team_id")}
    if scope is not None:
        sql += " AND t.scope = :sc"
        params["sc"] = scope
    if category is not None:
        sql += " AND t.category = :ca"
        params["ca"] = category
    if q:
        sql += " AND (t.title ILIKE :q OR COALESCE(t.description,'') ILIKE :q)"
        params["q"] = f"%{q.strip()}%"
    sql += " ORDER BY t.use_count DESC, t.updated_at DESC LIMIT :lim OFFSET :off"
    params["lim"] = limit
    params["off"] = offset

    rows = (await s.execute(text(sql), params)).all()
    items = [_summary_row(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


async def _fetch_with_visibility(
    s: AsyncSession, slug: str, user: dict[str, Any]
) -> tuple[Any, bool]:
    row = (await s.execute(
        text(_SELECT_COLS + " WHERE t.slug = :sl"),
        {"sl": slug},
    )).first()
    if not row:
        raise NotFound("template not found")
    owner_id = str(row[9]) if row[9] else None
    scope = row[7]
    if owner_id and owner_id == user["id"]:
        return row, True
    if scope == "org":
        return row, True
    if scope == "team":
        team_id = user.get("team_id")
        if not team_id or not owner_id:
            return row, False
        owner = (await s.execute(
            text("SELECT team_id FROM users WHERE id = CAST(:id AS uuid)"),
            {"id": owner_id},
        )).first()
        owner_team = owner[0] if owner else None
        if owner_team and str(owner_team) == team_id:
            return row, True
        return row, False
    if user.get("role") == "admin":
        return row, True
    return row, False


@router.get(
    "/doc-templates/{slug}",
    summary="템플릿 단건 조회 (reader+, use_count++)",
)
async def get_template(
    slug: str = Path(..., min_length=1, max_length=100),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    row, ok = await _fetch_with_visibility(s, slug, user)
    if not ok:
        raise Forbidden("not allowed to read this template")
    bumped = (await s.execute(
        text(
            "UPDATE doc_templates SET use_count = use_count + 1, "
            "updated_at = NOW() WHERE slug = :sl"
        ),
        {"sl": slug},
    ))
    _ = bumped  # silence unused
    refreshed = (await s.execute(
        text(_SELECT_COLS + " WHERE t.slug = :sl"),
        {"sl": slug},
    )).first()
    await s.commit()
    return envelope(data=_full_row(refreshed or row))


@router.patch(
    "/doc-templates/{slug}",
    summary="템플릿 수정 (owner|admin)",
)
async def patch_template(
    slug: str,
    body: TemplatePatchIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    row = (await s.execute(
        text("SELECT created_by FROM doc_templates WHERE slug = :sl"),
        {"sl": slug},
    )).first()
    if not row:
        raise NotFound("template not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("only the owner or admin may edit a template")

    sets: list[str] = []
    params: dict[str, Any] = {"sl": slug}
    fields = body.model_dump(exclude_unset=True)
    if "title" in fields:
        v = (fields["title"] or "").strip()
        if not v:
            raise TemplateValidationError("title cannot be empty")
        sets.append("title = :ti")
        params["ti"] = v
    if "description" in fields:
        v = fields["description"]
        sets.append("description = :de")
        params["de"] = (v.strip() if isinstance(v, str) and v.strip() else None)
    if "category" in fields:
        c = fields["category"]
        if c is None:
            raise TemplateValidationError("category cannot be null")
        _check_category(c)
        sets.append("category = :ca")
        params["ca"] = c
    if "thumb_image_id" in fields:
        sets.append("thumb_image_id = :th")
        params["th"] = fields["thumb_image_id"] or None
    if "scope" in fields:
        sc = fields["scope"]
        if sc is None:
            raise TemplateValidationError("scope cannot be null")
        _check_scope(sc)
        sets.append("scope = :sc")
        params["sc"] = sc
    if "sections" in fields:
        secs = fields["sections"]
        if not isinstance(secs, list) or not secs:
            raise TemplateValidationError("sections cannot be empty")
        sets.append("sections = CAST(:se AS JSONB)")
        params["se"] = json.dumps(secs, ensure_ascii=False)
    if not sets:
        raise TemplateValidationError("nothing to update")
    sets.append("updated_at = NOW()")

    await s.execute(
        text(
            f"UPDATE doc_templates SET {', '.join(sets)} WHERE slug = :sl"
        ),
        params,
    )
    full = (await s.execute(
        text(_SELECT_COLS + " WHERE t.slug = :sl"),
        {"sl": slug},
    )).first()
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="doc_template.update",
        target=f"doc_templates/{slug}",
        payload={k: (v if k != "sections" else f"<{len(v)} sections>")
                 for k, v in fields.items()},
    )
    await s.commit()
    return envelope(data=_full_row(full))


@router.delete(
    "/doc-templates/{slug}",
    summary="템플릿 삭제 (owner|admin)",
)
async def delete_template(
    slug: str = Path(..., min_length=1, max_length=100),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    row = (await s.execute(
        text("SELECT created_by FROM doc_templates WHERE slug = :sl"),
        {"sl": slug},
    )).first()
    if not row:
        raise NotFound("template not found")
    if str(row[0]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("only the owner or admin may delete a template")

    await s.execute(
        text("DELETE FROM doc_templates WHERE slug = :sl"),
        {"sl": slug},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="doc_template.delete",
        target=f"doc_templates/{slug}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


@router.post(
    "/doc-templates/{slug}/use",
    status_code=201,
    summary="템플릿으로 새 문서 생성 (editor+, use_count++)",
)
async def use_template(
    slug: str,
    body: TemplateUseIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    row, ok = await _fetch_with_visibility(s, slug, user)
    if not ok:
        raise Forbidden("not allowed to use this template")
    target_slug = body.target_slug.strip().lower()
    _check_slug(target_slug)
    title = (body.title or row[2] or "Untitled").strip()
    sections = row[6]
    if isinstance(sections, str):
        try:
            sections = json.loads(sections)
        except json.JSONDecodeError:
            sections = []
    if not isinstance(sections, list) or not sections:
        raise TemplateValidationError("template has no sections")

    # Build a minimal DocumentJSON v1.0 payload. The doc service runs full
    # JSON-Schema validation on the result, so any malformed seed sections
    # surface as a structured 422 instead of a silent half-saved doc.
    # `id` must be a 26-char Crockford-base32 ULID — generate one inline
    # rather than depending on a separate utility (this single use is too
    # small to justify the import).
    import secrets as _secrets
    _ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    fresh_id = "".join(
        _ULID_ALPHABET[_secrets.randbelow(32)] for _ in range(26)
    )
    payload = {
        "schema_version": "1.0",
        "id": fresh_id,
        "slug": target_slug,
        "title": title,
        "metadata": {
            "division": "MX",
            "owners": [user["id"]],
            "confidentiality": "internal",
        },
        "sections": sections,
    }
    doc, _warnings = await document_service.create_document(
        s, payload=payload, owner_id=user["id"]
    )
    # Bump the template use_count on success.
    await s.execute(
        text(
            "UPDATE doc_templates SET use_count = use_count + 1, "
            "updated_at = NOW() WHERE slug = :sl"
        ),
        {"sl": slug},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="doc_template.use",
        target=f"doc_templates/{slug}",
        payload={"new_doc_slug": doc["slug"]},
    )
    await s.commit()
    return envelope(data={"slug": doc["slug"], "id": doc["id"]})
