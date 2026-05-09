"""Tests for the admin health dashboard router + ticker registry."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app
from app.services import ticker_state


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _ensure_reader_user() -> tuple[str, str]:
    email = "reader-healthdash@mx.local"
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if row is None:
            await s.execute(
                text(
                    "INSERT INTO users (email, name, password_hash, role) "
                    "VALUES (:e, :n, :pw, 'reader')"
                ),
                {"e": email, "n": "Reader", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return uid, make_access_token(uid)


# ── Ticker registry unit tests ───────────────────────────────────────────


def test_ticker_state_report_and_snapshot() -> None:
    ticker_state.reset_for_tests()
    assert ticker_state.snapshot() == []
    nxt = datetime.now(timezone.utc) + timedelta(seconds=60)
    ticker_state.report_tick("backup", next_due_at=nxt)
    ticker_state.report_tick("digest")  # no next_due_at
    snap = ticker_state.snapshot()
    names = [r["name"] for r in snap]
    assert names == ["backup", "digest"]
    backup_row = next(r for r in snap if r["name"] == "backup")
    assert backup_row["running"] is True
    assert backup_row["last_tick_at"] is not None
    assert backup_row["next_due_at"] is not None
    digest_row = next(r for r in snap if r["name"] == "digest")
    assert digest_row["next_due_at"] is None


def test_ticker_state_empty_name_is_a_noop() -> None:
    ticker_state.reset_for_tests()
    ticker_state.report_tick("")
    assert ticker_state.snapshot() == []


# ── Endpoint: AuthZ ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_dashboard_requires_admin() -> None:
    _uid, token = await _ensure_reader_user()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/admin/health-dashboard",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403, r.text


# ── Endpoint: shape + degraded fallbacks ─────────────────────────────────


@pytest.mark.asyncio
async def test_dashboard_returns_full_shape() -> None:
    """Admin call should return every documented section even if some are
    ``ok: false`` because their downstream is unreachable in test env."""
    ticker_state.reset_for_tests()
    ticker_state.report_tick(
        "backup",
        next_due_at=datetime.now(timezone.utc) + timedelta(seconds=60),
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/admin/health-dashboard",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    # Top-level keys
    for key in (
        "uptime_seconds",
        "version",
        "database",
        "minio",
        "meilisearch",
        "tickers",
        "errors_24h",
        "rate_limit",
        "queue_depths",
    ):
        assert key in data, f"missing key: {key}"
    assert isinstance(data["uptime_seconds"], int)
    assert data["uptime_seconds"] >= 0
    assert isinstance(data["version"], str) and data["version"]
    # Database section: ok bool + numeric pool fields
    db = data["database"]
    assert isinstance(db["ok"], bool)
    assert "pool_size" in db and "checked_out" in db and "overflow" in db
    # MinIO section: shape regardless of reachability
    mn = data["minio"]
    assert "endpoint" in mn and "buckets" in mn and "ok" in mn
    assert isinstance(mn["buckets"], list)
    # Meili section
    me = data["meilisearch"]
    assert "url" in me and "indexes" in me and "ok" in me
    # Ticker registry includes the canonical tickers and our seeded backup row
    tickers = {row["name"]: row for row in data["tickers"]}
    for known in (
        "backup",
        "digest",
        "automation_event",
        "automation_cron",
        "retention",
        "reminder",
        "audit_pruner",
    ):
        assert known in tickers, f"ticker {known} missing"
    assert tickers["backup"]["running"] is True
    # Rate-limit + queues
    assert "active_buckets" in data["rate_limit"]
    assert "active_blocks" in data["rate_limit"]
    for key in (
        "automation_pending",
        "webhook_deliveries_pending",
        "subscription_digest_buffer",
    ):
        assert key in data["queue_depths"]
        assert isinstance(data["queue_depths"][key], int)
    assert isinstance(data["errors_24h"], int)


@pytest.mark.asyncio
async def test_dashboard_unreported_tickers_show_running_false() -> None:
    """A ticker that hasn't reported yet must surface as ``running: false``."""
    ticker_state.reset_for_tests()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/admin/health-dashboard",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    tickers = r.json()["data"]["tickers"]
    for row in tickers:
        if row["name"] in {
            "backup",
            "digest",
            "automation_event",
            "automation_cron",
            "retention",
            "reminder",
            "audit_pruner",
        }:
            assert row["running"] is False
            assert row["last_tick_at"] is None
