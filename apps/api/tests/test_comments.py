"""Tier 2C — comments workflow."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

SEED_SLUG = "month-end-closing"


@pytest.mark.asyncio
async def test_create_then_list_comments() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={
                "anchor_kind": "document",
                "body_md": "첫 댓글입니다.",
            },
        )
        assert r1.status_code == 201, r1.text
        cid = r1.json()["data"]["id"]
        assert cid

        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={
                "anchor_kind": "document",
                "body_md": "답글입니다.",
                "parent_id": cid,
            },
        )
        assert r2.status_code == 201, r2.text
        reply = r2.json()["data"]
        assert reply["parent_id"] == cid

        r3 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/comments")
        assert r3.status_code == 200
        items = r3.json()["data"]["items"]
        assert any(it["id"] == cid for it in items)
        assert any(it["parent_id"] == cid for it in items)


@pytest.mark.asyncio
async def test_section_anchor_required_for_section() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "section", "body_md": "missing anchor"},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_comment_changes_body() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "before"},
        )
        cid = r.json()["data"]["id"]
        r2 = await ac.patch(
            f"/api/v1/comments/{cid}",
            json={"body_md": "after"},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["data"]["body_md"] == "after"


@pytest.mark.asyncio
async def test_delete_marks_deleted() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/comments",
            json={"anchor_kind": "document", "body_md": "to be deleted"},
        )
        cid = r.json()["data"]["id"]
        r2 = await ac.delete(f"/api/v1/comments/{cid}")
        assert r2.status_code == 204

        r3 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/comments")
        items = r3.json()["data"]["items"]
        gone = next((it for it in items if it["id"] == cid), None)
        assert gone is not None
        assert gone["status"] == "deleted"


@pytest.mark.asyncio
async def test_get_for_missing_doc_returns_404() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/documents/no-such-slug-xyz/comments")
        assert r.status_code == 404
