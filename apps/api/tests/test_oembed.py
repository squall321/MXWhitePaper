"""oEmbed provider — happy/error paths.

Covers:
- happy path on a reader-accessible doc
- missing url param → 422 (FastAPI validates required Query)
- invalid host (not on our domain) → 404
- archived doc → 403
- restricted doc → 403 (without auth)
- maxwidth/maxheight clamping
- thumbnail_url falls back to provider default when doc has no images
- format=xml not supported → 501
- discovery <link> tag is present in the BE-rendered HTML export
"""
from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import get_db
from app.main import app

# A reader-accessible seed doc (same fixture used by sharing/html-export tests).
SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def _new_session():
    gen = get_db()
    s = await anext(gen)
    return s, gen


async def _close_session(gen) -> None:
    try:
        await anext(gen)
    except StopAsyncIteration:
        pass


def _doc_url(slug: str = SEED_SLUG) -> str:
    base = get_settings().web_base_url.rstrip("/")
    return f"{base}/docs/{slug}"


# ── Happy path ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oembed_happy_path() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/oembed", params={"url": _doc_url()})
    assert r.status_code == 200, r.text
    data = r.json()
    # Must match the oEmbed spec's required fields for `type=rich`.
    assert data["version"] == "1.0"
    assert data["type"] == "rich"
    assert data["title"]
    assert data["provider_name"] == "MX White Paper"
    assert data["provider_url"]
    assert data["html"].startswith("<blockquote")
    assert "mxwp-embed" in data["html"]
    assert SEED_SLUG in data["html"]  # cite URL embedded
    # Default sizes — clamping inactive when no maxwidth/maxheight given.
    assert data["width"] == 600
    assert data["height"] == 200
    assert data["thumbnail_width"] == 1200
    assert data["thumbnail_height"] == 630


# ── Missing param ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oembed_missing_url_param() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/oembed")
    # FastAPI validates required Query → 422.
    assert r.status_code == 422


# ── Wrong host ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oembed_rejects_foreign_host() -> None:
    async with await _client() as ac:
        r = await ac.get(
            "/api/v1/oembed",
            params={"url": f"https://evil.example.com/docs/{SEED_SLUG}"},
        )
    assert r.status_code == 404
    body = r.json()
    assert body["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_oembed_rejects_non_doc_path() -> None:
    base = get_settings().web_base_url.rstrip("/")
    async with await _client() as ac:
        r = await ac.get(
            "/api/v1/oembed", params={"url": f"{base}/admin/users"}
        )
    assert r.status_code == 404


# ── Archived doc ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oembed_refuses_archived_doc() -> None:
    """Flip status=archived for a copy slug, hit oembed, restore."""
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                "UPDATE documents SET status = 'archived' WHERE slug = :slug"
            ),
            {"slug": SEED_SLUG},
        )
        await s.commit()
    finally:
        await _close_session(gen)

    try:
        async with await _client() as ac:
            r = await ac.get("/api/v1/oembed", params={"url": _doc_url()})
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "FORBIDDEN"
    finally:
        # Restore so other tests that assume the seed doc keep passing.
        s2, gen2 = await _new_session()
        try:
            await s2.execute(
                text(
                    "UPDATE documents SET status = 'published' WHERE slug = :slug"
                ),
                {"slug": SEED_SLUG},
            )
            await s2.commit()
        finally:
            await _close_session(gen2)


# ── Restricted doc ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oembed_refuses_restricted_doc() -> None:
    """Mutate the doc body so metadata.confidentiality='restricted' and
    confirm the public oembed endpoint refuses it. Restore afterwards."""
    s, gen = await _new_session()
    try:
        row = (await s.execute(
            text("SELECT content_json FROM documents WHERE slug = :slug"),
            {"slug": SEED_SLUG},
        )).first()
        original_body = row[0]
        if isinstance(original_body, str):
            original_body = json.loads(original_body)
        # Patch the in-memory dict and write back.
        patched = json.loads(json.dumps(original_body))  # deep copy
        patched.setdefault("metadata", {})["confidentiality"] = "restricted"
        await s.execute(
            text(
                "UPDATE documents SET content_json = CAST(:body AS JSONB) "
                "WHERE slug = :slug"
            ),
            {"body": json.dumps(patched, ensure_ascii=False), "slug": SEED_SLUG},
        )
        await s.commit()
    finally:
        await _close_session(gen)

    try:
        async with await _client() as ac:
            r = await ac.get("/api/v1/oembed", params={"url": _doc_url()})
        assert r.status_code == 403, r.text
    finally:
        s2, gen2 = await _new_session()
        try:
            await s2.execute(
                text(
                    "UPDATE documents SET content_json = CAST(:body AS JSONB) "
                    "WHERE slug = :slug"
                ),
                {
                    "body": json.dumps(original_body, ensure_ascii=False),
                    "slug": SEED_SLUG,
                },
            )
            await s2.commit()
        finally:
            await _close_session(gen2)


# ── Clamping ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oembed_clamps_width_and_height() -> None:
    async with await _client() as ac:
        r = await ac.get(
            "/api/v1/oembed",
            params={"url": _doc_url(), "maxwidth": 300, "maxheight": 150},
        )
    assert r.status_code == 200
    data = r.json()
    # Caller-provided maxes win over defaults but stay within sane bounds.
    assert data["width"] == 300
    assert data["height"] == 150
    assert data["thumbnail_width"] == 300
    assert data["thumbnail_height"] == 150


@pytest.mark.asyncio
async def test_oembed_clamps_to_minimum_when_caller_passes_too_small() -> None:
    async with await _client() as ac:
        # ge=1 is enforced by Query — anything ≥1 is accepted, then internal
        # clamp lifts it to the floor (80).
        r = await ac.get(
            "/api/v1/oembed",
            params={"url": _doc_url(), "maxwidth": 10, "maxheight": 10},
        )
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 80
    assert data["height"] == 80


# ── Thumbnail fallback ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oembed_thumbnail_falls_back_when_no_images() -> None:
    """The seed `month-end-closing` doc has no images in its body — confirm
    we surface the provider's default OG image rather than failing."""
    base = get_settings().web_base_url.rstrip("/")
    async with await _client() as ac:
        r = await ac.get("/api/v1/oembed", params={"url": _doc_url()})
    assert r.status_code == 200
    thumb = r.json()["thumbnail_url"]
    # Either the default `/og-default.png` OR a real MinIO URL — pin only
    # the contract: thumbnail_url is always present and absolute-ish.
    assert thumb
    assert thumb.startswith(("http://", "https://", "/")) or thumb.startswith(base)


# ── XML format ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_oembed_xml_format_returns_501() -> None:
    async with await _client() as ac:
        r = await ac.get(
            "/api/v1/oembed",
            params={"url": _doc_url(), "format": "xml"},
        )
    assert r.status_code == 501, r.text
    assert r.json()["error"]["code"] == "NOT_IMPLEMENTED"


# ── Discovery <link> in the BE-rendered HTML export ───────────────────


@pytest.mark.asyncio
async def test_html_export_embeds_oembed_discovery_link() -> None:
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/documents/{SEED_SLUG}/export.html")
    assert r.status_code == 200
    body = r.content.decode("utf-8")
    assert 'rel="alternate"' in body
    assert 'type="application/json+oembed"' in body
    assert "/api/v1/oembed" in body
    assert SEED_SLUG in body  # the link includes the canonical doc URL
