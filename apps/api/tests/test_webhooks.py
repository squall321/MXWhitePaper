"""Webhooks router + dispatcher — CRUD, signature, dispatch, retry.

The dispatcher's outbound POST is mocked via `webhook_dispatcher.set_client_factory`
so no real network calls are made. We use `MXWP_SKIP_WEBHOOKS=1` for tests that
want to assert *only* CRUD behaviour without any side-effect dispatch coming from
unrelated mutations.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import get_db
from app.main import app
from app.services import webhook_dispatcher


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


# ── Mock httpx.AsyncClient ────────────────────────────────────────────


class _FakeResponse:
    def __init__(self, status: int, body: str = ""):
        self.status_code = status
        self.text = body


class _FakeClient:
    """Async-context-manager that records calls and returns canned responses.

    Multiple `_FakeClient` instances may be created (the dispatcher opens a
    fresh one for the initial POST and another for the retry). They share
    the *same* plan + calls lists so tests can assert across both attempts.
    """

    def __init__(self, plan: list[Any], calls: list[dict[str, Any]], instances: list[Any]):
        self._plan = plan
        self.calls = calls
        instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url: str, *, content: bytes, headers: dict[str, str], timeout: float):
        self.calls.append({"url": url, "body": content, "headers": dict(headers)})
        if not self._plan:
            return _FakeResponse(200, "ok")
        nxt = self._plan.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt


class _FakeFactory:
    """A callable that always returns _FakeClient instances backed by shared
    plan + calls + instances state. Use `_factory(plan)` to get one."""

    def __init__(self, plan: list[Any]):
        self.plan = list(plan)
        self.calls: list[dict[str, Any]] = []
        self.instances: list[_FakeClient] = []

    def __call__(self) -> _FakeClient:
        return _FakeClient(self.plan, self.calls, self.instances)


def _factory(plan: list[Any]) -> _FakeFactory:
    return _FakeFactory(plan)


# ── Fixtures ──────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
async def _wipe_webhooks():
    """Clean slate per test."""
    s, gen = await _new_session()
    try:
        await s.execute(text("DELETE FROM webhook_deliveries"))
        await s.execute(text("DELETE FROM webhooks"))
        await s.commit()
    finally:
        await _close_session(gen)
    webhook_dispatcher.reset_client_factory()
    yield
    s, gen = await _new_session()
    try:
        await s.execute(text("DELETE FROM webhook_deliveries"))
        await s.execute(text("DELETE FROM webhooks"))
        await s.commit()
    finally:
        await _close_session(gen)
    webhook_dispatcher.reset_client_factory()


# ── Unit: signature ────────────────────────────────────────────────────


def test_sign_payload_matches_hmac_sha256() -> None:
    body = b'{"event":"doc_edited"}'
    sig = webhook_dispatcher.sign_payload("topsecret", body)
    expected = "sha256=" + hmac.new(
        b"topsecret", body, hashlib.sha256
    ).hexdigest()
    assert sig == expected
    # different key → different signature
    other = webhook_dispatcher.sign_payload("topsecre7", body)
    assert other != sig


# ── CRUD ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_then_get_then_list_then_delete() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/webhooks",
            json={
                "url": "https://hooks.example.com/in",
                "scope": "user",
                "events": ["doc_edited", "comment_added"],
            },
        )
        assert r.status_code == 201, r.text
        created = r.json()["data"]
        hook_id = created["id"]
        # Secret is plaintext on create.
        assert isinstance(created["secret"], str)
        assert len(created["secret"]) >= 16
        assert "•" not in created["secret"]
        assert created["events"] == ["doc_edited", "comment_added"]

        # GET masks the secret.
        r = await ac.get(f"/api/v1/webhooks/{hook_id}")
        assert r.status_code == 200
        masked = r.json()["data"]["secret"]
        assert masked.startswith("•") or masked.startswith("•")

        # LIST includes it.
        r = await ac.get("/api/v1/webhooks")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        assert any(h["id"] == hook_id for h in items)

        # DELETE.
        r = await ac.delete(f"/api/v1/webhooks/{hook_id}")
        assert r.status_code == 204
        r = await ac.get(f"/api/v1/webhooks/{hook_id}")
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_create_rejects_unknown_event_kind() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/webhooks",
            json={
                "url": "https://hooks.example.com/in",
                "scope": "user",
                "events": ["doc_edited", "definitely-not-a-real-event"],
            },
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_patch_updates_fields() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/webhooks",
            json={
                "url": "https://hooks.example.com/a",
                "scope": "user",
                "events": ["doc_edited"],
            },
        )
        hook_id = r.json()["data"]["id"]

        r = await ac.patch(
            f"/api/v1/webhooks/{hook_id}",
            json={"enabled": False, "events": ["doc_published", "comment_added"]},
        )
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["enabled"] is False
        assert set(data["events"]) == {"doc_published", "comment_added"}


# ── Dispatch + retry ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dispatch_signs_payload_and_records_delivery() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/webhooks",
            json={
                "url": "https://hooks.example.com/sig",
                "scope": "user",
                "events": ["doc_edited"],
            },
        )
        assert r.status_code == 201, r.text
        plain_secret = r.json()["data"]["secret"]
        hook_id = r.json()["data"]["id"]

    plan = [_FakeResponse(200, "thanks")]
    factory = _factory(plan)
    webhook_dispatcher.set_client_factory(factory)

    payload = {"event": "doc_edited", "slug": "foo", "version": 2}
    # Use deliver_sync (single-shot, awaited, easier to assert). dispatch
    # itself is exercised in test_dispatch_filters_by_part_id.
    hook = {
        "id": hook_id,
        "secret": plain_secret,
        "url": "https://hooks.example.com/sig",
    }
    await webhook_dispatcher.deliver_sync(hook, "doc_edited", payload)

    assert len(factory.instances) >= 1
    assert len(factory.calls) == 1
    sent = factory.calls[0]
    assert sent["url"] == "https://hooks.example.com/sig"
    assert sent["headers"]["User-Agent"] == "mx-white-paper-webhook"
    expected_sig = "sha256=" + hmac.new(
        plain_secret.encode("utf-8"),
        sent["body"],
        hashlib.sha256,
    ).hexdigest()
    assert sent["headers"]["X-MXWP-Signature"] == expected_sig
    # Body parses back to our payload.
    assert json.loads(sent["body"].decode("utf-8")) == payload

    # Delivery row + last_status updated.
    s, gen = await _new_session()
    try:
        rows = (await s.execute(
            text("""
                SELECT http_status, retry_count
                FROM webhook_deliveries WHERE webhook_id = CAST(:id AS uuid)
            """),
            {"id": hook_id},
        )).all()
        assert len(rows) == 1
        assert rows[0][0] == 200
        assert rows[0][1] == 0
        st = (await s.execute(
            text("SELECT last_status FROM webhooks WHERE id = CAST(:id AS uuid)"),
            {"id": hook_id},
        )).first()
        assert st[0] == "ok"
    finally:
        await _close_session(gen)


@pytest.mark.asyncio
async def test_dispatch_retries_once_on_5xx() -> None:
    """5xx → schedule a retry. We monkeypatch RETRY_DELAY_SECONDS to 0 so the
    test doesn't actually sleep 60s."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/webhooks",
            json={
                "url": "https://hooks.example.com/retry",
                "scope": "user",
                "events": ["doc_edited"],
            },
        )
        hook_id = r.json()["data"]["id"]

    # First call 503, second call 200 — dispatcher should record both.
    plan = [_FakeResponse(503, "down"), _FakeResponse(200, "ok-after-retry")]
    factory = _factory(plan)
    webhook_dispatcher.set_client_factory(factory)

    orig_delay = webhook_dispatcher.RETRY_DELAY_SECONDS
    webhook_dispatcher.RETRY_DELAY_SECONDS = 0  # type: ignore[assignment]
    try:
        await webhook_dispatcher.dispatch("doc_edited", {"event": "doc_edited"})
        for _ in range(5):
            pending = [
                t for t in asyncio.all_tasks() if t is not asyncio.current_task()
            ]
            if not pending:
                break
            await asyncio.gather(*pending, return_exceptions=True)
            await asyncio.sleep(0)
    finally:
        webhook_dispatcher.RETRY_DELAY_SECONDS = orig_delay  # type: ignore[assignment]

    s, gen = await _new_session()
    try:
        rows = (await s.execute(
            text("""
                SELECT http_status, retry_count FROM webhook_deliveries
                WHERE webhook_id = CAST(:id AS uuid)
                ORDER BY attempted_at ASC
            """),
            {"id": hook_id},
        )).all()
        assert len(rows) == 2
        assert rows[0][0] == 503 and rows[0][1] == 0
        assert rows[1][0] == 200 and rows[1][1] == 1
    finally:
        await _close_session(gen)


@pytest.mark.asyncio
async def test_test_endpoint_synchronous_send() -> None:
    """POST /webhooks/:id/test fires immediately and returns the result."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/webhooks",
            json={
                "url": "https://hooks.example.com/test",
                "scope": "user",
                "events": ["doc_edited"],
            },
        )
        hook_id = r.json()["data"]["id"]

        webhook_dispatcher.set_client_factory(_factory([_FakeResponse(204, "")]))
        r = await ac.post(
            f"/api/v1/webhooks/{hook_id}/test",
            json={"event_kind": "doc_edited"},
        )
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        assert body["http_status"] == 204
        assert body["last_status"] == "ok"

        # And /deliveries returns it.
        r = await ac.get(f"/api/v1/webhooks/{hook_id}/deliveries")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["event_kind"] == "doc_edited"
        assert items[0]["http_status"] == 204


@pytest.mark.asyncio
async def test_dispatch_filters_by_part_id() -> None:
    """A hook with non-empty filter_part_ids only fires for matching part_id."""
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/webhooks",
            json={
                "url": "https://hooks.example.com/filtered",
                "scope": "user",
                "events": ["doc_edited"],
                "filter_part_ids": ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
            },
        )
        assert r.status_code == 201

    webhook_dispatcher.set_client_factory(_factory([_FakeResponse(200, "ok")]))
    enq_other = await webhook_dispatcher.dispatch(
        "doc_edited",
        {"event": "doc_edited"},
        target_part_id="11111111-2222-3333-4444-555555555555",
    )
    assert enq_other == 0

    enq_match = await webhook_dispatcher.dispatch(
        "doc_edited",
        {"event": "doc_edited"},
        target_part_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    )
    assert enq_match == 1
