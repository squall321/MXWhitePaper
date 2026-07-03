"""graph-triple-ontology + subgraph — 관계 유형 캐논 / 자동 inverse / N홉 서브그래프.

- GET /triples/predicates 캐논 목록
- create 시 캐논 predicate → inverse 자동 채움 (명시 inverse 는 우선)
- GET /triples/subgraph BFS 깊이 확장 + 사이클 안전
각 테스트는 만든 row 를 try/finally 로 정리한다.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app


async def _editor() -> str:
    email = "editor-triples@mx.local"
    async with session_scope() as s:
        row = (await s.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})).first()
        if row is None:
            await s.execute(
                text("INSERT INTO users (email, name, password_hash, role) "
                     "VALUES (:e, :n, :pw, 'editor')"),
                {"e": email, "n": email, "pw": hash_password("test1234!")},
            )
            await s.commit()
            row = (await s.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})).first()
        return make_access_token(str(row[0]))


async def _cleanup(*subjects: str) -> None:
    async with session_scope() as s:
        for subj in subjects:
            await s.execute(text("DELETE FROM doc_triples WHERE subject_slug = :s"), {"s": subj})
        await s.commit()


@pytest.mark.asyncio
async def test_predicates_canon_list() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {await _editor()}"}
        r = await ac.get("/api/v1/triples/predicates", headers=h)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        keys = {t["key"] for t in data}
        assert {"premise", "cites", "related-to"} <= keys
        premise = next(t for t in data if t["key"] == "premise")
        assert premise["predicate"] == "전제로 한다"
        assert premise["inverse"] == "의 전제가 된다"


@pytest.mark.asyncio
async def test_canon_predicate_autofills_inverse() -> None:
    subj = f"trip-onto-{uuid.uuid4().hex[:8]}"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {await _editor()}"}
        try:
            # 캐논 predicate, inverse 미지정 → 자동 채움
            r = await ac.post("/api/v1/triples", headers=h, json={
                "subject_slug": subj, "predicate": "전제로 한다", "object_slug": "o",
                "source": "manual",
            })
            assert r.status_code == 200, r.text
            assert r.json()["data"]["inverse_predicate"] == "의 전제가 된다"

            # 명시 inverse 는 자동보다 우선
            r2 = await ac.post("/api/v1/triples", headers=h, json={
                "subject_slug": subj, "predicate": "인용한다", "object_slug": "o2",
                "source": "manual", "inverse_predicate": "커스텀 역방향",
            })
            assert r2.json()["data"]["inverse_predicate"] == "커스텀 역방향"

            # 비-캐논(자유텍스트) predicate → inverse 없으면 None
            r3 = await ac.post("/api/v1/triples", headers=h, json={
                "subject_slug": subj, "predicate": "완전 자유 서술", "object_slug": "o3",
                "source": "manual",
            })
            assert r3.json()["data"]["inverse_predicate"] is None
        finally:
            await _cleanup(subj)


@pytest.mark.asyncio
async def test_subgraph_bfs_depth() -> None:
    # 체인 A --p--> B --p--> C. root=A depth=1 → {A,B}; depth=2 → {A,B,C}.
    a = f"sg-{uuid.uuid4().hex[:6]}-a"
    b = f"sg-{uuid.uuid4().hex[:6]}-b"
    c = f"sg-{uuid.uuid4().hex[:6]}-c"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {await _editor()}"}
        try:
            for subj, obj in [(a, b), (b, c)]:
                r = await ac.post("/api/v1/triples", headers=h, json={
                    "subject_slug": subj, "predicate": "전제로 한다", "object_slug": obj,
                    "source": "manual",
                })
                assert r.status_code == 200, r.text

            r1 = await ac.get(f"/api/v1/triples/subgraph?root={a}&depth=1", headers=h)
            assert r1.status_code == 200, r1.text
            d1 = r1.json()["data"]
            assert set(d1["nodes"]) == {a, b}
            assert len(d1["edges"]) == 1

            r2 = await ac.get(f"/api/v1/triples/subgraph?root={a}&depth=2", headers=h)
            d2 = r2.json()["data"]
            assert set(d2["nodes"]) == {a, b, c}
            assert len(d2["edges"]) == 2
            assert {e["hop"] for e in d2["edges"]} == {1, 2}
        finally:
            await _cleanup(a, b)


@pytest.mark.asyncio
async def test_subgraph_cycle_safe() -> None:
    # A --p--> B --p--> A (사이클). 무한루프 없이 유한 결과.
    a = f"cyc-{uuid.uuid4().hex[:6]}-a"
    b = f"cyc-{uuid.uuid4().hex[:6]}-b"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {await _editor()}"}
        try:
            for subj, obj in [(a, b), (b, a)]:
                await ac.post("/api/v1/triples", headers=h, json={
                    "subject_slug": subj, "predicate": "와 관련있다", "object_slug": obj,
                    "source": "manual",
                })
            r = await ac.get(f"/api/v1/triples/subgraph?root={a}&depth=4", headers=h)
            assert r.status_code == 200, r.text
            d = r.json()["data"]
            assert set(d["nodes"]) == {a, b}
            assert len(d["edges"]) == 2  # 두 방향 엣지, 중복 없음
        finally:
            await _cleanup(a, b)
