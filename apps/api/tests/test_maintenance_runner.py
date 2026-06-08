"""B-1 maintenance_runner ticker — disable flag honoured + tick_once returns
counts.

We don't exercise the long-running loop (asyncio.sleep makes it
slow/flaky in CI); we cover the *unit of work* — ``tick_once()`` — for
both flags and verify the runner doesn't crash on empty DB.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import session_scope
from app.services import maintenance_runner


@pytest.mark.asyncio
async def test_tick_once_returns_count_shape() -> None:
    """Even on a clean DB the tick returns the two-key dict."""
    counts = await maintenance_runner.tick_once()
    assert set(counts.keys()) == {
        "pending_uploads_purged",
        "versions_compacted",
    }
    assert isinstance(counts["pending_uploads_purged"], int)
    assert isinstance(counts["versions_compacted"], int)


@pytest.mark.asyncio
async def test_tick_once_no_ops_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Disable flag → both helpers skipped, counts zero."""
    s = get_settings()
    monkeypatch.setattr(s, "maintenance_runner_enabled", False)
    counts = await maintenance_runner.tick_once()
    assert counts == {"pending_uploads_purged": 0, "versions_compacted": 0}


@pytest.mark.asyncio
async def test_tick_once_purges_expired_pending() -> None:
    """End-to-end: insert an expired pending row, call tick_once, verify gone."""
    # Insert expired pending row that the sweeper should remove.
    async with session_scope() as s:
        admin_id = (await s.execute(
            text("SELECT id FROM users WHERE role='admin' LIMIT 1")
        )).scalar_one()
        await s.execute(text("""
            INSERT INTO images_pending
              (upload_id, uploader_id, filename, mime_type, sha256, size_bytes, expires_at)
            VALUES
              ('runner-test-expired',
               :u, 'r.png', 'image/png', repeat('r', 64), 100,
               NOW() - INTERVAL '1 hour')
        """), {"u": admin_id})

    try:
        counts = await maintenance_runner.tick_once()
        assert counts["pending_uploads_purged"] >= 1

        async with session_scope() as s:
            row = (await s.execute(text(
                "SELECT upload_id FROM images_pending WHERE upload_id = 'runner-test-expired'"
            ))).first()
        assert row is None
    finally:
        # belt-and-suspenders cleanup in case the assertion fired before purge.
        async with session_scope() as s:
            await s.execute(text(
                "DELETE FROM images_pending WHERE upload_id = 'runner-test-expired'"
            ))
