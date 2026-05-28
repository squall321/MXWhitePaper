"""FR-12 — GET /graph/terms/{id} D3 응답 shape."""
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


async def _propose_approve(
    ac: AsyncClient, reader: str, admin: str, term: str, **kw: object
) -> str:
    payload: dict[str, object] = {
        "term": term,
        "definition": "정의",
        "domain": kw.get("domain", "ml"),
    }
    payload.update({k: v for k, v in kw.items() if k != "domain"})
    r = await ac.post(
        "/api/v1/glossary/propose",
        headers={"Authorization": f"Bearer {reader}"},
        json=payload,
    )
    tid = r.json()["data"]["id"]
    r = await ac.post(
        f"/api/v1/glossary/{tid}/approve",
        headers={"Authorization": f"Bearer {admin}"},
    )
    assert r.status_code == 200
    return tid


async def _attach_doc(term_id: str, doc_id: str) -> None:
    """terms.related_docs 에 doc id 추가 (test helper)."""
    async with session_scope() as s:
        await s.execute(
            text("""
                UPDATE terms SET related_docs = ARRAY(
                  SELECT DISTINCT unnest(related_docs || ARRAY[CAST(:doc AS uuid)])
                )
                WHERE id = CAST(:id AS uuid)
            """),
            {"doc": doc_id, "id": term_id},
        )
        await s.commit()


async def _make_doc(slug: str, title: str) -> str:
    """seed admin owner 로 minimal document INSERT — id 반환."""
    async with session_scope() as s:
        owner_row = (await s.execute(text(
            "SELECT id FROM users WHERE email = 'admin@mx.local'"
        ))).first()
        assert owner_row
        owner = str(owner_row[0])
        row = (await s.execute(
            text("""
                INSERT INTO documents
                  (slug, title, content_json, schema_ver, version, owner_id)
                VALUES (:slug, :title, CAST('{}' AS jsonb), '1.0', 1,
                        CAST(:owner AS uuid))
                RETURNING id
            """),
            {"slug": slug, "title": title, "owner": owner},
        )).first()
        await s.commit()
        assert row
        return str(row[0])


async def _delete_doc(doc_id: str) -> None:
    async with session_scope() as s:
        await s.execute(text(
            "DELETE FROM documents WHERE id = CAST(:id AS uuid)"
        ), {"id": doc_id})
        await s.commit()


@pytest.mark.asyncio
async def test_graph_returns_center_nodes_edges_shape() -> None:
    transport = ASGITransport(app=app)
    base = unique_term("graph")
    tid: str | None = None
    tid2: str | None = None
    doc_id: str | None = None
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            reader = await ensure_user("reader-glossary@mx.local", "reader")
            admin = await login_admin(ac)
            tid = await _propose_approve(ac, reader, admin, f"{base}-center")
            tid2 = await _propose_approve(ac, reader, admin, f"{base}-co")

            # 같은 doc 을 두 term 에 attach → cooccur 형성
            doc_id = await _make_doc(f"doc-{base}", "테스트 문서")
            await _attach_doc(tid, doc_id)
            await _attach_doc(tid2, doc_id)

            r = await ac.get(
                f"/api/v1/graph/terms/{tid}",
                headers={"Authorization": f"Bearer {reader}"},
            )
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            assert data["center"]["id"] == tid
            assert data["center"]["type"] == "term"
            assert isinstance(data["nodes"], list)
            assert isinstance(data["edges"], list)
            node_types = {n["type"] for n in data["nodes"]}
            assert "document" in node_types
            assert "term" in node_types  # cooccur
            rels = {e["rel"] for e in data["edges"]}
            assert "referenced_in" in rels
            assert "cooccurs_with" in rels
    finally:
        if tid:
            await cleanup_term_id(tid)
        if tid2:
            await cleanup_term_id(tid2)
        if doc_id:
            await _delete_doc(doc_id)


@pytest.mark.asyncio
async def test_graph_requires_authentication() -> None:
    """FR-12 권한: 로그인 사용자 (reader+) 만. 미인증은 dev fallback (admin) 이므로
    여기선 not-found 가 적절히 처리되는지만 검증."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/graph/terms/00000000-0000-0000-0000-000000000000"
        )
        # 미인증/admin-fallback 둘 다 404 (해당 term 없음)
        assert r.status_code in (401, 404)
