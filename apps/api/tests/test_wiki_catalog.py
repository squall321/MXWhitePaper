# 위키 목록(index · index.md)과 규칙서 창구(GET · PUT /schema) 시험 — 범위마다 다른 목록 · 규칙서는 admin 만 · 틀린 YAML 은 저장 거부
"""docs/llm-wiki W4 — CONTRACTS §10 목록 꼴 · request §5-3 규칙서(판 · YAML 검증 · admin 만).

규칙서 시험은 `wiki_schema.SLUG` 를 이 실행 전용 slug 로 바꿔 dev 의 진짜 규칙서 문서를 건드리지 않는다(저장 길 · 읽기 길이 모두 그
이름을 실행 때 읽는다).
"""
from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app
from app.search import meili_indexer
from app.wiki import audience
from app.wiki import schema as wiki_schema

RUN = uuid4().hex[:8]
API = "/api/v1/wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))


async def _user(s: Any, name: str, role: str, *, aff: str | None = None) -> dict[str, str]:
    uid = str(uuid4())
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at)
    """), {"id": uid, "e": f"w4-cat-{RUN}-{name}@example.com", "n": f"W4 {name}", "pw": hash_password("x" * 16),
           "r": role, "a": aff, "p": [] if aff else None, "at": datetime.now(UTC) if aff else None})
    return {"Authorization": f"Bearer {make_access_token(uid)}"}


async def _page(s: Any, slug: str, kind: str, aud: list[str], entity: str | None, summary: str) -> None:
    body = {**BASE, "slug": slug, "title": f"목록 시험 {slug}", "summary": summary}
    owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
    doc_id = (await s.execute(text("""
        INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
        VALUES (:slug, :t, :sm, 'published', CAST(:c AS jsonb), :o) RETURNING id
    """), {"slug": slug, "t": body["title"], "sm": summary, "c": json.dumps(body, ensure_ascii=False), "o": owner})).scalar_one()
    await s.execute(text("""
        INSERT INTO wiki_pages (doc_id, kind, managed, audience, entity_id)
        VALUES (:d, :k, 'ai', CAST(:a AS text[]), CAST(:e AS uuid))
    """), {"d": doc_id, "k": kind, "a": aud, "e": entity})


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    monkeypatch.setattr(wiki_schema, "SLUG", f"wiki-schema-t{RUN}")
    async with session_scope() as s:
        heads = {"plain": await _user(s, "plain", "reader"), "aff": await _user(s, "aff", "reader", aff="SYN-CAE1"),
                 "editor": await _user(s, "editor", "editor"), "admin": await _user(s, "admin", "admin")}
        ent = str((await s.execute(text("""
            INSERT INTO wiki_entities (type_key, canonical_name, audience) VALUES ('part', :n, ARRAY['org']) RETURNING id
        """), {"n": f"목록 부품 {RUN}"})).scalar_one())
        await _page(s, f"ent-part-cat{RUN}", "entity", ["org"], ent, "넓은 문서의 요약")
        await _page(s, f"ent-part-cat{RUN}--syn-cae1", "entity", ["aff:SYN-CAE1"], ent, "좁은 문서의 요약")
        await _page(s, f"case-sim-cat{RUN}", "case", ["org"], None, "")
        await _page(s, f"src-cat{RUN}", "source", ["org"], None, "원천 문서")
        await s.commit()
    yield heads
    async with session_scope() as s:
        ids = [str(r[0]) for r in (await s.execute(text("SELECT id FROM documents WHERE slug LIKE :p OR slug = :sch"),
                                                   {"p": f"%cat{RUN}%", "sch": f"wiki-schema-t{RUN}"})).all()]
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:i AS uuid[]))"), {"i": ids})
        await s.execute(text("DELETE FROM wiki_entities WHERE canonical_name = :n"), {"n": f"목록 부품 {RUN}"})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w4-cat-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w4-cat-{RUN}-%"})
    for doc_id in ids:
        meili_indexer.delete_document(doc_id)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _slugs(idx: dict[str, Any], key: str) -> set[str]:
    sec = next((x for x in idx["sections"] if x["key"] == key), {"items": []})
    return {it["slug"] for it in sec["items"] if RUN in it["slug"]}


async def test_index_differs_by_scope(world: dict[str, Any]) -> None:
    async with _client() as c:
        plain = (await c.get(f"{API}/index", headers=world["plain"])).json()["data"]
        aff = (await c.get(f"{API}/index", headers=world["aff"])).json()["data"]
        md = await c.get(f"{API}/index.md", headers=world["aff"])
    assert _slugs(plain, "part") == {f"ent-part-cat{RUN}"}  # 좁은 문서는 그 범위 사람에게만
    assert _slugs(aff, "part") == {f"ent-part-cat{RUN}", f"ent-part-cat{RUN}--syn-cae1"}
    assert _slugs(plain, "sim-case") == {f"case-sim-cat{RUN}"}
    assert all(f"src-cat{RUN}" not in json.dumps(x) for x in (plain, aff))  # 원천 문서는 목록에 싣지 않는다
    part = next(x for x in aff["sections"] if x["key"] == "part")
    assert part["label"] == "부품"
    assert md.headers["content-type"].startswith("text/markdown")
    assert re.search(r"^# 위키 목록 \(규칙서 v\d+ · \d{4}-\d\d-\d\d \d\d:\d\d KST · 문서 [\d,]+ · 원천 [\d,]+\)$", md.text, re.M)
    assert re.search(r"^## 부품\(part\) — [\d,]+$", md.text, re.M)
    assert f"- [[ent-part-cat{RUN}--syn-cae1|목록 시험 ent-part-cat{RUN}--syn-cae1]] — 좁은 문서의 요약" in md.text


async def test_rule_book_put_get_and_guard(world: dict[str, Any]) -> None:
    slug = wiki_schema.SLUG
    async with _client() as c:
        first = (await c.get(f"{API}/schema", headers=world["plain"])).json()["data"]
        assert (first["exists"], first["version"], first["slug"]) == (False, 0, slug)
        assert first["yaml"] == wiki_schema.DEFAULT_YAML and len(first["spec"]["rules"]) == 10
        assert (await c.put(f"{API}/schema", headers=world["editor"], json={"yaml": first["yaml"]})).status_code == 403
        bad = await c.put(f"{API}/schema", headers=world["admin"], json={"yaml": "rules: [a]\nsections: {part: [요약]}\n"})
        assert bad.status_code == 422 and "source" in bad.json()["error"]["message"]
        made = (await c.put(f"{API}/schema", headers=world["admin"], json={"yaml": first["yaml"]})).json()["data"]
        assert made == {"slug": slug, "version": 1, "created": True}
        changed = first["yaml"].replace("max_pages_per_source: 12", "max_pages_per_source: 10")
        again = (await c.put(f"{API}/schema", headers=world["admin"], json={"yaml": changed})).json()["data"]
        assert again == {"slug": slug, "version": 2, "created": False}
        now = (await c.get(f"{API}/schema", headers=world["plain"])).json()["data"]
        doc = (await c.get(f"/api/v1/documents/{slug}", headers=world["editor"])).json()
        etag = doc["meta"]["etag"]
        edit = await c.put(f"/api/v1/documents/{slug}", headers={**world["editor"], "If-Match": etag},
                           json=doc["data"]["content"])
    assert now["exists"] and now["version"] == 2 and now["spec"]["ingest"]["max_pages_per_source"] == 10
    assert edit.status_code == 403  # 문서 편집 길로도 admin 만
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        book = await wiki_schema.load(s)
    assert book.version == 2 and book.spec.ingest.max_pages_per_source == 10
