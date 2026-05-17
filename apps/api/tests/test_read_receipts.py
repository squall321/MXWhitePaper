"""Cycle 0023 — read receipts: ack idempotency + read merging.

Coverage targets:
  - POST /documents/{slug}/ack-read inserts a row, second call updates time
    + comment in place (idempotent — same row_id).
  - GET  /documents/{slug}/read-receipts returns readers from
    document_reads, includes ack-only readers, merges (read + ack) into one
    row per user, and gates editor+ on the listing endpoint.
  - 404 on unknown slug.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app

SEED_SLUG = "month-end-closing"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture(autouse=True)
async def _wipe_acks_and_reads():
    """Drain `read_acks` + this slug's `document_reads` between tests so
    counts can't bleed across cases."""
    async with session_scope() as s:
        await s.execute(
            text("""
                DELETE FROM read_acks
                WHERE document_id = (SELECT id FROM documents WHERE slug = :s)
            """),
            {"s": SEED_SLUG},
        )
        await s.execute(
            text("""
                DELETE FROM document_reads
                WHERE document_id = (SELECT id FROM documents WHERE slug = :s)
            """),
            {"s": SEED_SLUG},
        )
        await s.commit()
    yield
    async with session_scope() as s:
        await s.execute(
            text("""
                DELETE FROM read_acks
                WHERE document_id = (SELECT id FROM documents WHERE slug = :s)
            """),
            {"s": SEED_SLUG},
        )
        await s.commit()


async def _ensure_user(email: str, role: str) -> str:
    async with session_scope() as s:
        await s.execute(
            text("""
                INSERT INTO users (email, name, role, password_hash, is_active)
                VALUES (:e, :n, :r, 'placeholder', TRUE)
                ON CONFLICT (email) DO UPDATE
                  SET role = EXCLUDED.role, is_active = TRUE
            """),
            {"e": email, "n": email.split("@")[0], "r": role},
        )
        await s.commit()
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        assert row is not None  # just upserted above
        return str(row[0])


def _bearer(jwt: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {jwt}"}


# ── ack endpoint ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ack_inserts_then_idempotent_update() -> None:
    async with await _client() as ac:
        r1 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/ack-read",
            json={"comment": "first"},
        )
        assert r1.status_code == 201, r1.text
        body1 = r1.json()["data"]
        first_id = body1["id"]
        first_at = body1["acknowledged_at"]
        assert body1["comment"] == "first"
        assert body1["slug"] == SEED_SLUG

        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/ack-read",
            json={"comment": "updated"},
        )
        assert r2.status_code == 201, r2.text
        body2 = r2.json()["data"]
        # Idempotent: same row id, comment overwritten, time advanced.
        assert body2["id"] == first_id
        assert body2["comment"] == "updated"
        assert body2["acknowledged_at"] >= first_at


@pytest.mark.asyncio
async def test_ack_accepts_null_comment() -> None:
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/ack-read",
            json={},
        )
        assert r.status_code == 201, r.text
        assert r.json()["data"]["comment"] is None


@pytest.mark.asyncio
async def test_ack_unknown_slug_returns_404() -> None:
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/no-such-{uuid.uuid4().hex[:6]}/ack-read",
            json={},
        )
        assert r.status_code == 404


# ── receipts list ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_receipts_list_merges_reads_and_acks() -> None:
    async with await _client() as ac:
        # Implicit read first (POST /reads accumulates a row).
        rd = await ac.post(
            "/api/v1/reads",
            json={"document_id": SEED_SLUG, "read_seconds": 12},
        )
        assert rd.status_code == 200, rd.text

        # Then ack on top of it.
        ak = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/ack-read",
            json={"comment": "확인"},
        )
        assert ak.status_code == 201, ak.text

        rs = await ac.get(f"/api/v1/documents/{SEED_SLUG}/read-receipts")
        assert rs.status_code == 200, rs.text
        data = rs.json()["data"]
        meta = rs.json()["meta"]
        assert meta["count"] == 1
        assert meta["ack_count"] == 1
        readers = data["readers"]
        assert len(readers) == 1
        only = readers[0]
        # Same user appears as both implicit reader + explicit acker — one row.
        assert only["read_seconds"] >= 12
        assert only["last_read_at"] is not None
        assert only["acknowledged_at"] is not None
        assert only["comment"] == "확인"


@pytest.mark.asyncio
async def test_receipts_list_includes_ack_only_user() -> None:
    """Acker who never fired a heartbeat still appears (FULL OUTER JOIN)."""
    async with await _client() as ac:
        ak = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/ack-read",
            json={},
        )
        assert ak.status_code == 201, ak.text

        rs = await ac.get(f"/api/v1/documents/{SEED_SLUG}/read-receipts")
        assert rs.status_code == 200
        readers = rs.json()["data"]["readers"]
        assert len(readers) == 1
        assert readers[0]["acknowledged_at"] is not None
        assert readers[0]["last_read_at"] is None
        assert readers[0]["read_seconds"] == 0


@pytest.mark.asyncio
async def test_receipts_list_404_on_unknown_slug() -> None:
    async with await _client() as ac:
        r = await ac.get(
            f"/api/v1/documents/no-such-{uuid.uuid4().hex[:6]}/read-receipts"
        )
        assert r.status_code == 404


@pytest.mark.asyncio
async def test_receipts_list_forbidden_for_reader() -> None:
    """editor+ gating — a reader-role bearer token should get 403."""
    from app.core.security import make_access_token

    reader_id = await _ensure_user(
        f"rr-reader-{uuid.uuid4().hex[:6]}@mx.local", "reader"
    )
    reader_jwt = make_access_token(reader_id)

    async with await _client() as ac:
        r = await ac.get(
            f"/api/v1/documents/{SEED_SLUG}/read-receipts",
            headers=_bearer(reader_jwt),
        )
        assert r.status_code == 403, r.text


@pytest.mark.asyncio
async def test_receipts_list_orders_by_most_recent_signal() -> None:
    """Two readers — newest signal (whichever of read/ack) comes first."""
    from app.core.security import make_access_token

    user_a = await _ensure_user(
        f"rr-a-{uuid.uuid4().hex[:6]}@mx.local", "reader"
    )
    user_b = await _ensure_user(
        f"rr-b-{uuid.uuid4().hex[:6]}@mx.local", "reader"
    )
    jwt_a = make_access_token(user_a)
    jwt_b = make_access_token(user_b)

    async with await _client() as ac:
        # A reads first (older), B acks second (newer).
        await ac.post(
            "/api/v1/reads",
            json={"document_id": SEED_SLUG, "read_seconds": 5},
            headers=_bearer(jwt_a),
        )
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/ack-read",
            json={},
            headers=_bearer(jwt_b),
        )

        rs = await ac.get(f"/api/v1/documents/{SEED_SLUG}/read-receipts")
        readers = rs.json()["data"]["readers"]
        assert len(readers) == 2
        # B's ack is the most recent signal so B should come first.
        assert readers[0]["user_id"] == user_b
        assert readers[1]["user_id"] == user_a
