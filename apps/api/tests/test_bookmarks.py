"""Bookmarks CRUD + folder filtering."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def _wipe_existing(ac: AsyncClient) -> None:
    """Clean any previous bookmark for SEED_SLUG so each test starts clean."""
    r = await ac.get("/api/v1/bookmarks")
    if r.status_code != 200:
        return
    for it in r.json()["data"]["items"]:
        if it.get("slug") == SEED_SLUG:
            await ac.delete(f"/api/v1/bookmarks/{it['id']}")


@pytest.mark.asyncio
async def test_create_then_list_bookmark() -> None:
    async with await _client() as ac:
        await _wipe_existing(ac)

        r1 = await ac.post(
            "/api/v1/bookmarks",
            json={"document_id": SEED_SLUG, "folder": "기본", "notes": "첫 책갈피"},
        )
        assert r1.status_code == 201, r1.text
        bid = r1.json()["data"]["bookmark_id"]
        assert bid

        r2 = await ac.get("/api/v1/bookmarks")
        assert r2.status_code == 200
        items = r2.json()["data"]["items"]
        match = next((it for it in items if it["id"] == bid), None)
        assert match is not None
        assert match["slug"] == SEED_SLUG
        assert match["folder"] == "기본"
        assert match["notes"] == "첫 책갈피"

        # Cleanup
        r3 = await ac.delete(f"/api/v1/bookmarks/{bid}")
        assert r3.status_code == 204


@pytest.mark.asyncio
async def test_duplicate_bookmark_returns_409() -> None:
    async with await _client() as ac:
        await _wipe_existing(ac)
        r1 = await ac.post(
            "/api/v1/bookmarks", json={"document_id": SEED_SLUG}
        )
        assert r1.status_code == 201
        bid = r1.json()["data"]["bookmark_id"]
        try:
            r2 = await ac.post(
                "/api/v1/bookmarks", json={"document_id": SEED_SLUG}
            )
            assert r2.status_code == 409
        finally:
            await ac.delete(f"/api/v1/bookmarks/{bid}")


@pytest.mark.asyncio
async def test_patch_bookmark_updates_folder_and_notes() -> None:
    async with await _client() as ac:
        await _wipe_existing(ac)
        r1 = await ac.post(
            "/api/v1/bookmarks",
            json={"document_id": SEED_SLUG, "folder": "old"},
        )
        bid = r1.json()["data"]["bookmark_id"]
        try:
            r2 = await ac.patch(
                f"/api/v1/bookmarks/{bid}",
                json={"folder": "new", "notes": "after"},
            )
            assert r2.status_code == 200, r2.text
            data = r2.json()["data"]
            assert data["folder"] == "new"
            assert data["notes"] == "after"
        finally:
            await ac.delete(f"/api/v1/bookmarks/{bid}")


@pytest.mark.asyncio
async def test_folder_filter_and_folders_endpoint() -> None:
    async with await _client() as ac:
        await _wipe_existing(ac)

        r1 = await ac.post(
            "/api/v1/bookmarks",
            json={"document_id": SEED_SLUG, "folder": "PinnedX"},
        )
        bid = r1.json()["data"]["bookmark_id"]
        try:
            # Filter by exact folder
            r_filtered = await ac.get("/api/v1/bookmarks?folder=PinnedX")
            assert r_filtered.status_code == 200
            items = r_filtered.json()["data"]["items"]
            assert any(it["id"] == bid for it in items)

            # Folders summary should list this folder with at least count 1
            r_folders = await ac.get("/api/v1/bookmarks/folders")
            assert r_folders.status_code == 200
            folders = r_folders.json()["data"]["items"]
            match = next((f for f in folders if f["folder"] == "PinnedX"), None)
            assert match is not None
            assert match["count"] >= 1
        finally:
            await ac.delete(f"/api/v1/bookmarks/{bid}")


@pytest.mark.asyncio
async def test_create_bookmark_with_unknown_doc_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/bookmarks",
            json={"document_id": "definitely-not-a-real-slug-zzz"},
        )
        assert r.status_code == 404
