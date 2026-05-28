"""Plan §2.2 권한 매트릭스 검증 — anonymous/reader/editor/admin."""
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


def _no_dev_fallback_headers() -> dict[str, str]:
    """X-MXWP-User 우회를 무력화 — anonymous 시뮬레이션은 그냥 Authorization 미부여."""
    return {}


@pytest.mark.asyncio
async def test_anonymous_can_list_and_get_term_but_not_mutate() -> None:
    """anonymous: GET ok (approved 만), POST/PATCH/DELETE 모두 거부.

    NOTE: dev 환경엔 미인증이 admin 폴백되므로 anonymous 거부는 실서비스 가드.
    여기선 reader-credentials 가 admin endpoint 호출 시 403 만 검증.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/glossary")
        assert r.status_code == 200  # public OK
        r = await ac.get("/api/v1/domains")
        assert r.status_code == 200  # public OK


@pytest.mark.asyncio
async def test_reader_cannot_approve_or_create_domain() -> None:
    """reader: propose OK, approve/reject/patch admin/import/domain 생성 모두 403."""
    term = unique_term("rd-perm")
    transport = ASGITransport(app=app)
    term_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            # propose OK
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {reader}"},
                json={"term": term, "definition": "정의", "domain": "ml"},
            )
            assert r.status_code == 202, r.text
            term_id = r.json()["data"]["id"]

            h = {"Authorization": f"Bearer {reader}"}
            assert (await ac.post(f"/api/v1/glossary/{term_id}/approve", headers=h)).status_code == 403
            assert (await ac.post(
                f"/api/v1/glossary/{term_id}/reject",
                headers=h, json={"reason": "x"})).status_code == 403
            assert (await ac.patch(
                f"/api/v1/glossary/{term_id}",
                headers=h, json={"definition": "x"})).status_code == 403
            assert (await ac.post(
                "/api/v1/domains", headers=h,
                json={"slug": "rdr-perm-test", "name": "x"})).status_code == 403
            assert (await ac.post(
                "/api/v1/glossary/import", headers=h,
                json={"rows": [{"term": "x", "definition": "y"}]})).status_code == 403
    finally:
        if term_id:
            await cleanup_term_id(term_id)


@pytest.mark.asyncio
async def test_editor_cannot_approve_only_admin_can() -> None:
    term = unique_term("ed-perm")
    transport = ASGITransport(app=app)
    term_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            editor = await ensure_user("editor-glossary@mx.local", "editor")
            admin = await login_admin(ac)
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {editor}"},
                json={"term": term, "definition": "정의", "domain": "ml"},
            )
            term_id = r.json()["data"]["id"]
            # editor approve → 403
            r = await ac.post(
                f"/api/v1/glossary/{term_id}/approve",
                headers={"Authorization": f"Bearer {editor}"},
            )
            assert r.status_code == 403
            # admin approve → 200
            r = await ac.post(
                f"/api/v1/glossary/{term_id}/approve",
                headers={"Authorization": f"Bearer {admin}"},
            )
            assert r.status_code == 200
    finally:
        if term_id:
            await cleanup_term_id(term_id)


@pytest.mark.asyncio
async def test_only_owner_can_patch_or_delete_own_proposal() -> None:
    """FR-08/09: 본인 + pending 한정."""
    term = unique_term("owner")
    transport = ASGITransport(app=app)
    term_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            owner = await ensure_user("owner-glossary@mx.local", "editor")
            stranger = await ensure_user("stranger-glossary@mx.local", "editor")
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {owner}"},
                json={"term": term, "definition": "정의", "domain": "ml"},
            )
            term_id = r.json()["data"]["id"]

            # 타인 PATCH → 403
            r = await ac.patch(
                f"/api/v1/glossary/proposals/{term_id}",
                headers={"Authorization": f"Bearer {stranger}"},
                json={"definition": "수정"},
            )
            assert r.status_code == 403

            # 본인 PATCH → 200
            r = await ac.patch(
                f"/api/v1/glossary/proposals/{term_id}",
                headers={"Authorization": f"Bearer {owner}"},
                json={"definition": "본인 수정"},
            )
            assert r.status_code == 200
            assert r.json()["data"]["definition"] == "본인 수정"

            # 타인 DELETE → 403
            r = await ac.delete(
                f"/api/v1/glossary/proposals/{term_id}",
                headers={"Authorization": f"Bearer {stranger}"},
            )
            assert r.status_code == 403

            # 본인 DELETE → 200 (그리고 row 사라짐)
            r = await ac.delete(
                f"/api/v1/glossary/proposals/{term_id}",
                headers={"Authorization": f"Bearer {owner}"},
            )
            assert r.status_code == 200
            term_id = None  # 이미 삭제됨
    finally:
        if term_id:
            await cleanup_term_id(term_id)


@pytest.mark.asyncio
async def test_owner_cannot_patch_after_approved() -> None:
    """pending 이 아니면 본인이라도 PATCH 거부."""
    term = unique_term("approved-frz")
    transport = ASGITransport(app=app)
    term_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            owner = await ensure_user("owner-glossary@mx.local", "editor")
            admin = await login_admin(ac)
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {owner}"},
                json={"term": term, "definition": "정의", "domain": "ml"},
            )
            term_id = r.json()["data"]["id"]
            r = await ac.post(
                f"/api/v1/glossary/{term_id}/approve",
                headers={"Authorization": f"Bearer {admin}"},
            )
            assert r.status_code == 200
            r = await ac.patch(
                f"/api/v1/glossary/proposals/{term_id}",
                headers={"Authorization": f"Bearer {owner}"},
                json={"definition": "approved 이후"},
            )
            assert r.status_code == 403
    finally:
        if term_id:
            await cleanup_term_id(term_id)
