"""graph-edge-predicates — /api/v1/links/graph?include_triples=true.

include_triples=true 시 doc_triples 가 그래프 엣지에 합류. subject/object 가
둘 다 그래프 노드인 triple 만 — 존재 안 하는 slug 의 triple 은 자동 제외.
include_triples 미지정 시 기존 동작 동일 (triple 엣지 없음).
"""
from __future__ import annotations

import json
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app


async def _admin_id() -> str:
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = 'admin@mx.local'")
        )).first()
        assert row is not None
        return str(row[0])


def _content(*targets: str) -> dict:
    body = " ".join(f"[[{t}]]" for t in targets)
    return {
        "version": "1.0",
        "sections": [{
            "id": "s1", "number": "1", "title": "본문",
            "blocks": [{"id": "b1", "type": "paragraph",
                        "text": f"본문 {body}."}],
        }],
    }


async def _seed_linked_pair() -> tuple[str, str]:
    """A -[wiki]-> B 인 두 문서를 만들고 (A_slug, B_slug) 반환.

    root=A, depth>=1 로 graph 를 부르면 둘 다 노드에 들어온다.
    """
    owner = await _admin_id()
    a = f"trip-graph-a-{uuid.uuid4().hex[:8]}"
    b = f"trip-graph-b-{uuid.uuid4().hex[:8]}"
    async with session_scope() as s:
        rid_a = (await s.execute(
            text("""INSERT INTO documents (slug, title, status, content_json, owner_id)
                    VALUES (:s, :s, 'published', CAST(:cj AS jsonb), :o) RETURNING id"""),
            {"s": a, "cj": json.dumps(_content(b)), "o": owner},
        )).scalar_one()
        rid_b = (await s.execute(
            text("""INSERT INTO documents (slug, title, status, content_json, owner_id)
                    VALUES (:s, :s, 'published', CAST(:cj AS jsonb), :o) RETURNING id"""),
            {"s": b, "cj": json.dumps(_content()), "o": owner},
        )).scalar_one()
        # A -> B wiki link.
        await s.execute(
            text("""INSERT INTO links (source_doc_id, target_slug, target_doc_id, link_type)
                    VALUES (:src, :tgt, :tdoc, 'wiki')"""),
            {"src": rid_a, "tgt": b, "tdoc": rid_b},
        )
        await s.commit()
    return a, b


async def _cleanup(*slugs: str) -> None:
    async with session_scope() as s:
        for sl in slugs:
            await s.execute(text("DELETE FROM doc_triples WHERE subject_slug = :s OR object_slug = :s"), {"s": sl})
        # links 는 documents CASCADE 로 같이 삭제됨.
        for sl in slugs:
            await s.execute(text("DELETE FROM documents WHERE slug = :s"), {"s": sl})
        await s.commit()


async def _add_triple(subject: str, predicate: str, obj: str, source: str = "manual") -> None:
    import ulid
    async with session_scope() as s:
        await s.execute(
            text("""INSERT INTO doc_triples (id, subject_slug, predicate, object_slug, source)
                    VALUES (:id, :s, :p, :o, :src)"""),
            {"id": str(ulid.new()), "s": subject, "p": predicate, "o": obj, "src": source},
        )
        await s.commit()


@pytest.mark.asyncio
async def test_include_triples_merges_triple_edges() -> None:
    a, b = await _seed_linked_pair()
    try:
        await _add_triple(a, "에서_사용된다", b, source="manual")
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/v1/links/graph",
                             params={"root": a, "depth": 1, "include_triples": True})
        assert r.status_code == 200, r.text
        edges = r.json()["data"]["edges"]
        triple_edges = [e for e in edges if e.get("kind") == "triple"]
        assert len(triple_edges) == 1
        te = triple_edges[0]
        assert te["source"] == a
        assert te["target"] == b
        assert te["predicate"] == "에서_사용된다"
        assert te["triple_source"] == "manual"
    finally:
        await _cleanup(a, b)


@pytest.mark.asyncio
async def test_triple_with_missing_slug_is_excluded() -> None:
    """object 가 그래프 노드에 없으면 그 triple 은 응답에서 제외."""
    a, b = await _seed_linked_pair()
    try:
        # object 가 그래프에 없는 가짜 slug.
        await _add_triple(a, "존재하지_않는_관계", "no-such-node-xyz", source="manual")
        # object 가 그래프 노드인 정상 triple.
        await _add_triple(a, "정상_관계", b, source="manual")
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/v1/links/graph",
                             params={"root": a, "depth": 1, "include_triples": True})
        assert r.status_code == 200, r.text
        triple_edges = [e for e in r.json()["data"]["edges"]
                        if e.get("kind") == "triple"]
        # 가짜 slug triple 은 빠지고 정상 1 개만.
        assert len(triple_edges) == 1
        assert triple_edges[0]["predicate"] == "정상_관계"
    finally:
        await _cleanup(a, b)


@pytest.mark.asyncio
async def test_default_excludes_triples() -> None:
    """include_triples 미지정 시 triple 엣지 없음 (기존 동작 보존)."""
    a, b = await _seed_linked_pair()
    try:
        await _add_triple(a, "에서_사용된다", b, source="manual")
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/v1/links/graph",
                             params={"root": a, "depth": 1})
        assert r.status_code == 200, r.text
        triple_edges = [e for e in r.json()["data"]["edges"]
                        if e.get("kind") == "triple"]
        assert triple_edges == []
    finally:
        await _cleanup(a, b)
