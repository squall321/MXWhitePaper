# 위키 되쌓기 시험 — 묻기의 답 → qa 원천(그 사람 명의) → 들이기 → 문답 문서, 비슷한 물음은 같은 문답 문서에 · 범위는 근거보다 넓지 않게
"""docs/llm-wiki W6 — request §5-7 '위키에 남기기' · CONTRACTS §6 `POST /fileback`. 들이기는 가짜 LLM(정상 — 첫 후보)으로 돌린다."""
from __future__ import annotations

import json
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
from app.wiki import audience, sources, worker
from app.wiki.envelope import SourceEnvelope

RUN = uuid4().hex[:8]
API = "/api/v1/wiki"
FIX = Path(__file__).parent / "fixtures" / "wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
NAME = f"힌지 브래킷 F{RUN}"
PREFIX = f"w6-fb-{RUN}"


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


async def _user(s: Any, name: str, role: str, *, aff: str | None = None) -> dict[str, Any]:
    uid = str(uuid4())
    email = f"{PREFIX}-{name}@example.com"
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at)
    """), {"id": uid, "e": email, "n": f"W6 {name}", "pw": hash_password("x" * 16), "r": role, "a": aff,
           "p": [] if aff else None, "at": datetime.now(UTC) if aff else None})
    return {"id": uid, "email": email, "role": role, "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


async def _page(s: Any, slug: str, aud: list[str], entity: str, block: str, body: str) -> str:
    owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
    content = {**BASE, "slug": slug, "title": NAME, "sections": [{"id": "s0", "title": "요약", "blocks": [
        {"type": "paragraph", "id": block, "text": body}]}]}
    doc_id = str((await s.execute(text("""
        INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
        VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o) RETURNING id
    """), {"slug": slug, "t": NAME, "c": json.dumps(content, ensure_ascii=False), "o": owner})).scalar_one())
    await s.execute(text("""
        INSERT INTO wiki_pages (doc_id, kind, managed, audience, entity_id) VALUES (:d, 'entity', 'ai', CAST(:a AS text[]), CAST(:e AS uuid))
    """), {"d": doc_id, "a": aud, "e": entity})
    return doc_id


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch, fake_llm: Any) -> Any:
    st = get_settings()
    for key, value in (("wiki_enabled", True), ("wiki_llm_base_url", fake_llm.base_url), ("wiki_llm_model", fake_llm.model),
                       ("wiki_llm_api_key", ""), ("wiki_llm_structured", "json_schema")):
        monkeypatch.setattr(st, key, value)
    fake_llm.load("ingest-normal.json")
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        w = {"reader": await _user(s, "reader", "reader"), "aff": await _user(s, "aff", "reader", aff="SYN-CAE1"),
             "admin": await _user(s, "admin", "admin")}
        env = json.loads((FIX / "sources" / "03-sim-stcx-job0002-rib.json").read_text(encoding="utf-8"))
        env["origin"]["ref"] = f"{PREFIX}-src"
        env["owner"] = {"email": w["admin"]["email"]}
        w["src"] = (await sources.receive(s, SourceEnvelope.model_validate(env), caller=w["admin"], ingest=False)).id
    async with session_scope() as s:
        ent = str((await s.execute(text("""
            INSERT INTO wiki_entities (type_key, canonical_name, audience) VALUES ('part', :n, ARRAY['org']) RETURNING id
        """), {"n": NAME})).scalar_one())
        doc = await _page(s, f"ent-part-f{RUN}", ["org"], ent, f"f{RUN}b1", "힌지 브래킷의 최대 응력은 412 MPa 다.")
        await _page(s, f"ent-part-f{RUN}--syn-cae1", ["aff:SYN-CAE1"], ent, f"f{RUN}b9", "좁은 결과는 777 MPa 다.")
        await s.execute(text("""
            INSERT INTO wiki_citations (doc_id, block_id, source_id, locator) VALUES (CAST(:d AS uuid), :b, CAST(:src AS uuid), '{}')
        """), {"d": doc, "b": f"f{RUN}b1", "src": w["src"]})
    yield w
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        src = [str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM wiki_sources WHERE owner_email LIKE :e"), {"e": f"{PREFIX}-%"})).all()]
        cs = [str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM wiki_changesets WHERE plan ->> 'source_id' = ANY(:ids)"), {"ids": src})).all()]
        docs = {str(r[0]) for r in (await s.execute(text("""
            SELECT doc_id FROM wiki_sources WHERE id = ANY(CAST(:ids AS uuid[])) AND doc_id IS NOT NULL
            UNION SELECT DISTINCT doc_id FROM wiki_citations WHERE source_id = ANY(CAST(:ids AS uuid[]))
            UNION SELECT id FROM documents WHERE slug LIKE :p
        """), {"ids": src, "p": f"ent-part-f{RUN}%"})).all()}
        await s.execute(text("DELETE FROM wiki_citations WHERE source_id = ANY(CAST(:ids AS uuid[]))"), {"ids": src})
        await s.execute(text("DELETE FROM wiki_jobs WHERE args ->> 'source_id' = ANY(:ids)"), {"ids": src})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE changeset_id = ANY(CAST(:cs AS uuid[])) OR title LIKE ANY(:t)"),
                        {"cs": cs, "t": [f"%({sources.short_id(i)})" for i in src]})
        await s.execute(text("DELETE FROM wiki_changesets WHERE id = ANY(CAST(:cs AS uuid[]))"), {"cs": cs})
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[]))"), {"d": sorted(docs)})
        await s.execute(text("DELETE FROM wiki_entities WHERE canonical_name = :n"), {"n": NAME})
        await s.execute(text("DELETE FROM wiki_sources WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": src})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"{PREFIX}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"{PREFIX}-%"})
    for d in docs:
        meili_indexer.delete_document(d)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _fileback(who: dict[str, Any], question: str, *, block: str = "b1", slug: str | None = None,
                    aud: list[str] | None = None) -> Any:
    body = {"question": question, "answer": "최대 응력은 412 MPa 다 [1].", "outcome": "solved",
            "citations": [{"slug": slug or f"ent-part-f{RUN}", "block_id": f"f{RUN}{block}"}],
            **({"audience": aud} if aud is not None else {})}
    async with _client() as c:
        return await c.post(f"{API}/fileback", headers=who["headers"], json=body)


async def _drain() -> None:
    while await worker.run_once(f"test-w6-{RUN}", ops=["ingest"]):
        pass


async def _plan(source_id: str) -> dict[str, Any]:
    async with session_scope() as s:
        return _j((await s.execute(text("""
            SELECT plan FROM wiki_changesets WHERE plan ->> 'source_id' = :i ORDER BY created_at DESC LIMIT 1
        """), {"i": source_id})).scalar_one())


async def test_fileback_becomes_a_qa_page_and_merges(world: dict[str, Any]) -> None:
    r = await _fileback(world["reader"], f"{NAME} 최대 응력은 얼마인가")
    assert r.status_code == 201, r.text
    first = r.json()["data"]
    assert first["audience"] == ["org"] and first["ingest_state"] == "queued"  # 근거가 전사 문서뿐이라 전사로
    again = await _fileback(world["reader"], f"{NAME} 최대 응력은 얼마인가")
    assert again.status_code == 200 and again.json()["data"]["id"] == first["id"]  # 같은 사람 · 물음 · 답이면 멱등
    async with session_scope() as s:
        row = (await s.execute(text("""
            SELECT kind, owner_email, consent ->> 'mode', payload FROM wiki_sources WHERE id = CAST(:i AS uuid)
        """), {"i": first["id"]})).one()
    payload = _j(row[3])
    assert (row[0], row[1], row[2]) == ("qa", world["reader"]["email"], "button")
    assert {e["kind"] for e in payload["evidence"]} == {"doc", "source"} and payload["outcome"] == "solved"
    assert world["reader"]["email"] not in json.dumps(payload, ensure_ascii=False)  # 질문자는 본문에 없다
    await _drain()
    plan = await _plan(first["id"])
    qa = plan["pages"][0]
    assert qa["kind"] == "qa" and qa["slug"].startswith("qa-") and qa["new"] is True

    second = (await _fileback(world["reader"], f"{NAME} 최대 응력은 얼마인가요", block="b1")).json()["data"]
    await _drain()
    plan2 = await _plan(second["id"])
    assert plan2["pages"][0]["slug"] == qa["slug"] and plan2["pages"][0]["new"] is False  # 비슷한 물음은 같은 문답 문서에
    async with session_scope() as s:
        content = _j((await s.execute(text("SELECT content_json FROM documents WHERE slug = :s"), {"s": qa["slug"]})).scalar_one())
    similar = next(sec for sec in content["sections"] if sec["title"] == "비슷한 질문")
    listed = json.dumps(similar["blocks"], ensure_ascii=False)
    assert f"{NAME} 최대 응력은 얼마인가" in listed and f"{NAME} 최대 응력은 얼마인가요" in listed


async def test_scope_is_never_wider_than_evidence(world: dict[str, Any]) -> None:
    narrow = f"ent-part-f{RUN}--syn-cae1"
    unseen = await _fileback(world["reader"], f"{NAME} 좁은 결과", slug=narrow, block="b9")
    wide = await _fileback(world["aff"], f"{NAME} 좁은 결과", slug=narrow, block="b9", aud=["org"])
    default = await _fileback(world["aff"], f"{NAME} 좁은 결과", slug=narrow, block="b9")
    mine = await _fileback(world["aff"], f"{NAME} 좁은 결과 나만", slug=narrow, block="b9", aud=[f"user:{world['aff']['id']}"])
    beyond = await _fileback(world["reader"], f"{NAME} 남의 범위", aud=["aff:SYN-CAE1"])
    assert unseen.status_code == 422  # 볼 수 없는 문서를 근거로 들지 못한다
    assert wide.status_code == 422 and wide.json()["error"]["details"]["required"] == ["aff:SYN-CAE1"]
    assert default.status_code == 201 and default.json()["data"]["audience"] == ["aff:SYN-CAE1"]
    assert mine.status_code == 201 and mine.json()["data"]["audience"] == [f"user:{world['aff']['id']}"]
    assert beyond.status_code == 403  # 가진 토큰 밖
