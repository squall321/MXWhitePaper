"""Document CRUD 라우터.

Sprint 1 — auth 미적용. actor 식별:
  1) `X-MXWP-User: <email>` 헤더가 있으면 해당 사용자 id
  2) 없으면 첫 admin 사용자 (보통 admin@mx.local)
"""
from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query, Response
from fastapi.responses import Response as FastAPIResponse
from sqlalchemy import text as _sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_editor, require_reader
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import NotFound, envelope
from app.repos import document_repo
from app.services import document_service
from app.services.html_renderer import RenderOptions, render_namuwiki_html
from app.storage import minio_adapter

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


async def _resolve_actor(
    s: AsyncSession,
    x_mxwp_user: str | None,
    user: dict | None = None,
) -> str:
    """X-MXWP-User 헤더 (Sprint 1 호환) 우선, 없으면 인증된 user["id"], 그 다음 admin."""
    if x_mxwp_user:
        uid = await document_repo.fetch_user_by_email(s, x_mxwp_user)
        if uid:
            return uid
    if user and user.get("id"):
        return str(user["id"])
    return await document_repo.fetch_admin_owner_id(s)


@router.get(
    "",
    summary="문서 목록 조회 (계층/태그/검색 필터)",
    description=(
        "발행(published) 문서 목록. division/team/group/part slug 조합으로 좁힐 수 있고, "
        "`tag` 로 메타 태그 필터, `q` 로 title/summary LIKE 검색이 가능하다."
    ),
)
async def list_documents(
    part: str | None = Query(default=None, description="DEPRECATED — use part_slug"),
    part_slug: str | None = Query(default=None, description="part slug 필터"),
    team: str | None = Query(default=None, description="team slug 계층 필터 (JOIN)"),
    division: str | None = Query(default=None, description="division slug 계층 필터"),
    group: str | None = Query(default=None, description="group slug 계층 필터"),
    tag: str | None = Query(default=None, description="태그 이름 필터"),
    q: str | None = Query(default=None, description="title/summary LIKE 검색"),
    limit: int = Query(default=20, ge=1, le=100),
    cursor: str | None = Query(default=None),  # Sprint 2+ 에서 구현
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    # Sprint 2 — `?part=` 는 `?part_slug=` 의 backward-compat alias
    if part is not None and part_slug is None:
        logger.warning(
            "GET /documents 의 ?part= 쿼리는 deprecated. ?part_slug= 를 사용하세요."
        )
        part_slug = part
    items = await document_repo.list_documents(
        s,
        part_slug=part_slug,
        team_slug=team,
        division_slug=division,
        group_slug=group,
        tag=tag,
        q=q,
        limit=limit,
    )
    return envelope(
        data=items,
        meta={"count": len(items), "cursor": None, "limit": limit},
    )


@router.get(
    "/{slug}",
    summary="단일 문서 조회 (ETag 포함)",
    description=(
        "DocumentJSON 본문을 그대로 반환. 응답 헤더 `ETag` 를 PUT/PATCH 의 If-Match 에 그대로 사용."
    ),
)
async def get_document(
    slug: str,
    response: Response,
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    doc = await document_service.get_document_or_404(s, slug)
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "private, must-revalidate"
    # Block-level visibility: redact blocks whose meta.permission is above the
    # caller's role (admin sees everything → no-op).
    content = document_service.scrub_for_response(
        doc["content_json"], role=_user.get("role")
    )
    return envelope(
        data={
            "id": doc["id"],
            "slug": doc["slug"],
            "title": doc["title"],
            "summary": doc["summary"],
            "status": doc["status"],
            "version": doc["version"],
            "schema_ver": doc["schema_ver"],
            "owner_id": doc["owner_id"],
            "part_id": doc["part_id"],
            "created_at": doc["created_at"],
            "updated_at": doc["updated_at"],
            "content": content,
        },
        meta={"etag": etag},
    )


# ── HTML export (Cycle 14) ──────────────────────────────────────────
@router.get(
    "/{slug}/export.html",
    summary="문서를 단일 HTML 파일로 내보내기 (나무위키 스타일)",
    description=(
        "DocumentJSON 본문을 자체 완비형(self-contained) HTML 로 렌더한다.\n\n"
        "- `style=namuwiki` (현재 유일 — 추후 academic/minimal 등 추가 예정)\n"
        "- `inline_images=1` 이미지 base64 인라인 (파일 크기 폭증 주의)\n"
        "- `katex=cdn` math 블록을 KaTeX CDN 으로 렌더\n"
        "- `mermaid=cdn` flow(mermaid) 블록을 mermaid CDN 으로 렌더"
    ),
)
async def export_document_html(
    slug: str,
    style: str = Query(default="namuwiki"),
    inline_images: int = Query(default=0, ge=0, le=1),
    katex: str | None = Query(default=None),
    mermaid: str | None = Query(default=None),
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> FastAPIResponse:
    if style != "namuwiki":
        from app.core.errors import ValidationFailed
        raise ValidationFailed(
            f"unsupported style: {style!r}",
            details={"supported": ["namuwiki"]},
        )

    doc = await document_service.get_document_or_404(s, slug)
    content = document_service.scrub_for_response(
        doc["content_json"], role=_user.get("role")
    )

    # 본문에서 imageId 를 모두 수집 → DB 한 번에 조회 → resolver 에 dict 주입.
    image_ids = _collect_image_ids(content)
    image_urls: dict[str, dict[str, Any]] = {}
    if image_ids:
        image_urls = await _fetch_image_urls(s, image_ids)

    inline_blob_lookup: dict[str, dict[str, Any]] = {}
    if inline_images:
        inline_blob_lookup = await _fetch_image_bytes(s, image_urls)

    def resolver(image_id: str) -> dict[str, Any] | None:
        info = image_urls.get(image_id)
        if not info:
            return None
        out = dict(info)
        blob = inline_blob_lookup.get(image_id)
        if blob is not None:
            out["bytes"] = blob.get("bytes")
            out["mime"] = blob.get("mime") or out.get("mime")
        return out

    options = RenderOptions(
        inline_images=bool(inline_images),
        katex_cdn=(katex == "cdn"),
        mermaid_cdn=(mermaid == "cdn"),
        image_resolver=resolver,
        # External chat apps that fetch the exported HTML can auto-discover
        # the oEmbed endpoint from this <link> tag.
        oembed_base_url=get_settings().web_base_url,
    )
    # `content` is already scrubbed above for the caller's role; pass through
    # without re-scrubbing in the renderer.
    html_bytes = render_namuwiki_html(content, options=options).encode("utf-8")
    filename = f"{slug}.html"
    # 한글/특수 문자 slug 대응 — RFC 5987 filename* 사용
    return FastAPIResponse(
        content=html_bytes,
        media_type="text/html; charset=utf-8",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{quote(filename)}\"; "
                f"filename*=UTF-8''{quote(filename)}"
            ),
            "Cache-Control": "private, no-store",
            "X-MXWP-Export-Style": style,
        },
    )


def _collect_image_ids(content: dict[str, Any]) -> list[str]:
    """DocumentJSON 트리에서 image / gallery 의 imageId 를 전부 수집."""
    found: list[str] = []

    def walk_blocks(blocks: list[dict[str, Any]]) -> None:
        for b in blocks or []:
            t = b.get("type")
            if t == "image":
                v = b.get("imageId") or b.get("image_id")
                if v:
                    found.append(str(v))
            elif t == "gallery":
                for it in b.get("items") or []:
                    v = it.get("imageId") or it.get("image_id")
                    if v:
                        found.append(str(v))
            elif t == "columns":
                for col in b.get("columns") or []:
                    walk_blocks(col)
            elif t == "tabs":
                for tab in b.get("tabs") or []:
                    walk_blocks(tab.get("blocks") or [])
            elif t == "accordion":
                for it in b.get("items") or []:
                    walk_blocks(it.get("blocks") or [])

    def walk_sections(secs: list[dict[str, Any]]) -> None:
        for s in secs or []:
            walk_blocks(s.get("blocks") or [])
            walk_sections(s.get("subsections") or [])

    walk_sections(content.get("sections") or [])
    # de-dup, preserve order
    seen: set[str] = set()
    out: list[str] = []
    for v in found:
        if v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


async def _fetch_image_urls(
    s: AsyncSession, image_ids: list[str]
) -> dict[str, dict[str, Any]]:
    """ULID/UUID 모두 허용. 결과: image_id → {url, mime, sha256}."""
    import re

    ulid_re = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
    uuid_re = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        re.IGNORECASE,
    )

    ulids = [i for i in image_ids if ulid_re.match(i)]
    uuids = [i for i in image_ids if uuid_re.match(i)]
    out: dict[str, dict[str, Any]] = {}

    settings = get_settings()
    bucket = settings.minio_bucket_images

    if ulids:
        rows = (await s.execute(
            _sql_text(
                """
                SELECT ulid, sha256, mime_type
                FROM images
                WHERE ulid = ANY(:ids)
                """
            ),
            {"ids": ulids},
        )).all()
        for r in rows:
            sha = r[1]
            key = f"{sha[0:2]}/{sha[2:4]}/{sha}/view.webp"
            out[r[0]] = {
                "url": minio_adapter.public_url(bucket, key),
                "mime": r[2] or "image/webp",
                "sha256": sha,
            }
    if uuids:
        rows = (await s.execute(
            _sql_text(
                """
                SELECT id::text, sha256, mime_type
                FROM images
                WHERE id = ANY(CAST(:ids AS uuid[]))
                """
            ),
            {"ids": uuids},
        )).all()
        for r in rows:
            sha = r[1]
            key = f"{sha[0:2]}/{sha[2:4]}/{sha}/view.webp"
            out[r[0]] = {
                "url": minio_adapter.public_url(bucket, key),
                "mime": r[2] or "image/webp",
                "sha256": sha,
            }
    return out


async def _fetch_image_bytes(
    s: AsyncSession, urls: dict[str, dict[str, Any]]
) -> dict[str, dict[str, Any]]:
    """inline_images=1 옵션용. MinIO 에서 view.webp 바이트 직접 가져오기."""
    if not urls:
        return {}
    settings = get_settings()
    bucket = settings.minio_bucket_images
    client = minio_adapter.internal_client()
    out: dict[str, dict[str, Any]] = {}
    for image_id, info in urls.items():
        sha = info.get("sha256")
        if not sha:
            continue
        key = f"{sha[0:2]}/{sha[2:4]}/{sha}/view.webp"
        try:
            obj = client.get_object(Bucket=bucket, Key=key)
            data = obj["Body"].read()
            out[image_id] = {"bytes": data, "mime": info.get("mime") or "image/webp"}
        except Exception as e:
            logger.warning(
                "inline_images: failed to fetch %s — %s. fallback to URL.",
                image_id,
                e,
            )
    return out


@router.post(
    "",
    status_code=201,
    summary="새 문서 생성 (DocumentJSON v1.0)",
    description=(
        "DocumentJSON v1.0 페이로드를 받아 새 위키 페이지를 만든다.\n\n"
        "* 본문이 schema 에 부합하면 즉시 published 트리에 들어가며 ETag 가 응답 헤더로 반환된다.\n"
        "* `metadata.part` 는 slug 또는 한글 이름을 허용 — 미해석 항목은 `meta.warnings` 로 회신.\n"
        "* `metadata.tags` 는 `tags` + `document_tags` 테이블에 자동 upsert 된다.\n"
        "* 본문 내 `[[slug]]` 위키링크와 `glossary[]` 도 함께 인덱스에 반영."
    ),
)
async def create_document(
    payload: dict[str, Any],
    response: Response,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    doc, warnings = await document_service.create_document(
        s, payload=payload, owner_id=actor
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    # 한글 slug 가능 → HTTP 헤더는 latin-1 만 허용하므로 URL-encode
    response.headers["Location"] = f"/api/v1/documents/{quote(doc['slug'], safe='')}"
    meta: dict[str, Any] = {"etag": etag}
    if warnings:
        meta["warnings"] = warnings
    return envelope(
        data={
            "id": doc["id"],
            "slug": doc["slug"],
            "title": doc["title"],
            "version": doc["version"],
            "status": doc["status"],
        },
        meta=meta,
    )


@router.put(
    "/{slug}",
    summary="문서 전체 교체 (DocumentJSON 본문 + If-Match 필요)",
    description=(
        "DocumentJSON 본문을 통째로 교체한다. `If-Match` 헤더에 현재 ETag 를 보내야 한다 (낙관적 동시성).\n\n"
        "변경 시 links/tags/glossary/검색 인덱스가 모두 재동기화되며, "
        "`metadata.part` 한글 이름도 자동 해석된다."
    ),
)
async def replace_document(
    slug: str,
    payload: dict[str, Any],
    response: Response,
    background_tasks: BackgroundTasks,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    doc, warnings = await document_service.replace_document(
        s,
        slug=slug,
        payload=payload,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
        background_tasks=background_tasks,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    meta: dict[str, Any] = {"etag": etag}
    if warnings:
        meta["warnings"] = warnings
    return envelope(
        data={
            "id": doc["id"],
            "slug": doc["slug"],
            "title": doc["title"],
            "version": doc["version"],
            "status": doc["status"],
        },
        meta=meta,
    )


@router.delete(
    "/{slug}",
    status_code=204,
    summary="문서 archive (soft delete)",
    description="status='archived' 로 표시. 검색 인덱스에서 제거되며 list 결과에 노출되지 않는다.",
)
async def delete_document(
    slug: str,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> None:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    await document_service.archive_document(s, slug=slug, actor_id=actor)


# ── Backlinks (Sprint 3) ────────────────────────────────────────────
# Missing slugs are intentionally NOT 404 — the wiki-link grammar permits
# pointing at not-yet-written pages, and the FE renders a "이 문서 작성하기"
# affordance using these results. Lookup by `target_slug` so unresolved
# links still surface their referrers.
@router.get(
    "/{slug}/backlinks",
    summary="역링크 (이 문서를 가리키는 다른 문서)",
)
async def get_backlinks(
    slug: str,
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    target = await document_repo.find_by_slug(s, slug)
    target_doc_id = target["id"] if target and target["status"] != "archived" else None
    items = await document_repo.list_backlinks(
        s, target_doc_id=target_doc_id, target_slug=slug
    )
    return envelope(
        data=items,
        meta={"total": len(items), "target_exists": target is not None and target["status"] != "archived"},
    )


# ── Versions ──────────────────────────────────────────────────────────
# Sprint 1: list + get. Sprint 4: restore (below). Diff is computed
# client-side by `<VersionDiffPage>` via two `getVersion()` fetches +
# `diffDocument()` — no BE diff endpoint needed. Delete is intentionally
# absent: versions are immutable audit history, retention is handled by
# the platform retention policy rather than per-row deletion.
@router.get("/{slug}/versions", summary="문서 버전 목록 (최신순)")
async def list_document_versions(
    slug: str,
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    doc = await document_service.get_document_or_404(s, slug)
    items = await document_repo.list_versions(s, doc_id=doc["id"])
    return envelope(data=items, meta={"total": len(items)})


@router.get("/{slug}/versions/{n}", summary="특정 버전의 본문 조회")
async def get_document_version(
    slug: str,
    n: int,
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    doc = await document_service.get_document_or_404(s, slug)
    ver = await document_repo.find_version(s, doc_id=doc["id"], version=n)
    if not ver:
        raise NotFound(f"version not found: {slug}@{n}")
    content = document_service.scrub_for_response(
        ver["content_json"], role=_user.get("role")
    )
    return envelope(
        data={
            "slug": doc["slug"],
            "version": ver["version"],
            "edited_by": ver["edited_by"],
            "edited_by_name": ver["edited_by_name"],
            "edited_at": ver["edited_at"],
            "change_log": ver["change_log"],
            "content": content,
        }
    )


# ── Sprint 4: Versions restore ──────────────────────────────────────
# NOTE: 의도적으로 If-Match 를 요구하지 않는다.
#   복원은 사용자가 명시적으로 "이 시점으로 되돌린다" 는 동작이며,
#   현 head 의 etag 를 모르더라도 수행 가능해야 한다.
@router.post(
    "/{slug}/versions/{n}/restore",
    summary="이전 버전 복원 (의도적 If-Match 면제)",
)
async def restore_document_version(
    slug: str,
    n: int,
    response: Response,
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    doc = await document_service.restore_version(
        s, slug=slug, version=n, actor_id=actor
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "restored_from": n,
        },
        meta={"etag": etag, "change_log": f"restore-from-v{n}"},
    )


@router.patch(
    "/{slug}/title",
    summary="문서 제목/요약 갱신",
    description=(
        "문서의 `title` (필수) 과 옵션으로 `summary` 를 갱신한다. "
        "`If-Match` 필수. payload: `{title: string, summary?: string|null}` — "
        "`summary` 키가 본문에 포함되면 함께 갱신되며, 빈 문자열/null 이면 summary 필드가 제거된다."
    ),
)
async def patch_title(
    slug: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    if not isinstance(payload, dict):
        from app.core.errors import ValidationFailed
        raise ValidationFailed("payload must be an object")
    title = payload.get("title")
    update_summary = "summary" in payload
    summary = payload.get("summary") if update_summary else None
    doc = await document_service.patch_title(
        s,
        slug=slug,
        title=title if isinstance(title, str) else "",
        summary=summary if isinstance(summary, str) or summary is None else None,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
        update_summary=update_summary,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "title": doc["title"],
            "summary": (doc.get("content_json") or {}).get("summary"),
        },
        meta={"etag": etag},
    )


@router.patch(
    "/{slug}/infobox",
    summary="문서 infobox(주요 정보 박스) 갱신",
    description=(
        "DocumentJSON 의 `infobox` 객체를 통째로 교체한다. `If-Match` 헤더로 "
        "낙관적 동시성 보장. 빈 문자열 / 빈 배열 / null 은 자동 제거된다. "
        "payload: `{infobox: {라벨: 값 | [값1, 값2, ...]}}`"
    ),
)
async def patch_infobox(
    slug: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    infobox = payload.get("infobox") if isinstance(payload, dict) else None
    if infobox is None:
        infobox = {}
    doc = await document_service.patch_infobox(
        s,
        slug=slug,
        infobox=infobox,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "infobox": (doc.get("content_json") or {}).get("infobox") or {},
        },
        meta={"etag": etag},
    )


@router.patch(
    "/{slug}/variables",
    summary="문서 변수(mail-merge) 맵 갱신",
    description=(
        "DocumentJSON 의 `variables` 객체를 통째로 교체한다. `If-Match` 헤더로 "
        "낙관적 동시성 보장. 빈 문자열은 자동 제거된다. payload: `{variables: {name: value}}`"
    ),
)
async def patch_variables(
    slug: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    variables = payload.get("variables") if isinstance(payload, dict) else None
    if variables is None:
        variables = {}
    doc = await document_service.patch_variables(
        s,
        slug=slug,
        variables=variables,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "variables": (doc.get("content_json") or {}).get("variables") or {},
        },
        meta={"etag": etag},
    )


@router.patch(
    "/{slug}/custom-css",
    summary="문서 custom CSS (admin-only branding) 갱신",
    description=(
        "DocumentJSON 의 ``custom_css`` 문자열을 sanitize 후 교체한다. "
        "관리자(admin) 전용. ``<script>``, ``expression()``, "
        "``url(javascript:)``, ``@import``, ``behavior:`` 등은 자동 제거되며 "
        "제거된 패턴은 ``meta.warnings`` 로 반환된다. "
        "최대 10000 chars. 빈 문자열은 필드를 제거한다. ``If-Match`` 필요."
    ),
)
async def patch_custom_css(
    slug: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_admin),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    raw_css = payload.get("custom_css") if isinstance(payload, dict) else None
    if raw_css is None:
        raw_css = ""
    doc, safe_css, warnings = await document_service.patch_custom_css(
        s,
        slug=slug,
        raw_css=raw_css,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "custom_css": safe_css,
        },
        meta={"etag": etag, "warnings": warnings},
    )


# ── Sprint 4: Section/Block 편집 ────────────────────────────────────
@router.patch(
    "/{slug}/sections/{section_id}",
    summary="섹션 부분 PATCH (title/level/blocks/subsections)",
    description="If-Match 필요. level 변경은 parent_level+1 규칙을 따라야 한다.",
)
async def patch_section(
    slug: str,
    section_id: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    doc, section = await document_service.patch_section(
        s,
        slug=slug,
        section_id=section_id,
        patch=payload,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    section = document_service.scrub_section_for_response(
        section, role=user.get("role")
    )
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "section": section,
        },
        meta={"etag": etag},
    )


@router.patch(
    "/{slug}/blocks/{block_id}",
    summary="Block 통째 교체 (id 일치 필요, If-Match 필요)",
)
async def patch_block(
    slug: str,
    block_id: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    doc, block = await document_service.patch_block(
        s,
        slug=slug,
        block_id=block_id,
        new_block=payload,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    block = document_service.scrub_block_for_response(
        block, role=user.get("role")
    )
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "block": block,
        },
        meta={"etag": etag},
    )


@router.post(
    "/{slug}/blocks",
    status_code=201,
    summary="섹션 내부에 새 Block 삽입",
    description="payload: `{section_id, block, after_block_id?}`. after_block_id 가 없으면 끝에 append.",
)
async def insert_block(
    slug: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    section_id = payload.get("section_id")
    block = payload.get("block")
    after = payload.get("after_block_id")
    index_hint = payload.get("index")
    if not section_id or not isinstance(block, dict):
        from app.core.errors import ValidationFailed
        raise ValidationFailed("section_id and block required")
    doc = await document_service.insert_block(
        s,
        slug=slug,
        section_id=section_id,
        after_block_id=after,
        index=index_hint if isinstance(index_hint, int) else None,
        new_block=block,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "block_id": block.get("id"),
        },
        meta={"etag": etag},
    )


@router.delete("/{slug}/blocks/{block_id}", summary="Block 삭제")
async def delete_block(
    slug: str,
    block_id: str,
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    doc = await document_service.delete_block(
        s,
        slug=slug,
        block_id=block_id,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    return envelope(
        data={"slug": doc["slug"], "version": doc["version"], "deleted": block_id},
        meta={"etag": etag},
    )


@router.post(
    "/{slug}/blocks/{block_id}/move",
    summary="Block 이동 (다른 섹션으로)",
    description="payload: `{target_section_id, after_block_id?}`",
)
async def move_block(
    slug: str,
    block_id: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    # Accept both the documented `target_section_id` and the FE alias
    # `to_section_id` (BlockToolbar ↑/↓, BulkActionsBar). Same for the
    # within-section position: `after_block_id` (canonical) or `to_index`
    # (FE).
    target_section_id = (
        payload.get("target_section_id") or payload.get("to_section_id")
    )
    after = payload.get("after_block_id")
    to_index_raw = payload.get("to_index")
    if not target_section_id:
        from app.core.errors import ValidationFailed
        raise ValidationFailed("target_section_id required")
    doc = await document_service.move_block(
        s,
        slug=slug,
        block_id=block_id,
        target_section_id=target_section_id,
        after_block_id=after,
        to_index=to_index_raw if isinstance(to_index_raw, int) else None,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    return envelope(
        data={"slug": doc["slug"], "version": doc["version"], "moved": block_id},
        meta={"etag": etag},
    )


@router.post(
    "/{slug}/sections/reorder",
    summary="섹션 트리 재정렬 (outline 전체 교체)",
    description="payload: `{outline: [{id, children?: [...]}]}` — 모든 기존 섹션 id 가 포함되어야 한다.",
)
async def reorder_sections(
    slug: str,
    payload: dict[str, Any],
    response: Response,
    if_match: str | None = Header(default=None, alias="If-Match"),
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    x_change_log: str | None = Header(default=None, alias="X-MXWP-Change-Log"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    outline = payload.get("outline")
    if not isinstance(outline, list):
        from app.core.errors import ValidationFailed
        raise ValidationFailed("outline (list) required")
    doc = await document_service.reorder_sections(
        s,
        slug=slug,
        outline=outline,
        if_match=if_match,
        actor_id=actor,
        change_log=x_change_log,
    )
    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["ETag"] = etag
    scrubbed = document_service.scrub_for_response(
        doc["content_json"], role=user.get("role")
    )
    return envelope(
        data={
            "slug": doc["slug"],
            "version": doc["version"],
            "sections": scrubbed["sections"],
        },
        meta={"etag": etag},
    )


# ── 조회 추적 (Tier 2D) ──────────────────────────────────────────────────
@router.post(
    "/{slug}/view",
    summary="문서 조회 ping (analytics 용)",
    status_code=204,
)
async def ping_view(
    slug: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_reader),
) -> Response:
    """문서 본문 조회 시 FE 가 호출. audit_logs 에 'document.view' 1건 기록.

    중복 호출 자체는 막지 않지만, FE 가 mount 1회 호출만 하므로 폭주는 없다.
    혹시 모를 폭주를 막기 위해 같은 user+slug 가 60초 내 또 들어오면 skip.
    """
    row = (await s.execute(
        _sql_text("""
            SELECT 1 FROM audit_logs
            WHERE user_id = CAST(:u AS uuid)
              AND action = 'document.view'
              AND target = :t
              AND created_at >= NOW() - INTERVAL '60 seconds'
            LIMIT 1
        """),
        {"u": user["id"], "t": f"document:{slug}"},
    )).first()
    if row is None:
        await document_repo.insert_audit(
            s,
            user_id=user.get("id"),
            action="document.view",
            target=f"document:{slug}",
            payload=None,
        )
        await s.commit()
    return Response(status_code=204)
