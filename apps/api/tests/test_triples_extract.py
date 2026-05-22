"""graph-edge-predicates — /api/v1/triples/extract + /extract/bulk.

mock provider 환경에서: extract 는 문서 본문의 [[slug]] 1~2 개를 llm triple 로
저장. 재호출 시 기존 llm triple 교체 (중복 안 쌓임), manual triple 보존.
bulk 는 admin 전용.
"""
from __future__ import annotations

import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def _ensure_editor() -> str:
    async with session_scope() as s:
        email = "editor-tripex@mx.local"
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if row is None:
            await s.execute(
                text("INSERT INTO users (email, name, password_hash, role) "
                     "VALUES (:e, :n, :pw, 'editor')"),
                {"e": email, "n": email, "pw": hash_password("test1234!")},
            )
            await s.commit()
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        return make_access_token(str(row[0]))


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
                        "text": f"본문 {body} 끝."}],
        }],
    }


async def _make_doc(slug: str, *targets: str) -> None:
    owner = await _admin_id()
    async with session_scope() as s:
        await s.execute(
            text("""INSERT INTO documents (slug, title, status, content_json, owner_id)
                    VALUES (:slug, :slug, 'published', CAST(:cj AS jsonb), :owner)"""),
            {"slug": slug, "cj": json.dumps(_content(*targets)), "owner": owner},
        )
        await s.commit()


async def _cleanup(slug: str) -> None:
    async with session_scope() as s:
        await s.execute(text("DELETE FROM doc_triples WHERE subject_slug = :s"),
                        {"s": slug})
        await s.execute(text("DELETE FROM documents WHERE slug = :s"), {"s": slug})
        await s.commit()


@pytest.mark.asyncio
async def test_extract_stores_llm_triples() -> None:
    slug = f"ex-doc-{uuid.uuid4().hex[:8]}"
    await _make_doc(slug, "oled", "amoled")
    transport = ASGITransport(app=app)
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "mock"
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            editor = await _ensure_editor()
            r = await ac.post("/api/v1/triples/extract",
                              headers={"Authorization": f"Bearer {editor}"},
                              json={"subject_slug": slug})
            assert r.status_code == 200, r.text
            d = r.json()["data"]
            assert d["source"] == "llm"
            assert d["stored"] >= 1
            assert len(d["extracted"]) == d["stored"]

            # GET 으로 llm triple 확인.
            r = await ac.get("/api/v1/triples",
                             headers={"Authorization": f"Bearer {editor}"},
                             params={"subject": slug, "source": "llm"})
            assert len(r.json()["data"]) == d["stored"]
    finally:
        await _cleanup(slug)
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)


@pytest.mark.asyncio
async def test_re_extract_replaces_llm_keeps_manual() -> None:
    slug = f"ex-re-{uuid.uuid4().hex[:8]}"
    await _make_doc(slug, "oled", "amoled")
    transport = ASGITransport(app=app)
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "mock"
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            editor = await _ensure_editor()
            h = {"Authorization": f"Bearer {editor}"}

            # manual triple 1 개 직접 추가.
            r = await ac.post("/api/v1/triples", headers=h, json={
                "subject_slug": slug, "predicate": "수동_술어",
                "object_slug": "manual-obj", "source": "manual",
            })
            assert r.status_code == 200, r.text

            # 1차 추출.
            r = await ac.post("/api/v1/triples/extract", headers=h,
                              json={"subject_slug": slug})
            stored1 = r.json()["data"]["stored"]
            assert stored1 >= 1

            # 2차 추출 — llm 은 교체되어 중복 안 쌓임.
            r = await ac.post("/api/v1/triples/extract", headers=h,
                              json={"subject_slug": slug})
            assert r.json()["data"]["replaced"] == stored1  # 기존 llm 삭제됨
            assert r.json()["data"]["stored"] == stored1

            # 전체 조회 — llm == stored1, manual == 1 (보존).
            r = await ac.get("/api/v1/triples", headers=h, params={"subject": slug})
            items = r.json()["data"]
            llm = [t for t in items if t["source"] == "llm"]
            man = [t for t in items if t["source"] == "manual"]
            assert len(llm) == stored1
            assert len(man) == 1
            assert man[0]["predicate"] == "수동_술어"
    finally:
        await _cleanup(slug)
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)


@pytest.mark.asyncio
async def test_bulk_extract_admin_only() -> None:
    slug = f"ex-bulk-{uuid.uuid4().hex[:8]}"
    await _make_doc(slug, "oled")
    transport = ASGITransport(app=app)
    try:
        os.environ["TRIPLE_EXTRACTOR_PROVIDER"] = "mock"
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            editor = await _ensure_editor()
            admin = await _login_admin(ac)

            # editor 는 bulk 거부.
            r = await ac.post("/api/v1/triples/extract/bulk",
                              headers={"Authorization": f"Bearer {editor}"},
                              json={"slugs": [slug]})
            assert r.status_code == 403, r.text

            # admin 은 가능.
            r = await ac.post("/api/v1/triples/extract/bulk",
                              headers={"Authorization": f"Bearer {admin}"},
                              json={"slugs": [slug]})
            assert r.status_code == 200, r.text
            d = r.json()["data"]
            assert d["documents"] == 1
            assert d["source"] == "llm"
            assert len(d["results"]) == 1
            assert d["results"][0]["subject_slug"] == slug
    finally:
        await _cleanup(slug)
        os.environ.pop("TRIPLE_EXTRACTOR_PROVIDER", None)
