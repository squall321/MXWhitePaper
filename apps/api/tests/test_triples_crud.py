"""graph-edge-predicates — /api/v1/triples CRUD + RBAC.

각 테스트는 만든 doc_triples row 를 try/finally 로 정리한다 (prod DB 오염 방지).
"""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import make_access_token
from app.main import app


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _ensure_user(email: str, role: str) -> str:
    """Idempotent — role 유저 생성. token 반환."""
    from app.core.security import hash_password
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if row is None:
            await s.execute(
                text("INSERT INTO users (email, name, password_hash, role) "
                     "VALUES (:e, :n, :pw, :r)"),
                {"e": email, "n": email, "pw": hash_password("test1234!"), "r": role},
            )
            await s.commit()
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        return make_access_token(str(row[0]))


async def _delete_triples_by_subject(subject: str) -> None:
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM doc_triples WHERE subject_slug = :s"),
            {"s": subject},
        )
        await s.commit()


@pytest.mark.asyncio
async def test_editor_creates_and_reader_cannot() -> None:
    subj = f"trip-crud-{uuid.uuid4().hex[:8]}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        editor = await _ensure_user("editor-triples@mx.local", "editor")
        reader = await _ensure_user("reader-triples@mx.local", "reader")
        try:
            # reader 는 POST 거부.
            r = await ac.post(
                "/api/v1/triples",
                headers={"Authorization": f"Bearer {reader}"},
                json={"subject_slug": subj, "predicate": "테스트", "object_slug": "obj"},
            )
            assert r.status_code == 403, r.text

            # editor 는 정상 생성.
            r = await ac.post(
                "/api/v1/triples",
                headers={"Authorization": f"Bearer {editor}"},
                json={"subject_slug": subj, "predicate": "에서_쓰인다",
                      "object_slug": "obj-a", "source": "manual"},
            )
            assert r.status_code == 200, r.text
            d = r.json()["data"]
            assert d["subject_slug"] == subj
            assert d["source"] == "manual"
            assert d["created_by"] is not None  # manual 은 작성자 보관
        finally:
            await _delete_triples_by_subject(subj)


@pytest.mark.asyncio
async def test_duplicate_triple_conflicts() -> None:
    subj = f"trip-dup-{uuid.uuid4().hex[:8]}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        editor = await _ensure_user("editor-triples@mx.local", "editor")
        h = {"Authorization": f"Bearer {editor}"}
        body = {"subject_slug": subj, "predicate": "p", "object_slug": "o",
                "source": "manual"}
        try:
            r1 = await ac.post("/api/v1/triples", headers=h, json=body)
            assert r1.status_code == 200, r1.text
            # 같은 (subject, predicate, object, source) → 409.
            r2 = await ac.post("/api/v1/triples", headers=h, json=body)
            assert r2.status_code == 409, r2.text
        finally:
            await _delete_triples_by_subject(subj)


@pytest.mark.asyncio
async def test_filter_by_subject_object_predicate_source() -> None:
    subj = f"trip-filt-{uuid.uuid4().hex[:8]}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        editor = await _ensure_user("editor-triples@mx.local", "editor")
        h = {"Authorization": f"Bearer {editor}"}
        try:
            for pred, obj in [("p1", "oA"), ("p2", "oB")]:
                r = await ac.post("/api/v1/triples", headers=h, json={
                    "subject_slug": subj, "predicate": pred,
                    "object_slug": obj, "source": "manual",
                })
                assert r.status_code == 200, r.text

            # subject 필터.
            r = await ac.get("/api/v1/triples", headers=h, params={"subject": subj})
            assert r.status_code == 200
            items = r.json()["data"]
            assert len(items) == 2
            assert all(t["subject_slug"] == subj for t in items)

            # predicate 필터.
            r = await ac.get("/api/v1/triples", headers=h,
                             params={"subject": subj, "predicate": "p1"})
            assert len(r.json()["data"]) == 1

            # object 필터.
            r = await ac.get("/api/v1/triples", headers=h,
                             params={"subject": subj, "object": "oB"})
            assert len(r.json()["data"]) == 1

            # source 필터 — 전부 manual.
            r = await ac.get("/api/v1/triples", headers=h,
                             params={"subject": subj, "source": "manual"})
            assert len(r.json()["data"]) == 2
            r = await ac.get("/api/v1/triples", headers=h,
                             params={"subject": subj, "source": "llm"})
            assert len(r.json()["data"]) == 0
        finally:
            await _delete_triples_by_subject(subj)


@pytest.mark.asyncio
async def test_delete_creator_ok_others_forbidden() -> None:
    subj = f"trip-del-{uuid.uuid4().hex[:8]}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        editor = await _ensure_user("editor-triples@mx.local", "editor")
        other = await _ensure_user("editor2-triples@mx.local", "editor")
        admin = await _login_admin(ac)
        try:
            # editor 가 manual triple 생성.
            r = await ac.post("/api/v1/triples",
                              headers={"Authorization": f"Bearer {editor}"},
                              json={"subject_slug": subj, "predicate": "p",
                                    "object_slug": "o", "source": "manual"})
            tid = r.json()["data"]["id"]

            # 다른 editor 는 삭제 거부.
            r = await ac.delete(f"/api/v1/triples/{tid}",
                                headers={"Authorization": f"Bearer {other}"})
            assert r.status_code == 403, r.text

            # 작성자 본인은 삭제 가능.
            r = await ac.delete(f"/api/v1/triples/{tid}",
                                headers={"Authorization": f"Bearer {editor}"})
            assert r.status_code == 200, r.text

            # 없는 id → 404.
            r = await ac.delete(f"/api/v1/triples/{tid}",
                                headers={"Authorization": f"Bearer {admin}"})
            assert r.status_code == 404
        finally:
            await _delete_triples_by_subject(subj)


@pytest.mark.asyncio
async def test_delete_llm_triple_admin_only() -> None:
    """created_by=NULL (llm) triple 은 admin 만 삭제."""
    subj = f"trip-llmdel-{uuid.uuid4().hex[:8]}"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        editor = await _ensure_user("editor-triples@mx.local", "editor")
        admin = await _login_admin(ac)
        try:
            # source='llm' 으로 만들면 created_by NULL.
            r = await ac.post("/api/v1/triples",
                              headers={"Authorization": f"Bearer {editor}"},
                              json={"subject_slug": subj, "predicate": "p",
                                    "object_slug": "o", "source": "llm"})
            assert r.status_code == 200, r.text
            tid = r.json()["data"]["id"]
            assert r.json()["data"]["created_by"] is None

            # editor 는 llm triple 삭제 거부.
            r = await ac.delete(f"/api/v1/triples/{tid}",
                                headers={"Authorization": f"Bearer {editor}"})
            assert r.status_code == 403, r.text

            # admin 은 가능.
            r = await ac.delete(f"/api/v1/triples/{tid}",
                                headers={"Authorization": f"Bearer {admin}"})
            assert r.status_code == 200, r.text
        finally:
            await _delete_triples_by_subject(subj)
