"""FR-01 + FR-05 happy path — propose → admin approve + audit/history 검증."""
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
async def test_propose_then_approve_writes_audit_and_history() -> None:
    """reader propose → admin approve. terms.status, audit_logs, term_proposals 모두 검증."""
    term = unique_term("happypath")
    transport = ASGITransport(app=app)
    term_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            admin = await login_admin(ac)

            # 1) reader 가 propose
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {reader}"},
                json={
                    "term": term,
                    "definition": "테스트 정의입니다.",
                    "domain": "ml",
                    "term_en": "TestTerm",
                    "aliases": ["TT", "테스트용어"],
                },
            )
            assert r.status_code == 202, r.text
            data = r.json()["data"]
            assert data["status"] == "proposed"
            assert data["term"] == term
            assert data["proposed_by"] is not None
            term_id = data["id"]

            # 2) admin approve
            r = await ac.post(
                f"/api/v1/glossary/{term_id}/approve",
                headers={"Authorization": f"Bearer {admin}"},
            )
            assert r.status_code == 200, r.text
            ap = r.json()["data"]
            assert ap["status"] == "approved"
            assert ap["approved_by"] is not None
            assert ap["approved_at"] is not None

        # 3) DB 검증: audit_logs 2건 + term_proposals 2건
        async with session_scope() as s:
            audit_count = int((await s.execute(
                text("""
                    SELECT count(*) FROM audit_logs
                    WHERE target = :tgt
                """),
                {"tgt": f"term:{term_id}"},
            )).scalar() or 0)
            assert audit_count == 2, f"expected 2 audit logs, got {audit_count}"

            history_actions = [
                r[0] for r in (await s.execute(
                    text("""
                        SELECT action FROM term_proposals
                        WHERE term_id = CAST(:tid AS uuid)
                        ORDER BY created_at
                    """),
                    {"tid": term_id},
                )).all()
            ]
            assert history_actions == ["propose", "approve"]
    finally:
        if term_id:
            await cleanup_term_id(term_id)


@pytest.mark.asyncio
async def test_reject_writes_reason_and_status() -> None:
    """FR-06: admin reject + reason 기록."""
    term = unique_term("rejcase")
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
            assert term_id

            r = await ac.post(
                f"/api/v1/glossary/{term_id}/reject",
                headers={"Authorization": f"Bearer {admin}"},
                json={"reason": "중복 동의어 — 기존 용어에 alias 추가 권장"},
            )
            assert r.status_code == 200, r.text
            d = r.json()["data"]
            assert d["status"] == "rejected"
            assert "중복" in (d["reject_reason"] or "")

            # reason 없으면 422
            r = await ac.post(
                f"/api/v1/glossary/{term_id}/reject",
                headers={"Authorization": f"Bearer {admin}"},
                json={},
            )
            assert r.status_code == 422
    finally:
        if term_id:
            await cleanup_term_id(term_id)


@pytest.mark.asyncio
async def test_propose_not_visible_in_public_list() -> None:
    """AC-05: approved 만 GET /glossary 에 노출."""
    term = unique_term("hidden")
    transport = ASGITransport(app=app)
    term_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            r = await ac.post(
                "/api/v1/glossary/propose",
                headers={"Authorization": f"Bearer {reader}"},
                json={"term": term, "definition": "정의", "domain": "ml"},
            )
            term_id = r.json()["data"]["id"]
            # public GET 에는 안 보여야
            r = await ac.get("/api/v1/glossary", params={"q": term})
            items = r.json()["data"]["items"]
            assert all(it["term"] != term for it in items)

            # /glossary/term/{term} 도 not found (proposed 라 숨김)
            r = await ac.get(f"/api/v1/glossary/term/{term}")
            assert r.status_code == 404
    finally:
        if term_id:
            await cleanup_term_id(term_id)


@pytest.mark.asyncio
async def test_pending_lists_proposed_terms_admin_only() -> None:
    """FR-04: admin 만 pending 목록을 본다."""
    term = unique_term("pending")
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

            # reader 는 403
            r = await ac.get(
                "/api/v1/glossary/pending",
                headers={"Authorization": f"Bearer {reader}"},
            )
            assert r.status_code == 403

            # admin 은 ok + 우리 term 이 결과에 있어야
            r = await ac.get(
                "/api/v1/glossary/pending",
                headers={"Authorization": f"Bearer {admin}"},
                params={"size": 200},
            )
            assert r.status_code == 200
            items = r.json()["data"]["items"]
            assert any(it["id"] == term_id for it in items)
    finally:
        if term_id:
            await cleanup_term_id(term_id)
