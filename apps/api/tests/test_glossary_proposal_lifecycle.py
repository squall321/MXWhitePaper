"""FR-07/08/09 — admin patch + 본인 제안 수정/취소 lifecycle."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from tests._glossary_helpers import (
    cleanup_term_id,
    ensure_user,
    login_admin,
    unique_term,
)


@pytest.mark.asyncio
async def test_admin_patch_records_edit_history() -> None:
    """FR-07: admin 이 직접 PATCH → terms 갱신 + history(action=edit) 기록."""
    transport = ASGITransport(app=app)
    term = unique_term("adm-patch")
    tid: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            admin = await login_admin(ac)
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {reader}"},
                json={"term": term, "definition": "초안", "domain": "ml"},
            )
            tid = r.json()["data"]["id"]
            r = await ac.post(
                f"/api/v1/glossary/{tid}/approve",
                headers={"Authorization": f"Bearer {admin}"},
            )
            assert r.status_code == 200

            # admin PATCH (approved 상태에서도 가능)
            r = await ac.patch(
                f"/api/v1/glossary/{tid}",
                headers={"Authorization": f"Bearer {admin}"},
                json={"definition": "관리자 수정 정의",
                      "aliases": ["A1", "A2"]},
            )
            assert r.status_code == 200, r.text
            d = r.json()["data"]
            assert d["definition"] == "관리자 수정 정의"
            assert d["aliases"] == ["A1", "A2"]
            # status 는 그대로 approved
            assert d["status"] == "approved"

            async with session_scope() as s:
                actions = [r[0] for r in (await s.execute(
                    text("""
                        SELECT action FROM term_proposals
                        WHERE term_id = CAST(:t AS uuid)
                        ORDER BY created_at
                    """),
                    {"t": tid},
                )).all()]
                # propose → approve → edit
                assert actions == ["propose", "approve", "edit"]
    finally:
        if tid:
            await cleanup_term_id(tid)


@pytest.mark.asyncio
async def test_owner_patches_own_proposal_then_admin_approves() -> None:
    """FR-08: 본인이 pending 상태 제안 수정 후 admin approve → 갱신본이 반영."""
    transport = ASGITransport(app=app)
    term = unique_term("own-patch")
    tid: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            owner = await ensure_user("owner-glossary@mx.local", "editor")
            admin = await login_admin(ac)
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {owner}"},
                json={"term": term, "definition": "v1", "domain": "ml"},
            )
            tid = r.json()["data"]["id"]
            # 본인이 정의 수정
            r = await ac.patch(
                f"/api/v1/glossary/proposals/{tid}",
                headers={"Authorization": f"Bearer {owner}"},
                json={"definition": "v2"},
            )
            assert r.status_code == 200
            # admin approve
            r = await ac.post(
                f"/api/v1/glossary/{tid}/approve",
                headers={"Authorization": f"Bearer {admin}"},
            )
            assert r.status_code == 200
            assert r.json()["data"]["definition"] == "v2"
    finally:
        if tid:
            await cleanup_term_id(tid)


@pytest.mark.asyncio
async def test_delete_proposal_removes_row_and_history_cascade() -> None:
    """FR-09: 본인이 pending 제안 취소 → terms hard delete, term_proposals CASCADE."""
    transport = ASGITransport(app=app)
    term = unique_term("own-del")
    tid: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            owner = await ensure_user("owner-glossary@mx.local", "editor")
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {owner}"},
                json={"term": term, "definition": "정의", "domain": "ml"},
            )
            tid = r.json()["data"]["id"]
            r = await ac.delete(
                f"/api/v1/glossary/proposals/{tid}",
                headers={"Authorization": f"Bearer {owner}"},
            )
            assert r.status_code == 200
            async with session_scope() as s:
                cnt = int((await s.execute(
                    text(
                        "SELECT count(*) FROM terms "
                        "WHERE id = CAST(:t AS uuid)"
                    ),
                    {"t": tid},
                )).scalar() or 0)
                assert cnt == 0
                # history 도 CASCADE 로 사라짐
                hist = int((await s.execute(
                    text(
                        "SELECT count(*) FROM term_proposals "
                        "WHERE term_id = CAST(:t AS uuid)"
                    ),
                    {"t": tid},
                )).scalar() or 0)
                assert hist == 0
            tid = None  # 이미 삭제됨
    finally:
        if tid:
            await cleanup_term_id(tid)


@pytest.mark.asyncio
async def test_patch_proposal_not_found_returns_404() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        owner = await ensure_user("owner-glossary@mx.local", "editor")
        r = await ac.patch(
            "/api/v1/glossary/proposals/00000000-0000-0000-0000-000000000000",
            headers={"Authorization": f"Bearer {owner}"},
            json={"definition": "x"},
        )
        assert r.status_code == 404
