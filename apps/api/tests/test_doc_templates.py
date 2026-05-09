"""Doc-template CRUD + scope filter + use_count + /use endpoint tests.

Mirrors the snippets test surface but exercises the per-document template
table (cycle 0020). The /use helper is the most distinctive bit — it
creates a brand-new doc from the template's sections atomically and
bumps the template's use_count.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


def _sample_sections() -> list[dict]:
    return [
        {
            "id": "01ABCDEFGH0123456789ABCDEF",
            "level": 1,
            "number": "1",
            "title": "개요",
            "blocks": [
                {
                    "type": "paragraph",
                    "id": "01ABCDEFGH0123456789ABCDFF",
                    "text": "샘플 본문",
                }
            ],
            "subsections": [],
        }
    ]


async def _wipe_owned(ac: AsyncClient) -> None:
    """Best-effort delete of every template the calling user can see."""
    r = await ac.get("/api/v1/doc-templates?limit=500")
    if r.status_code != 200:
        return
    for it in r.json()["data"]["items"]:
        await ac.delete(f"/api/v1/doc-templates/{it['slug']}")


@pytest.mark.asyncio
async def test_create_then_list_then_get_bumps_use_count() -> None:
    async with await _client() as ac:
        await _wipe_owned(ac)
        slug = f"tpl-{uuid.uuid4().hex[:8]}"
        r = await ac.post(
            "/api/v1/doc-templates",
            json={
                "slug": slug,
                "title": "Sample template",
                "description": "demo",
                "category": "report",
                "scope": "private",
                "sections": _sample_sections(),
            },
        )
        assert r.status_code == 201, r.text
        try:
            # List sees it.
            r2 = await ac.get("/api/v1/doc-templates")
            assert r2.status_code == 200
            items = r2.json()["data"]["items"]
            match = next((it for it in items if it["slug"] == slug), None)
            assert match is not None
            assert match["title"] == "Sample template"
            assert match["section_count"] == 1
            assert match["use_count"] == 0

            # Single fetch bumps use_count.
            r3 = await ac.get(f"/api/v1/doc-templates/{slug}")
            assert r3.status_code == 200
            data = r3.json()["data"]
            assert data["use_count"] == 1
            assert data["sections"][0]["title"] == "개요"

            # Second GET bumps again.
            r4 = await ac.get(f"/api/v1/doc-templates/{slug}")
            assert r4.json()["data"]["use_count"] == 2
        finally:
            await ac.delete(f"/api/v1/doc-templates/{slug}")


@pytest.mark.asyncio
async def test_patch_updates_title_scope_category() -> None:
    async with await _client() as ac:
        slug = f"tpl-{uuid.uuid4().hex[:8]}"
        r = await ac.post(
            "/api/v1/doc-templates",
            json={
                "slug": slug,
                "title": "before",
                "category": "custom",
                "sections": _sample_sections(),
                "scope": "private",
            },
        )
        assert r.status_code == 201, r.text
        try:
            r2 = await ac.patch(
                f"/api/v1/doc-templates/{slug}",
                json={"title": "after", "scope": "org", "category": "tech"},
            )
            assert r2.status_code == 200, r2.text
            data = r2.json()["data"]
            assert data["title"] == "after"
            assert data["scope"] == "org"
            assert data["category"] == "tech"
        finally:
            await ac.delete(f"/api/v1/doc-templates/{slug}")


@pytest.mark.asyncio
async def test_create_rejects_empty_sections() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/doc-templates",
            json={
                "title": "x",
                "category": "custom",
                "sections": [],
                "scope": "private",
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rejects_invalid_scope_and_category() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/doc-templates",
            json={
                "title": "x",
                "category": "custom",
                "sections": _sample_sections(),
                "scope": "wat",
            },
        )
        assert r.status_code == 422
        r2 = await ac.post(
            "/api/v1/doc-templates",
            json={
                "title": "x",
                "category": "totally-bogus",
                "sections": _sample_sections(),
                "scope": "private",
            },
        )
        assert r2.status_code == 422


@pytest.mark.asyncio
async def test_get_unknown_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.get("/api/v1/doc-templates/no-such-template-xyz")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_scope_and_category_filter() -> None:
    async with await _client() as ac:
        a = f"tpl-{uuid.uuid4().hex[:8]}"
        b = f"tpl-{uuid.uuid4().hex[:8]}"
        r1 = await ac.post(
            "/api/v1/doc-templates",
            json={
                "slug": a,
                "title": "alpha-beta-gamma",
                "category": "report",
                "scope": "org",
                "sections": _sample_sections(),
            },
        )
        r2 = await ac.post(
            "/api/v1/doc-templates",
            json={
                "slug": b,
                "title": "delta",
                "category": "tech",
                "scope": "private",
                "sections": _sample_sections(),
            },
        )
        assert r1.status_code == 201, r1.text
        assert r2.status_code == 201, r2.text
        try:
            r_org = await ac.get("/api/v1/doc-templates?scope=org")
            slugs_org = [it["slug"] for it in r_org.json()["data"]["items"]]
            assert a in slugs_org
            assert b not in slugs_org

            r_cat = await ac.get("/api/v1/doc-templates?category=tech")
            slugs_cat = [it["slug"] for it in r_cat.json()["data"]["items"]]
            assert b in slugs_cat
            assert a not in slugs_cat

            r_q = await ac.get("/api/v1/doc-templates?q=beta")
            slugs_q = [it["slug"] for it in r_q.json()["data"]["items"]]
            assert a in slugs_q
            assert b not in slugs_q
        finally:
            await ac.delete(f"/api/v1/doc-templates/{a}")
            await ac.delete(f"/api/v1/doc-templates/{b}")


@pytest.mark.asyncio
async def test_delete_then_get_returns_404() -> None:
    async with await _client() as ac:
        slug = f"tpl-{uuid.uuid4().hex[:8]}"
        r = await ac.post(
            "/api/v1/doc-templates",
            json={
                "slug": slug,
                "title": "to-delete",
                "category": "custom",
                "sections": _sample_sections(),
                "scope": "private",
            },
        )
        assert r.status_code == 201, r.text
        rd = await ac.delete(f"/api/v1/doc-templates/{slug}")
        assert rd.status_code == 204
        rg = await ac.get(f"/api/v1/doc-templates/{slug}")
        assert rg.status_code == 404


@pytest.mark.asyncio
async def test_use_endpoint_creates_doc_and_bumps_use_count() -> None:
    """`/use` builds a fresh doc from the template and increments use_count."""
    async with await _client() as ac:
        slug = f"tpl-{uuid.uuid4().hex[:8]}"
        target = f"new-{uuid.uuid4().hex[:8]}"
        r = await ac.post(
            "/api/v1/doc-templates",
            json={
                "slug": slug,
                "title": "Use template",
                "category": "custom",
                "sections": _sample_sections(),
                "scope": "private",
            },
        )
        assert r.status_code == 201, r.text
        try:
            r_use = await ac.post(
                f"/api/v1/doc-templates/{slug}/use",
                json={"target_slug": target, "title": "From template"},
            )
            assert r_use.status_code == 201, r_use.text
            data = r_use.json()["data"]
            assert data["slug"] == target

            # New doc actually exists.
            r_doc = await ac.get(f"/api/v1/documents/{target}")
            assert r_doc.status_code == 200, r_doc.text

            # use_count bumped.
            r_meta = await ac.get(f"/api/v1/doc-templates/{slug}")
            # GET also bumps, so >= 2 here.
            assert r_meta.json()["data"]["use_count"] >= 2

            # Cleanup the spawned doc.
            await ac.delete(f"/api/v1/documents/{target}")
        finally:
            await ac.delete(f"/api/v1/doc-templates/{slug}")


@pytest.mark.asyncio
async def test_use_rejects_invalid_target_slug() -> None:
    async with await _client() as ac:
        slug = f"tpl-{uuid.uuid4().hex[:8]}"
        r = await ac.post(
            "/api/v1/doc-templates",
            json={
                "slug": slug,
                "title": "x",
                "category": "custom",
                "sections": _sample_sections(),
                "scope": "private",
            },
        )
        assert r.status_code == 201, r.text
        try:
            r_use = await ac.post(
                f"/api/v1/doc-templates/{slug}/use",
                json={"target_slug": "BAD SLUG WITH SPACES"},
            )
            assert r_use.status_code == 422
        finally:
            await ac.delete(f"/api/v1/doc-templates/{slug}")


@pytest.mark.asyncio
async def test_create_duplicate_slug_returns_409() -> None:
    async with await _client() as ac:
        slug = f"tpl-{uuid.uuid4().hex[:8]}"
        r1 = await ac.post(
            "/api/v1/doc-templates",
            json={
                "slug": slug,
                "title": "first",
                "category": "custom",
                "sections": _sample_sections(),
                "scope": "private",
            },
        )
        assert r1.status_code == 201, r1.text
        try:
            r2 = await ac.post(
                "/api/v1/doc-templates",
                json={
                    "slug": slug,
                    "title": "second",
                    "category": "custom",
                    "sections": _sample_sections(),
                    "scope": "private",
                },
            )
            assert r2.status_code == 409, r2.text
        finally:
            await ac.delete(f"/api/v1/doc-templates/{slug}")
