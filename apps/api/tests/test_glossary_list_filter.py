"""FR-02 검색/필터 — q (term/term_en/aliases ILIKE) + domain + status."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests._glossary_helpers import (
    cleanup_term_id,
    ensure_user,
    login_admin,
    unique_term,
)


async def _propose_and_approve(
    ac: AsyncClient,
    *,
    reader_token: str,
    admin_token: str,
    term: str,
    domain: str,
    definition: str = "정의",
    term_en: str | None = None,
    aliases: list[str] | None = None,
) -> str:
    r = await ac.post(
        "/api/v1/glossary/propose",
        headers={"Authorization": f"Bearer {reader_token}"},
        json={
            "term": term,
            "definition": definition,
            "domain": domain,
            "term_en": term_en,
            "aliases": aliases or [],
        },
    )
    assert r.status_code == 202, r.text
    tid = r.json()["data"]["id"]
    r = await ac.post(
        f"/api/v1/glossary/{tid}/approve",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r.status_code == 200, r.text
    return tid


@pytest.mark.asyncio
async def test_filter_by_domain_and_q_and_alias() -> None:
    transport = ASGITransport(app=app)
    base = unique_term("filt")
    ids: list[str] = []
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            admin = await login_admin(ac)

            # ml: 2개 (하나는 alias 포함)
            ids.append(await _propose_and_approve(
                ac, reader_token=reader, admin_token=admin,
                term=f"{base}-foo", domain="ml",
                term_en="FooEN", aliases=["BarAlias"]))
            ids.append(await _propose_and_approve(
                ac, reader_token=reader, admin_token=admin,
                term=f"{base}-baz", domain="ml"))
            # network: 1개
            ids.append(await _propose_and_approve(
                ac, reader_token=reader, admin_token=admin,
                term=f"{base}-net", domain="network"))

            # domain=ml 만 → 2
            r = await ac.get(
                "/api/v1/glossary",
                params={"domain": "ml", "q": base, "size": 200},
            )
            assert r.status_code == 200
            items = r.json()["data"]["items"]
            terms = {it["term"] for it in items}
            assert f"{base}-foo" in terms
            assert f"{base}-baz" in terms
            assert f"{base}-net" not in terms

            # alias 검색 → BarAlias 매칭
            r = await ac.get(
                "/api/v1/glossary", params={"q": "BarAlias"}
            )
            items = r.json()["data"]["items"]
            assert any(it["term"] == f"{base}-foo" for it in items)

            # term_en 검색
            r = await ac.get(
                "/api/v1/glossary", params={"q": "FooEN"}
            )
            items = r.json()["data"]["items"]
            assert any(it["term"] == f"{base}-foo" for it in items)

            # status='proposed' 는 비-admin 에게 422
            r = await ac.get(
                "/api/v1/glossary", params={"status": "proposed"}
            )
            assert r.status_code == 422

            # status=approved (명시) 는 OK
            r = await ac.get(
                "/api/v1/glossary", params={"status": "approved", "q": base, "size": 200}
            )
            assert r.status_code == 200
            assert r.json()["data"]["total"] >= 3
    finally:
        for tid in ids:
            await cleanup_term_id(tid)


@pytest.mark.asyncio
async def test_list_paging_metadata() -> None:
    transport = ASGITransport(app=app)
    base = unique_term("page")
    ids: list[str] = []
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            admin = await login_admin(ac)
            for i in range(3):
                ids.append(await _propose_and_approve(
                    ac, reader_token=reader, admin_token=admin,
                    term=f"{base}-{i}", domain="ml"))
            r = await ac.get(
                "/api/v1/glossary",
                params={"q": base, "page": 1, "size": 2},
            )
            assert r.status_code == 200
            data = r.json()["data"]
            assert data["page"] == 1
            assert data["size"] == 2
            assert data["total"] == 3
            assert len(data["items"]) == 2
            r2 = await ac.get(
                "/api/v1/glossary",
                params={"q": base, "page": 2, "size": 2},
            )
            assert r2.status_code == 200
            assert len(r2.json()["data"]["items"]) == 1
    finally:
        for tid in ids:
            await cleanup_term_id(tid)


@pytest.mark.asyncio
async def test_get_term_by_text_returns_approved() -> None:
    """FR-03 단건 조회: approved 만 노출."""
    transport = ASGITransport(app=app)
    term = unique_term("get-by-text")
    tid: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            admin = await login_admin(ac)
            tid = await _propose_and_approve(
                ac, reader_token=reader, admin_token=admin,
                term=term, domain="ml", definition="설명")
            r = await ac.get(f"/api/v1/glossary/term/{term}")
            assert r.status_code == 200
            d = r.json()["data"]
            assert d["term"] == term
            assert d["status"] == "approved"
            assert "related_doc_count" in d
    finally:
        if tid:
            await cleanup_term_id(tid)
