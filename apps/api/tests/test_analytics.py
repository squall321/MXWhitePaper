"""Tier 2D — usage analytics endpoints."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.security import hash_password, make_access_token
from app.core.db import session_scope
from app.main import app
from sqlalchemy import text


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _ensure_reader_token() -> str:
    email = "reader-analytics@mx.local"
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
                {"e": email, "n": "Reader (analytics)", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return make_access_token(uid)


@pytest.mark.asyncio
async def test_analytics_overview_basic_shape() -> None:
    transport = ASGITransport(app=app)
    token = await _ensure_reader_token()
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/analytics/overview",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    for key in (
        "mau",
        "total_docs",
        "total_links",
        "avg_backlinks",
        "top_searches",
        "top_viewed_docs",
    ):
        assert key in data, key
    assert isinstance(data["mau"], int)
    assert isinstance(data["top_searches"], list)
    assert isinstance(data["top_viewed_docs"], list)


@pytest.mark.asyncio
async def test_analytics_daily_returns_window_length() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/analytics/daily?days=7",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert isinstance(data, list)
    assert len(data) == 7
    for row in data:
        for key in ("date", "active_users", "doc_writes", "doc_reads", "search_count"):
            assert key in row, key


@pytest.mark.asyncio
async def test_analytics_top_views_returns_list() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/analytics/top-views?days=30",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["data"], list)


@pytest.mark.asyncio
async def test_search_logs_audit_row_with_rate_limit() -> None:
    """첫 검색은 audit_logs 에 'search' 1건을 남기고, 60s 내 같은 쿼리 재호출은 추가 X."""
    from app.services import search_audit
    search_audit.reset()

    transport = ASGITransport(app=app)
    q = f"tier2dQuery_{__import__('uuid').uuid4().hex[:6]}"
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        r1 = await ac.get(f"/api/v1/search?q={q}", headers=h)
        assert r1.status_code == 200, r1.text
        r2 = await ac.get(f"/api/v1/search?q={q}", headers=h)
        assert r2.status_code == 200, r2.text

    async with session_scope() as s:
        cnt = int((await s.execute(
            text(
                "SELECT COUNT(*) FROM audit_logs WHERE action = 'search' "
                "AND target = :t AND created_at >= NOW() - INTERVAL '5 minutes'"
            ),
            {"t": q},
        )).scalar() or 0)
    assert cnt == 1, f"expected exactly 1 audit row, got {cnt}"


# ── Cycle 0016 — per-doc analytics + inactive-docs + top-docs + anchors ──


SEED_SLUG = "month-end-closing"


@pytest.fixture
async def _wipe_anchor_samples():
    async with session_scope() as s:
        await s.execute(text("DELETE FROM anchor_samples"))
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM anchor_samples"))


@pytest.mark.asyncio
async def test_per_doc_analytics_returns_envelope_for_seed_doc(
    _wipe_anchor_samples,
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        # Seed a few reads so unique_readers >= 1.
        await ac.post(
            "/api/v1/reads",
            json={"document_id": SEED_SLUG, "read_seconds": 45},
            headers=h,
        )
        r = await ac.get(
            f"/api/v1/analytics/documents/{SEED_SLUG}", headers=h,
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["slug"] == SEED_SLUG
    assert data["title"]
    assert isinstance(data["last_30_days"], list)
    assert len(data["last_30_days"]) == 30
    assert isinstance(data["section_attention"], list)
    assert isinstance(data["top_referrers"], list)
    assert data["unique_readers"] >= 1
    assert isinstance(data["avg_read_seconds"], int)
    assert isinstance(data["median_read_seconds"], int)


@pytest.mark.asyncio
async def test_per_doc_analytics_unknown_slug_404() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/analytics/documents/no-such-slug-xyz",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_post_anchor_sample_inserts_and_aggregates(
    _wipe_anchor_samples,
) -> None:
    """End-to-end: 3 anchor POSTs on the same block produce
    section_attention.est_seconds_per_visitor == 90 (3 samples * 30s)."""
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id, content_json FROM documents WHERE slug = :slug"),
            {"slug": SEED_SLUG},
        )).first()
    assert row is not None
    content = row[1] or {}
    section_id = None
    block_id = None
    for sec in content.get("sections", []):
        sid = sec.get("id")
        for b in (sec.get("blocks") or []):
            if isinstance(b, dict) and b.get("id"):
                section_id = sid
                block_id = b["id"]
                break
        if block_id:
            break
    assert block_id, "seed doc has no block ids — fixture changed?"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}
        for _ in range(3):
            r = await ac.post(
                "/api/v1/reads/anchor",
                json={
                    "document_id": SEED_SLUG,
                    "section_id": section_id,
                    "block_id": block_id,
                },
                headers=h,
            )
            assert r.status_code == 200, r.text
            assert r.json()["data"]["recorded"] is True

        analytics = await ac.get(
            f"/api/v1/analytics/documents/{SEED_SLUG}", headers=h,
        )
    assert analytics.status_code == 200
    att = analytics.json()["data"]["section_attention"]
    match = next((a for a in att if a["section_id"] == section_id), None)
    assert match is not None
    assert match["est_seconds_per_visitor"] == 90


@pytest.mark.asyncio
async def test_post_anchor_no_ids_is_noop() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.post(
            "/api/v1/reads/anchor",
            json={"document_id": SEED_SLUG},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200
    assert r.json()["data"]["recorded"] is False


@pytest.mark.asyncio
async def test_inactive_docs_admin_returns_list_shape() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/analytics/inactive-docs?since_days=90",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "data" in body and isinstance(body["data"], list)
    assert body["meta"]["since_days"] == 90


@pytest.mark.asyncio
async def test_inactive_docs_excludes_freshly_edited() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/analytics/inactive-docs?since_days=7",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200
    slugs = [d["slug"] for d in r.json()["data"]]
    # Seed docs were just inserted — none should be older than 7 days.
    assert SEED_SLUG not in slugs


@pytest.mark.asyncio
async def test_top_docs_returns_list_shape() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/analytics/top-docs?days=30&limit=5",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert isinstance(data, list)
    for item in data:
        for k in ("slug", "title", "views", "unique_readers", "avg_read_seconds"):
            assert k in item, k
        assert item["views"] >= 1


@pytest.mark.asyncio
async def test_analytics_pruner_drops_rows_older_than_ttl() -> None:
    """analytics_pruner.prune_once removes anchor_samples > 30 days old
    and leaves recent ones intact."""
    from datetime import datetime, timedelta, timezone

    from app.services import analytics_pruner

    async with session_scope() as s:
        await s.execute(text("DELETE FROM anchor_samples"))
        admin = (await s.execute(
            text("SELECT id FROM users WHERE email = 'admin@mx.local'")
        )).first()
        doc = (await s.execute(
            text("SELECT id FROM documents WHERE slug = :slug"),
            {"slug": SEED_SLUG},
        )).first()
        assert admin is not None and doc is not None
        old_ts = datetime.now(timezone.utc) - timedelta(days=60)
        await s.execute(
            text("""
                INSERT INTO anchor_samples
                  (user_id, document_id, section_id, block_id, sampled_at)
                VALUES (:u, :d, 'sec-old', 'blk-old', :ts)
            """),
            {"u": admin[0], "d": doc[0], "ts": old_ts},
        )
        await s.execute(
            text("""
                INSERT INTO anchor_samples
                  (user_id, document_id, section_id, block_id)
                VALUES (:u, :d, 'sec-fresh', 'blk-fresh')
            """),
            {"u": admin[0], "d": doc[0]},
        )
        await s.commit()

    deleted = await analytics_pruner.prune_once()
    assert deleted >= 1

    async with session_scope() as s:
        rows = (await s.execute(
            text(
                "SELECT section_id FROM anchor_samples "
                "WHERE document_id = :d "
                "ORDER BY sampled_at DESC"
            ),
            {"d": doc[0]},
        )).all()
    section_ids = [r[0] for r in rows]
    assert "sec-fresh" in section_ids
    assert "sec-old" not in section_ids

    async with session_scope() as s:
        await s.execute(text("DELETE FROM anchor_samples"))
