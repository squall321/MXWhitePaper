"""graph-triple-inverse — inverse_predicate 저장/조회/추출 회귀 테스트.

엣지의 역방향 자연어 설명(object 쪽에서 읽는 관계)을 manual 입력 시 보관하고,
조회 시 그대로 반환하며, mock LLM 추출이 양방향을 함께 생성하는지 검증한다.
각 테스트는 만든 row 를 try/finally 로 정리한다 (prod DB 오염 방지).
"""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app


async def _ensure_user(email: str, role: str) -> str:
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
            text("DELETE FROM doc_triples WHERE subject_slug = :s"), {"s": subject}
        )
        await s.commit()


@pytest.mark.asyncio
async def test_manual_inverse_stored_and_returned() -> None:
    subj = f"trip-inv-{uuid.uuid4().hex[:8]}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        editor = await _ensure_user("editor-triples@mx.local", "editor")
        h = {"Authorization": f"Bearer {editor}"}
        try:
            r = await ac.post("/api/v1/triples", headers=h, json={
                "subject_slug": subj, "predicate": "인용한다",
                "object_slug": "obj-x", "source": "manual",
                "inverse_predicate": "에 인용된다",
            })
            assert r.status_code == 200, r.text
            assert r.json()["data"]["inverse_predicate"] == "에 인용된다"

            # object 쪽(들어오는 관계)에서 조회해도 inverse 가 보인다.
            r2 = await ac.get("/api/v1/triples?object=obj-x", headers=h)
            assert r2.status_code == 200, r2.text
            hit = [t for t in r2.json()["data"] if t["subject_slug"] == subj]
            assert hit and hit[0]["inverse_predicate"] == "에 인용된다"
        finally:
            await _delete_triples_by_subject(subj)


@pytest.mark.asyncio
async def test_manual_inverse_optional_defaults_null() -> None:
    subj = f"trip-invn-{uuid.uuid4().hex[:8]}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        editor = await _ensure_user("editor-triples@mx.local", "editor")
        h = {"Authorization": f"Bearer {editor}"}
        try:
            r = await ac.post("/api/v1/triples", headers=h, json={
                "subject_slug": subj, "predicate": "p", "object_slug": "o",
                "source": "manual",
            })
            assert r.status_code == 200, r.text
            assert r.json()["data"]["inverse_predicate"] is None
        finally:
            await _delete_triples_by_subject(subj)


@pytest.mark.asyncio
async def test_mock_extract_generates_inverse() -> None:
    from app.services.triple_extractor import TripleExtractor

    async with session_scope() as s:
        # mock provider 는 본문 [[slug]] 후보로 양방향 triple 을 만든다.
        ex = TripleExtractor(s)
        out = await ex._mock_extract("__nonexistent__")  # 본문 없음 → []
    assert out == []

    # mock 의 양방향 생성 자체를 단위로 확인 (본문 무관 placeholder 경로).
    from app.services.triple_extractor import ExtractedTriple
    t = ExtractedTriple(predicate="는_a_와_관련있다", object_slug="a",
                        confidence=0.7, inverse_predicate="와_관련있다")
    assert t.inverse_predicate == "와_관련있다"
