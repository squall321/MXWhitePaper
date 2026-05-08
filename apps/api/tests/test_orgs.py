"""조직 라우터 happy path."""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app


@pytest.mark.asyncio
async def test_list_divisions_returns_seeded_mx() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/divisions")
    assert r.status_code == 200
    body = r.json()
    assert body["error"] is None
    slugs = {d["slug"] for d in body["data"]}
    assert "mx" in slugs


@pytest.mark.asyncio
async def test_get_division_by_slug() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/divisions/mx")
    assert r.status_code == 200
    body = r.json()
    assert body["data"]["slug"] == "mx"
    assert body["data"]["name"]


@pytest.mark.asyncio
async def test_org_tree_contains_full_hierarchy() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/orgs/tree")
    assert r.status_code == 200
    body = r.json()
    divisions = body["data"]["divisions"]
    assert len(divisions) >= 1
    mx = next((d for d in divisions if d["slug"] == "mx"), None)
    assert mx is not None
    # Cycle 14 reset: mx → dev → he-team → cae
    assert any(t["slug"] == "dev" for t in mx["teams"])
    dev = next(t for t in mx["teams"] if t["slug"] == "dev")
    assert any(g["slug"] == "he-team" for g in dev["groups"])
    he = next(g for g in dev["groups"] if g["slug"] == "he-team")
    assert any(p["slug"] == "cae" for p in he["parts"])


@pytest.mark.asyncio
async def test_org_create_writes_audit_log() -> None:
    """Polish D — division 생성 시 audit_logs 가 남아야 한다."""
    new_slug = f"div-{uuid.uuid4().hex[:6]}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/divisions",
            json={"slug": new_slug, "name": f"테스트 사업부 {new_slug}", "description": "x"},
        )
        assert r.status_code == 201, r.text

    async with session_scope() as s:
        row = (await s.execute(
            text("""
                SELECT action, target FROM audit_logs
                WHERE target = :t
                ORDER BY created_at DESC LIMIT 1
            """),
            {"t": f"division:{new_slug}"},
        )).first()
        assert row is not None
        assert row[0] == "org.division.create"

        await s.execute(
            text("DELETE FROM divisions WHERE slug = :s"), {"s": new_slug}
        )
