"""oEmbed provider — external rich-preview endpoint.

External chat / docs apps (Slack, Notion, Discord, Teams, Linear …) follow the
oEmbed spec (https://oembed.com/) when a user pastes a link. Given a doc URL
like ``https://mxwhitepaper.com/docs/foo`` they hit::

    GET /api/v1/oembed?url=<encoded-doc-url>&maxwidth=&maxheight=&format=json

and render the returned JSON's ``html`` block as a rich preview.

This endpoint is **public** (no auth) — it behaves like a share link but
read-only and metadata-only. We refuse to expose ``archived`` or
``confidentiality='restricted'`` documents so a leaked URL can't pull a
sensitive title/summary out of the wiki. ``internal`` and ``public`` docs
are fine.

Auto-discovery: the BE-rendered HTML export embeds a
``<link rel="alternate" type="application/json+oembed" …>`` tag in its head
so a crawler that already has the page can discover the endpoint. Full SSR
of the SPA shell at ``/docs/:slug`` is a follow-up — until then external
clients should hit oEmbed directly with the canonical URL.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError, Forbidden, NotFound
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["oembed"])


# ── Defaults / clamps ──────────────────────────────────────────────────

# Open Graph / Twitter card 1.91:1 default size — most chat apps render at
# this aspect ratio, so we expose it as the canonical thumbnail dimensions.
_DEFAULT_THUMB_W = 1200
_DEFAULT_THUMB_H = 630

# Default rich-card box. The HTML returned in `html` is a static
# <blockquote> so the embedder can re-style or strip it freely.
_DEFAULT_W = 600
_DEFAULT_H = 200

# Minimum sane sizes — clamping protects the rendered card from a 0×0 box.
_MIN_DIM = 80
_MAX_DIM = 4096


class _NotImplemented(APIError):
    """501 — `format=xml` is not supported (we only ship JSON)."""

    code = "NOT_IMPLEMENTED"
    http_status = 501
    message = "Not implemented"


# ── URL parsing ────────────────────────────────────────────────────────


def _parse_doc_url(url: str, web_base_url: str) -> tuple[str, str | None]:
    """Validate the URL is on our domain and extract ``(slug, anchor)``.

    Raises :class:`NotFound` for unknown hosts or malformed paths so the
    caller surfaces a 404 — leaking 'wrong host' as a separate code helps
    nobody.

    Accepted shapes::

        https://mxwhitepaper.com/docs/<slug>
        https://mxwhitepaper.com/docs/<slug>#section-1.2
        /docs/<slug>          (relative — host is inferred from web_base_url)
    """
    if not url:
        raise NotFound("url is required")

    decoded = unquote(url)
    parsed = urlparse(decoded)
    base = urlparse(web_base_url)

    # Relative URLs are accepted — the host is implicitly ours.
    if parsed.scheme and parsed.netloc:
        if (parsed.scheme, parsed.netloc) != (base.scheme, base.netloc):
            raise NotFound(f"url is not on our domain: {parsed.netloc}")

    path = parsed.path or ""
    parts = [p for p in path.split("/") if p]
    if len(parts) < 2 or parts[0] != "docs":
        raise NotFound("url is not a doc page")
    slug = parts[1]
    if not slug:
        raise NotFound("url is missing a slug")

    anchor = parsed.fragment or None
    return slug, anchor


def _clamp(v: int | None, default: int) -> int:
    if v is None:
        return default
    if v < _MIN_DIM:
        return _MIN_DIM
    if v > _MAX_DIM:
        return _MAX_DIM
    return v


# ── Doc → oEmbed payload ───────────────────────────────────────────────


def _first_image_url(content: dict[str, Any]) -> str | None:
    """Walk the doc tree, return the first ``image.imageId`` we find.

    The oEmbed payload only exposes a *URL* string, so we don't bother
    resolving the image to MinIO here — instead we punt to a default
    fallback URL when no image is in the body. Resolving every preview
    to a MinIO presigned URL would add a DB hit + S3 round-trip on a hot
    public path, and chat apps cache the response for 24h+ anyway.
    """
    sections = content.get("sections") or []

    def walk_blocks(blocks: list[dict[str, Any]]) -> str | None:
        for b in blocks or []:
            t = b.get("type")
            if t == "image":
                v = b.get("imageId") or b.get("image_id")
                if v:
                    return str(v)
            elif t == "gallery":
                for it in b.get("items") or []:
                    v = it.get("imageId") or it.get("image_id")
                    if v:
                        return str(v)
            elif t == "columns":
                for col in b.get("columns") or []:
                    found = walk_blocks(col)
                    if found:
                        return found
            elif t == "tabs":
                for tab in b.get("tabs") or []:
                    found = walk_blocks(tab.get("blocks") or [])
                    if found:
                        return found
            elif t == "accordion":
                for it in b.get("items") or []:
                    found = walk_blocks(it.get("blocks") or [])
                    if found:
                        return found
        return None

    def walk_sections(secs: list[dict[str, Any]]) -> str | None:
        for s in secs or []:
            found = walk_blocks(s.get("blocks") or [])
            if found:
                return found
            found = walk_sections(s.get("subsections") or [])
            if found:
                return found
        return None

    return walk_sections(sections)


async def _fetch_image_view_url(
    s: AsyncSession, image_id: str
) -> str | None:
    """Resolve an imageId (ULID or UUID) to its public MinIO ``view.webp`` URL.

    Mirrors the helper used in the documents/exports routers. Returns ``None``
    when the row is missing — caller falls back to the provider default.
    """
    import re

    from app.storage import minio_adapter

    settings = get_settings()
    bucket = settings.minio_bucket_images

    ulid_re = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
    uuid_re = re.compile(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        re.IGNORECASE,
    )

    sha: str | None = None
    if ulid_re.match(image_id):
        row = (await s.execute(
            text("SELECT sha256 FROM images WHERE ulid = :id"),
            {"id": image_id},
        )).first()
        if row:
            sha = row[0]
    elif uuid_re.match(image_id):
        row = (await s.execute(
            text("SELECT sha256 FROM images WHERE id = CAST(:id AS uuid)"),
            {"id": image_id},
        )).first()
        if row:
            sha = row[0]
    if not sha:
        return None
    key = f"{sha[0:2]}/{sha[2:4]}/{sha}/view.webp"
    return minio_adapter.public_url(bucket, key)


async def _fetch_owner_name(
    s: AsyncSession, owner_id: str | None
) -> str | None:
    if not owner_id:
        return None
    row = (await s.execute(
        text("SELECT name FROM users WHERE id = CAST(:id AS uuid)"),
        {"id": owner_id},
    )).first()
    return row[0] if row else None


def _escape_html(s: str) -> str:
    """Tiny HTML-escape for the rich `html` payload.

    We can't reach for jinja here — keep it explicit and minimal.
    """
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def _render_card_html(
    *,
    title: str,
    summary: str,
    division: str,
    team: str,
    last_edited: str,
    cite_url: str,
) -> str:
    """Static <blockquote> rendered by the embedder.

    The shape lifts straight from the mandate — `mxwp-embed` class lets a
    consumer style it via their own CSS, but the markup is self-explanatory
    even with default styles.
    """
    title_e = _escape_html(title)
    summary_e = _escape_html(summary)
    cite_e = _escape_html(cite_url)
    footer_bits = []
    division_team = " / ".join(p for p in (division, team) if p)
    if division_team:
        footer_bits.append(_escape_html(division_team))
    if last_edited:
        footer_bits.append(f"last edited {_escape_html(last_edited)}")
    footer = " — ".join(footer_bits)
    summary_block = (
        f"<p>{summary_e}</p>" if summary else ""
    )
    return (
        f'<blockquote class="mxwp-embed" cite="{cite_e}">'
        f"<h3>{title_e}</h3>"
        f"{summary_block}"
        f"<footer>{footer}</footer>"
        "</blockquote>"
    )


# ── Endpoint ───────────────────────────────────────────────────────────


@router.get(
    "/oembed",
    summary="oEmbed provider — rich preview metadata for external apps",
    description=(
        "외부 사이트 (Slack/Notion/Discord/Teams/Linear) 가 위키 URL 을 붙여넣을 때 "
        "rich preview 를 위해 호출하는 [oEmbed](https://oembed.com/) 엔드포인트. "
        "인증 불필요 — 공유 링크와 동일한 신뢰 모델을 따른다 (read-only metadata).\n\n"
        "- `url` 은 우리 도메인의 `/docs/<slug>` 형식이어야 한다.\n"
        "- `archived` 또는 `confidentiality='restricted'` 문서는 403 을 반환.\n"
        "- `format=xml` 은 미지원 — 501."
    ),
)
async def oembed_endpoint(
    url: str = Query(..., description="encoded canonical doc URL"),
    maxwidth: int | None = Query(default=None, ge=1, le=10_000),
    maxheight: int | None = Query(default=None, ge=1, le=10_000),
    format: str = Query(default="json"),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if format not in ("json",):
        # XML format is part of the spec but our consumers (Slack/Notion/…)
        # all happily take JSON. Punt with 501 rather than ship a half-baked
        # XML serializer.
        raise _NotImplemented("only format=json is supported")

    settings = get_settings()
    slug, anchor = _parse_doc_url(url, settings.web_base_url)

    doc = await document_repo.find_by_slug(s, slug)
    if not doc:
        raise NotFound(f"document not found: {slug}")
    if doc.get("status") == "archived":
        raise Forbidden("document is archived")

    content = doc.get("content_json") or {}
    metadata = (content.get("metadata") or {}) if isinstance(content, dict) else {}
    confidentiality = (metadata.get("confidentiality") or "").strip().lower()
    if confidentiality == "restricted":
        raise Forbidden("document is restricted")

    # Build canonical doc URL (strip trailing slash; preserve anchor).
    base = settings.web_base_url.rstrip("/")
    canonical_url = f"{base}/docs/{slug}"
    if anchor:
        canonical_url = f"{canonical_url}#{anchor}"

    # Owner / division / team for the card footer.
    owner_name = await _fetch_owner_name(s, doc.get("owner_id"))
    division = str(metadata.get("division") or "")
    team = str(metadata.get("team") or "")
    last_edited = str(doc.get("updated_at") or "")[:10]  # YYYY-MM-DD

    # Thumbnail: first image in the doc, or fall back to a generic provider
    # image. We surface a width/height hint regardless so embedders can
    # reserve layout space.
    thumb_id = _first_image_url(content) if isinstance(content, dict) else None
    thumb_url: str | None = None
    if thumb_id:
        thumb_url = await _fetch_image_view_url(s, thumb_id)
    if not thumb_url:
        thumb_url = f"{base}/og-default.png"

    title = str(doc.get("title") or slug)
    summary = str(doc.get("summary") or "")

    html_body = _render_card_html(
        title=title,
        summary=summary,
        division=division,
        team=team,
        last_edited=last_edited,
        cite_url=canonical_url,
    )

    width = _clamp(maxwidth, _DEFAULT_W)
    height = _clamp(maxheight, _DEFAULT_H)
    thumb_w = _clamp(maxwidth, _DEFAULT_THUMB_W)
    thumb_h = _clamp(maxheight, _DEFAULT_THUMB_H)

    payload: dict[str, Any] = {
        "version": "1.0",
        "type": "rich",
        "title": title,
        "author_name": owner_name or "",
        "author_url": f"/users/{doc.get('owner_id')}" if doc.get("owner_id") else "",
        "provider_name": "MX White Paper",
        "provider_url": settings.web_base_url,
        "thumbnail_url": thumb_url,
        "thumbnail_width": thumb_w,
        "thumbnail_height": thumb_h,
        "html": html_body,
        "width": width,
        "height": height,
    }

    # oEmbed consumers expect the bare object — not the project envelope —
    # because the spec is defined as a flat JSON document. We still wrap it
    # via `envelope(...)` would mangle that contract; return the raw shape.
    return payload


# ── Discovery helper for the BE-rendered HTML head ────────────────────


def build_discovery_link(slug: str, *, web_base_url: str) -> str:
    """Return the `<link rel="alternate" …>` tag for a given doc.

    Used by ``services/html_renderer`` so the BE-rendered export embeds the
    discovery metadata in its `<head>`. Crawlers that fetch the page can
    then auto-discover the oEmbed endpoint without knowing our URL scheme.
    """
    base = web_base_url.rstrip("/")
    href = f"{base}/api/v1/oembed?url={base}/docs/{slug}"
    return (
        f'<link rel="alternate" type="application/json+oembed" '
        f'href="{href}" title="MX White Paper oEmbed">'
    )
