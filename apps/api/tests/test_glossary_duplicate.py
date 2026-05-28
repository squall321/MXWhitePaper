"""§6.4 — (term, domain) 중복 정책 + 다른 도메인 허용."""
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


@pytest.mark.asyncio
async def test_same_term_same_domain_conflicts() -> None:
    term = unique_term("dup-same")
    transport = ASGITransport(app=app)
    term_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            h = {"Authorization": f"Bearer {reader}"}
            r1 = await ac.post(
                "/api/v1/glossary/propose", headers=h,
                json={"term": term, "definition": "1", "domain": "ml"},
            )
            assert r1.status_code == 202
            term_id = r1.json()["data"]["id"]
            r2 = await ac.post(
                "/api/v1/glossary/propose", headers=h,
                json={"term": term, "definition": "2", "domain": "ml"},
            )
            assert r2.status_code == 409, r2.text
            err = r2.json()["error"]
            assert err["details"]["existing_id"] == term_id
    finally:
        if term_id:
            await cleanup_term_id(term_id)


@pytest.mark.asyncio
async def test_same_term_different_domain_allowed() -> None:
    term = unique_term("dup-diff")
    transport = ASGITransport(app=app)
    term_id_ml: str | None = None
    term_id_sc: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            h = {"Authorization": f"Bearer {reader}"}
            r1 = await ac.post(
                "/api/v1/glossary/propose", headers=h,
                json={"term": term, "definition": "ML 정의", "domain": "ml"},
            )
            assert r1.status_code == 202, r1.text
            term_id_ml = r1.json()["data"]["id"]
            r2 = await ac.post(
                "/api/v1/glossary/propose", headers=h,
                json={"term": term, "definition": "반도체 정의",
                      "domain": "semiconductor"},
            )
            assert r2.status_code == 202, r2.text
            term_id_sc = r2.json()["data"]["id"]
            assert term_id_ml != term_id_sc
    finally:
        if term_id_ml:
            await cleanup_term_id(term_id_ml)
        if term_id_sc:
            await cleanup_term_id(term_id_sc)


@pytest.mark.asyncio
async def test_approved_collision_returns_alias_hint() -> None:
    """이미 approved 인 (term, domain) 으로 재제안 → 409 + approved hint."""
    term = unique_term("dup-app")
    transport = ASGITransport(app=app)
    term_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            admin = await login_admin(ac)
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {reader}"},
                json={"term": term, "definition": "정의", "domain": "ml"},
            )
            term_id = r.json()["data"]["id"]
            r = await ac.post(
                f"/api/v1/glossary/{term_id}/approve",
                headers={"Authorization": f"Bearer {admin}"},
            )
            assert r.status_code == 200
            # 같은 (term, domain) 으로 reader 재제안
            r2 = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {reader}"},
                json={"term": term, "definition": "재제안", "domain": "ml"},
            )
            assert r2.status_code == 409
            err = r2.json()["error"]
            assert err["details"]["existing_status"] == "approved"
    finally:
        if term_id:
            await cleanup_term_id(term_id)
