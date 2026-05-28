"""FR-10/11 — /domains GET (public) + POST (admin)."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests._glossary_helpers import (
    cleanup_domain,
    ensure_user,
    login_admin,
    unique_term,
)


@pytest.mark.asyncio
async def test_list_domains_includes_seed() -> None:
    """알베비크 seed 5개가 반드시 보여야."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/domains")
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        slugs = {it["slug"] for it in items}
        assert {"general", "ml", "network", "semiconductor", "ev"} <= slugs


@pytest.mark.asyncio
async def test_admin_creates_domain_reader_forbidden() -> None:
    slug = unique_term("dom").replace("dom-", "dom")[:50]
    transport = ASGITransport(app=app)
    created = False
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            admin = await login_admin(ac)

            # reader → 403
            r = await ac.post(
                "/api/v1/domains",
                headers={"Authorization": f"Bearer {reader}"},
                json={"slug": slug, "name": "테스트 도메인"},
            )
            assert r.status_code == 403

            # admin → 201
            r = await ac.post(
                "/api/v1/domains",
                headers={"Authorization": f"Bearer {admin}"},
                json={"slug": slug, "name": "테스트 도메인"},
            )
            assert r.status_code == 201, r.text
            created = True
            d = r.json()["data"]
            assert d["slug"] == slug
            assert d["name"] == "테스트 도메인"

            # 중복 → 409
            r = await ac.post(
                "/api/v1/domains",
                headers={"Authorization": f"Bearer {admin}"},
                json={"slug": slug, "name": "x"},
            )
            assert r.status_code == 409
    finally:
        if created:
            await cleanup_domain(slug)
