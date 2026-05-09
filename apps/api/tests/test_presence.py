"""Presence router — heartbeat / list / leave / TTL pruning + SSE smoke.

Builds a minimal FastAPI app rather than importing `app.main`, so this test
file is decoupled from siblings (e.g. backups router) that may transiently
fail to register their routes during concurrent feature work.
"""
from __future__ import annotations

import asyncio
import time

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from httpx import ASGITransport, AsyncClient

from app.core.errors import (
    APIError,
    api_error_handler,
    validation_error_handler,
)
from app.routers import presence as presence_mod
from app.routers.presence import router as presence_router


SLUG = "month-end-closing"  # any reader-visible doc slug works


async def _fake_reader_dep() -> dict[str, object]:
    """Stub `require_reader` so the test app doesn't need a real DB session."""
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": "tester@example.com",
        "name": "Tester",
        "role": "reader",
        "team_id": None,
        "is_active": True,
    }


def _make_app() -> FastAPI:
    a = FastAPI()
    a.add_exception_handler(APIError, api_error_handler)  # type: ignore[arg-type]
    a.add_exception_handler(
        RequestValidationError, validation_error_handler  # type: ignore[arg-type]
    )
    a.include_router(presence_router)
    # Bypass the real auth dependency (which queries Postgres) so the test
    # surface stays in-process.
    from app.core.auth import require_reader as real_require_reader

    a.dependency_overrides[real_require_reader] = _fake_reader_dep
    return a


app = _make_app()


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
def _reset_registry():
    presence_mod.PRESENCE.clear()
    yield
    presence_mod.PRESENCE.clear()


@pytest.mark.asyncio
async def test_heartbeat_then_get() -> None:
    async with await _client() as ac:
        rh = await ac.post(
            f"/api/v1/presence/{SLUG}/heartbeat",
            json={"anchor_block_id": "01J9N1Z9N1ZZZAB123ABC4DE5F"},
        )
        assert rh.status_code == 200, rh.text
        body = rh.json()
        items = body["data"]["items"]
        assert len(items) == 1
        assert items[0]["anchor_block_id"] == "01J9N1Z9N1ZZZAB123ABC4DE5F"
        assert isinstance(items[0]["last_seen"], (int, float))
        assert body["meta"]["count"] == 1
        assert body["meta"]["ttl_sec"] == 30

        rg = await ac.get(f"/api/v1/presence/{SLUG}")
        assert rg.status_code == 200
        gitems = rg.json()["data"]["items"]
        assert len(gitems) == 1
        assert gitems[0]["user_id"] == items[0]["user_id"]


@pytest.mark.asyncio
async def test_heartbeat_without_body_defaults_anchor_to_none() -> None:
    async with await _client() as ac:
        rh = await ac.post(f"/api/v1/presence/{SLUG}/heartbeat")
        assert rh.status_code == 200, rh.text
        items = rh.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["anchor_block_id"] is None


@pytest.mark.asyncio
async def test_explicit_leave_removes_user() -> None:
    async with await _client() as ac:
        await ac.post(f"/api/v1/presence/{SLUG}/heartbeat")
        rd = await ac.delete(f"/api/v1/presence/{SLUG}")
        assert rd.status_code == 204
        rg = await ac.get(f"/api/v1/presence/{SLUG}")
        assert rg.json()["data"]["items"] == []


@pytest.mark.asyncio
async def test_ttl_pruning_drops_stale_entries() -> None:
    async with await _client() as ac:
        await ac.post(f"/api/v1/presence/{SLUG}/heartbeat")
        # Forcefully age the entry past the TTL.
        bucket = presence_mod.PRESENCE.get(SLUG, {})
        assert bucket
        for entry in bucket.values():
            entry["last_seen"] = time.time() - presence_mod.PRESENCE_TTL_SEC - 5
        rg = await ac.get(f"/api/v1/presence/{SLUG}")
        assert rg.status_code == 200
        assert rg.json()["data"]["items"] == []
        # The whole bucket should also be gone (no empty leftover dict).
        assert SLUG not in presence_mod.PRESENCE


@pytest.mark.asyncio
async def test_sse_route_registered_with_event_stream_media_type() -> None:
    """SSE smoke: the route is mounted, returns text/event-stream, and the
    handler is callable.

    We avoid `httpx.AsyncClient.stream` here because httpx-on-ASGI buffers
    the StreamingResponse body until the generator exits, and our generator
    is unbounded (the production loop). Instead we inspect the route record
    directly + invoke the handler once and read the first SSE frame from
    the async generator.
    """
    # 1) Route is registered with the right path + method.
    streamers = [
        r
        for r in app.router.routes
        if getattr(r, "path", None) == "/api/v1/presence/{slug}/stream"
    ]
    assert len(streamers) == 1, f"unexpected route count: {streamers}"
    route = streamers[0]
    assert "GET" in getattr(route, "methods", set())

    # 2) Calling the handler returns a StreamingResponse with the right
    #    media-type and a working async generator. We pull a single chunk
    #    out of the generator under a wait_for so the unbounded asyncio.sleep
    #    loop can never wedge the test.
    original = presence_mod.SSE_INTERVAL_SEC
    presence_mod.SSE_INTERVAL_SEC = 0.05
    try:
        resp = await presence_mod.stream_presence(slug=SLUG, _user={"id": "x"})
        assert resp.media_type == "text/event-stream"
        assert resp.headers.get("cache-control", "").startswith("no-cache")

        agen = resp.body_iterator
        first = await asyncio.wait_for(agen.__anext__(), timeout=2.0)  # type: ignore[union-attr]
        text = first if isinstance(first, str) else first.decode("utf-8")
        assert "event: presence" in text
        assert "data:" in text
        assert SLUG in text
        # Cancel the generator so we don't leak a background task.
        await agen.aclose()  # type: ignore[union-attr]
    finally:
        presence_mod.SSE_INTERVAL_SEC = original
