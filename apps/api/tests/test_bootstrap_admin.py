"""Tests for bootstrap_admin script — env validation + idempotency."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.core.db import session_scope
from app.scripts.bootstrap_admin import _main_async


@pytest.mark.asyncio
async def test_bootstrap_returns_2_when_env_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("BOOTSTRAP_ADMIN_EMAIL", raising=False)
    monkeypatch.delenv("BOOTSTRAP_ADMIN_PASSWORD", raising=False)
    rc = await _main_async()
    assert rc == 2


@pytest.mark.asyncio
async def test_bootstrap_skips_when_admin_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # admin@mx.local already lives in the seed via prior tests.
    monkeypatch.setenv("BOOTSTRAP_ADMIN_EMAIL", f"ignored-{uuid.uuid4().hex}@mx.local")
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "Init!Setup2026")
    rc = await _main_async()
    assert rc == 0


@pytest.mark.asyncio
async def test_bootstrap_inserts_when_no_admin_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Temporarily flip the only admin to inactive, run bootstrap, verify
    a new admin row landed, then restore the original admin's state.
    """
    monkeypatch.setenv(
        "BOOTSTRAP_ADMIN_EMAIL",
        f"bootstrap-{uuid.uuid4().hex[:10]}@mx.local",
    )
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", "Init!Setup2026")

    async with session_scope() as s, s.begin():
        await s.execute(
            text("UPDATE users SET is_active = FALSE WHERE role = 'admin'")
        )
    try:
        rc = await _main_async()
        assert rc == 0
        async with session_scope() as s:
            cnt = await s.execute(
                text("SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = TRUE")
            )
            assert cnt.scalar_one() >= 1
    finally:
        # Restore: re-activate any admin we deactivated, AND prune the one
        # the test just created so other tests aren't surprised by it.
        async with session_scope() as s, s.begin():
            await s.execute(
                text("UPDATE users SET is_active = TRUE WHERE role = 'admin'")
            )
            await s.execute(
                text("DELETE FROM users WHERE email LIKE 'bootstrap-%@mx.local'")
            )
