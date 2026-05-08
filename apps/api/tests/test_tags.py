"""tags 라우터 — autocomplete / list-by-tag / rename / delete.

Workflow per test: POST 한 두 개의 문서 → tags 라우터 호출 → assertion → cleanup.
seed 의 다른 문서가 갖는 태그도 카운트에 섞여 들어올 수 있으므로, 테스트 픽스처는
충분히 unique 한 태그명을 사용한다 (`xtag-<uuid>`).
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.routers import tags as tags_module

SAMPLES = Path("/workspace/packages/shared/samples")
if not SAMPLES.exists():
    SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"


def _ulid_like() -> str:
    import secrets
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "".join(secrets.choice(alphabet) for _ in range(26))


def _unique_suffix() -> str:
    return uuid.uuid4().hex[:8]


async def _post_doc_with_tags(
    ac: AsyncClient,
    *,
    slug: str,
    title: str,
    tags: list[str],
) -> str:
    sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
    sample["slug"] = slug
    sample["id"] = _ulid_like()
    sample["title"] = title
    sample.setdefault("metadata", {})
    sample["metadata"]["tags"] = list(tags)
    r = await ac.post("/api/v1/documents", json=sample)
    assert r.status_code == 201, r.text
    return r.json()["data"]["slug"]


async def _cleanup(slugs: list[str]) -> None:
    if not slugs:
        return
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM documents WHERE slug = ANY(:slugs)"),
            {"slugs": slugs},
        )


@pytest.mark.asyncio
async def test_get_tags_empty_query_returns_aggregation() -> None:
    tags_module._cache_clear()
    suffix = _unique_suffix()
    t1 = f"xtag-alpha-{suffix}"
    t2 = f"xtag-beta-{suffix}"
    slug_a = f"tagtest-a-{suffix}"
    slug_b = f"tagtest-b-{suffix}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _post_doc_with_tags(ac, slug=slug_a, title="A", tags=[t1, t2])
        await _post_doc_with_tags(ac, slug=slug_b, title="B", tags=[t1])
        tags_module._cache_clear()

        r = await ac.get("/api/v1/tags", params={"limit": 200})

    try:
        assert r.status_code == 200, r.text
        items = r.json()["data"]
        names = {it["name"]: it["count"] for it in items}
        assert names.get(t1) == 2
        assert names.get(t2) == 1
        # Order: most-frequent first
        idx_t1 = next(i for i, it in enumerate(items) if it["name"] == t1)
        idx_t2 = next(i for i, it in enumerate(items) if it["name"] == t2)
        assert idx_t1 < idx_t2
    finally:
        await _cleanup([slug_a, slug_b])


@pytest.mark.asyncio
async def test_get_tags_with_prefix_filter() -> None:
    tags_module._cache_clear()
    suffix = _unique_suffix()
    matched = f"xprefix-match-{suffix}"
    other = f"xother-skip-{suffix}"
    slug_a = f"tagprefix-a-{suffix}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _post_doc_with_tags(ac, slug=slug_a, title="A", tags=[matched, other])
        tags_module._cache_clear()
        r = await ac.get("/api/v1/tags", params={"q": "xprefix-", "limit": 50})

    try:
        assert r.status_code == 200, r.text
        items = r.json()["data"]
        names = {it["name"] for it in items}
        assert matched in names
        assert other not in names
    finally:
        await _cleanup([slug_a])


@pytest.mark.asyncio
async def test_list_documents_for_tag_returns_only_tagged_docs() -> None:
    tags_module._cache_clear()
    suffix = _unique_suffix()
    target = f"xfilter-{suffix}"
    slug_a = f"tagdocs-a-{suffix}"
    slug_b = f"tagdocs-b-{suffix}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _post_doc_with_tags(ac, slug=slug_a, title="A target", tags=[target])
        await _post_doc_with_tags(ac, slug=slug_b, title="B unrelated", tags=[f"xother-{suffix}"])

        r = await ac.get(f"/api/v1/tags/{target}/documents")

    try:
        assert r.status_code == 200, r.text
        items = r.json()["data"]
        slugs = {it["slug"] for it in items}
        assert slug_a in slugs
        assert slug_b not in slugs
        # Card shape
        a_row = next(it for it in items if it["slug"] == slug_a)
        assert a_row["title"] == "A target"
        assert "updated_at" in a_row
    finally:
        await _cleanup([slug_a, slug_b])


@pytest.mark.asyncio
async def test_rename_tag_walks_all_docs_and_invalidates_cache() -> None:
    tags_module._cache_clear()
    suffix = _unique_suffix()
    src = f"xren-from-{suffix}"
    dst = f"xren-to-{suffix}"
    slug_a = f"rentest-a-{suffix}"
    slug_b = f"rentest-b-{suffix}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _post_doc_with_tags(ac, slug=slug_a, title="A", tags=[src, "keep"])
        await _post_doc_with_tags(ac, slug=slug_b, title="B", tags=[src])

        r = await ac.post(
            "/api/v1/tags/rename",
            json={"from": src, "to": dst},
        )

    try:
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        assert body["affected"] == 2

        # 새 태그로 검색하면 두 문서가 잡혀야 한다.
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r2 = await ac.get(f"/api/v1/tags/{dst}/documents")
        assert r2.status_code == 200
        slugs = {it["slug"] for it in r2.json()["data"]}
        assert slug_a in slugs
        assert slug_b in slugs

        # 옛 태그는 0건.
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r3 = await ac.get(f"/api/v1/tags/{src}/documents")
        assert r3.status_code == 200
        assert r3.json()["data"] == []
    finally:
        await _cleanup([slug_a, slug_b])


@pytest.mark.asyncio
async def test_delete_tag_removes_from_all_docs() -> None:
    tags_module._cache_clear()
    suffix = _unique_suffix()
    target = f"xdel-{suffix}"
    keep = f"xkeep-{suffix}"
    slug_a = f"deltest-a-{suffix}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _post_doc_with_tags(ac, slug=slug_a, title="A", tags=[target, keep])

        r = await ac.post("/api/v1/tags/delete", json={"tag": target})

    try:
        assert r.status_code == 200, r.text
        assert r.json()["data"]["affected"] == 1

        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r2 = await ac.get(f"/api/v1/tags/{target}/documents")
        assert r2.status_code == 200
        assert r2.json()["data"] == []

        # keep 태그는 여전히 살아 있어야 한다.
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r3 = await ac.get(f"/api/v1/tags/{keep}/documents")
        assert r3.status_code == 200
        assert any(it["slug"] == slug_a for it in r3.json()["data"])
    finally:
        await _cleanup([slug_a])


@pytest.mark.asyncio
async def test_rename_tag_validation_errors() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Empty `from`
        r1 = await ac.post("/api/v1/tags/rename", json={"from": "", "to": "x"})
        assert r1.status_code == 422
        # Empty `to`
        r2 = await ac.post("/api/v1/tags/rename", json={"from": "a", "to": ""})
        assert r2.status_code == 422
        # No-op (from == to) → affected == 0, not error
        r3 = await ac.post(
            "/api/v1/tags/rename",
            json={"from": "same", "to": "same"},
        )
        assert r3.status_code == 200
        assert r3.json()["data"]["affected"] == 0
