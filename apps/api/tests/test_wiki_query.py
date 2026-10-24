# 위키 묻기 시험 — SSE 프레임 · [n] 각주 · 좁은 문서는 넓은 사람의 프롬프트에 없음 · MISS · 문서가 없으면 LLM 을 안 부름 · LLM 없음 · 질문 남기기
"""docs/llm-wiki W6 — request §5-7 · CONTRACTS §6 `POST /query` · §2-7 질문. 묻기 LLM 은 가짜 LLM 서버(스트리밍)만 쓴다."""
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
from app.wiki import audience, query, sources
from app.wiki.envelope import SourceEnvelope

RUN = uuid4().hex[:8]
API = "/api/v1/wiki"
FIX = Path(__file__).parent / "fixtures" / "wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
NAME = f"힌지 브래킷 Q{RUN}"
ANSWER = "균열은 체결부 모서리에서 시작한다 [2]. 최대 응력은 412 MPa 다 [1]."


async def _user(s: Any, name: str, role: str, *, aff: str | None = None) -> dict[str, Any]:
    uid = str(uuid4())
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at)
    """), {"id": uid, "e": f"w6-q-{RUN}-{name}@example.com", "n": f"W6 {name}", "pw": hash_password("x" * 16), "r": role,
           "a": aff, "p": [] if aff else None, "at": datetime.now(UTC) if aff else None})
    return {"id": uid, "role": role, "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


def _content(slug: str, title: str, blocks: list[tuple[str, str, str]]) -> dict[str, Any]:
    secs: dict[str, list[dict[str, Any]]] = {}
    for sec, bid, body in blocks:
        secs.setdefault(sec, []).append({"type": "paragraph", "id": bid, "text": body})
    return {**BASE, "slug": slug, "title": title, "sections": [{"id": f"s{i}", "title": t, "blocks": b}
                                                               for i, (t, b) in enumerate(secs.items())]}


async def _page(s: Any, slug: str, aud: list[str], entity: str, blocks: list[tuple[str, str, str]]) -> str:
    owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
    title = NAME if aud == ["org"] else f"{NAME} ({aud[0]})"
    doc_id = str((await s.execute(text("""
        INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
        VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o) RETURNING id
    """), {"slug": slug, "t": title, "c": json.dumps(_content(slug, title, blocks), ensure_ascii=False), "o": owner})).scalar_one())
    await s.execute(text("""
        INSERT INTO wiki_pages (doc_id, kind, managed, audience, entity_id) VALUES (:d, 'entity', 'ai', CAST(:a AS text[]), CAST(:e AS uuid))
    """), {"d": doc_id, "a": aud, "e": entity})
    return doc_id


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch, fake_llm: Any) -> Any:
    st = get_settings()
    for key, value in (("wiki_enabled", True), ("wiki_llm_base_url", ""), ("wiki_llm_model", ""),
                       ("wiki_query_llm_base_url", fake_llm.base_url), ("wiki_query_llm_model", fake_llm.model)):
        monkeypatch.setattr(st, key, value)
    fake_llm.load({"rules": [{"match": {"contains": "물음:"}, "reply": {"text": ANSWER, "chunk_chars": 7}}]})
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        w = {"llm": fake_llm, "reader": await _user(s, "reader", "reader"), "aff": await _user(s, "aff", "reader", aff="SYN-CAE1"),
             "admin": await _user(s, "admin", "admin")}
        env = json.loads((FIX / "sources" / "03-sim-stcx-job0002-rib.json").read_text(encoding="utf-8"))
        env["origin"]["ref"] = f"w6-q-{RUN}"
        src = await sources.receive(s, SourceEnvelope.model_validate(env), caller=w["admin"], ingest=False)
        w["src"] = src.id
    async with session_scope() as s:
        ent = str((await s.execute(text("""
            INSERT INTO wiki_entities (type_key, canonical_name, audience) VALUES ('part', :n, ARRAY['org']) RETURNING id
        """), {"n": NAME})).scalar_one())
        doc = await _page(s, f"ent-part-q{RUN}", ["org"], ent, [
            ("요약", f"q{RUN}b1", "힌지 브래킷의 최대 응력은 412 MPa 다."),
            ("해석에서", f"q{RUN}b2", "1.5 m 전각도 낙하에서 균열이 체결부 모서리에서 시작한다."),
            ("원천", f"q{RUN}b3", "자동 절 — 근거로 쓰지 않는다.")])
        await _page(s, f"ent-part-q{RUN}--syn-cae1", ["aff:SYN-CAE1"], ent, [("요약", f"q{RUN}b9", "좁은 결과는 777 MPa 다.")])
        await s.execute(text("""
            INSERT INTO wiki_citations (doc_id, block_id, source_id, locator) VALUES (CAST(:d AS uuid), :b, CAST(:src AS uuid), '{}')
        """), {"d": doc, "b": f"q{RUN}b1", "src": w["src"]})
    yield w
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        src_doc = (await s.execute(text("SELECT doc_id FROM wiki_sources WHERE id = CAST(:i AS uuid)"), {"i": w["src"]})).scalar()
        await s.execute(text("DELETE FROM wiki_citations WHERE source_id = CAST(:i AS uuid)"), {"i": w["src"]})
        await s.execute(text("DELETE FROM documents WHERE slug LIKE :p OR id = :d"), {"p": f"ent-part-q{RUN}%", "d": src_doc})
        await s.execute(text("DELETE FROM wiki_entities WHERE canonical_name = :n"), {"n": NAME})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE actor IN (SELECT 'user:' || id FROM users WHERE email LIKE :e)"),
                        {"e": f"w6-q-{RUN}-%"})
        await s.execute(text("DELETE FROM wiki_questions WHERE created_by IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w6-q-{RUN}-%"})
        await s.execute(text("DELETE FROM wiki_sources WHERE id = CAST(:i AS uuid)"), {"i": w["src"]})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w6-q-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w6-q-{RUN}-%"})
    if src_doc:
        meili_indexer.delete_document(str(src_doc))


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _frames(raw: str) -> list[tuple[str, dict[str, Any]]]:
    out = []
    for chunk in raw.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in chunk.splitlines() if ": " in line)
        out.append((lines["event"], json.loads(lines["data"])))
    return out


async def _ask(who: dict[str, Any], question: str) -> list[tuple[str, dict[str, Any]]]:
    async with _client() as c:
        r = await c.post(f"{API}/query", headers=who["headers"], json={"messages": [{"role": "user", "content": question}]})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream"), r.text
    return _frames(r.text)


async def test_answer_streams_with_citations(world: dict[str, Any]) -> None:
    frames = await _ask(world["reader"], f"{NAME} 균열은 어디서 시작하나")
    kinds = [k for k, _ in frames]
    assert kinds[:6] == ["tool_call", "tool_result"] * 3 and kinds[-1] == "done"
    assert "".join(d["text"] for k, d in frames if k == "token") == ANSWER
    assert sum(1 for k in kinds if k == "token") > 3  # 조각으로 흘렀다
    cites = [d for k, d in frames if k == "citation"]
    assert [(c["n"], c["slug"]) for c in cites] == [(1, f"ent-part-q{RUN}"), (2, f"ent-part-q{RUN}")]
    assert cites[0]["sources"][0]["source_id"] == world["src"] and cites[1]["sources"] == []
    done = frames[-1][1]
    assert done["miss"] is False and done["cited"] == 2 and done["pages"] == [f"ent-part-q{RUN}"]
    prompt = world["llm"].calls[-1]["body"]["messages"][-1]["content"]
    assert "412 MPa" in prompt and "777" not in prompt and "자동 절" not in prompt  # 좁은 문서 · 자동 절은 근거가 아니다
    assert world["llm"].calls[-1]["body"]["stream"] is True


async def test_narrow_reader_sees_narrow_page(world: dict[str, Any]) -> None:
    frames = await _ask(world["aff"], f"{NAME} 최대 응력")
    assert frames[-1][1]["pages"] == [f"ent-part-q{RUN}", f"ent-part-q{RUN}--syn-cae1"]
    assert "777 MPa" in world["llm"].calls[-1]["body"]["messages"][-1]["content"]


async def test_miss_and_questions(world: dict[str, Any]) -> None:
    world["llm"].load({"rules": [{"match": {"contains": "물음:"}, "reply": {"text": f"{query.MISS}\n배터리 이야기는 없다."}}]})
    frames = await _ask(world["reader"], f"{NAME} 배터리는 어떤가")
    assert ("miss", {"question": f"{NAME} 배터리는 어떤가", "question_id": None}) in frames  # 화면이 남길지 묻는다
    assert frames[-1][1]["miss"] is True and not [d for k, d in frames if k == "citation"]
    body = {"text": f"{NAME} 배터리는 어떤가", "origin": "query_miss"}
    async with _client() as c:
        first = await c.post(f"{API}/questions", headers=world["reader"]["headers"], json=body)
        again = await c.post(f"{API}/questions", headers=world["reader"]["headers"], json={**body, "text": f"{NAME}  배터리는 어떤가?"})
        wide = await c.post(f"{API}/questions", headers=world["reader"]["headers"], json={**body, "audience": ["aff:SYN-CAE1"]})
        mine = (await c.get(f"{API}/questions", headers=world["reader"]["headers"])).json()["data"]
        other = (await c.get(f"{API}/questions", headers=world["aff"]["headers"])).json()["data"]
    assert first.status_code == 201 and first.json()["data"]["created"] is True
    assert again.json()["data"]["id"] == first.json()["data"]["id"] and again.json()["data"]["asked_count"] == 2
    assert wide.status_code == 403  # 가진 토큰 밖의 범위로는 못 남긴다
    assert [q["id"] for q in mine if q["mine"]] == [first.json()["data"]["id"]]
    assert first.json()["data"]["id"] not in {q["id"] for q in other}  # 물은 사람만 본다


async def test_no_pages_means_no_llm_call(world: dict[str, Any]) -> None:
    frames = await _ask(world["reader"], f"전혀 없는 낱말 Z{RUN}")
    assert frames[-1][1]["miss"] is True and world["llm"].calls == []


async def test_without_query_llm(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "wiki_query_llm_base_url", "")
    frames = await _ask(world["reader"], f"{NAME} 균열은 어디서 시작하나")
    assert frames[-1][1]["llm"] == "unset" and "설정되지 않았다" in frames[-2][1]["text"]


async def test_file_question_on_miss(world: dict[str, Any]) -> None:
    world["llm"].load({"rules": [{"match": {"contains": "물음:"}, "reply": {"text": query.MISS}}]})
    async with session_scope() as s:
        with audience.acting_as(audience.viewer_from_user({"id": world["reader"]["id"], "role": "reader"})):
            frames = [f async for f in query.run(s, user={"id": world["reader"]["id"], "role": "reader"},
                                                 messages=[{"role": "user", "content": f"{NAME} 재료는?"}], file_question=True)]
        qid = json.loads(frames[-1].split("data: ", 1)[1])["question_id"]
        row = (await s.execute(text("SELECT origin, audience FROM wiki_questions WHERE id = CAST(:i AS uuid)"), {"i": qid})).one()
    assert row[0] == "query_miss" and list(row[1]) == [f"user:{world['reader']['id']}"]


async def test_llm_error_closes_the_stream(world: dict[str, Any]) -> None:
    world["llm"].load({"rules": [{"match": {"contains": "물음:"}, "reply": {"error": {"status": 503, "message": "busy"}}}]})
    frames = await _ask(world["reader"], f"{NAME} 균열은 어디서 시작하나")
    assert [k for k, _ in frames][-2:] == ["error", "done"] and "503" in frames[-2][1]["message"]


async def test_search_and_ask_json(world: dict[str, Any]) -> None:
    async with _client() as c:
        found = (await c.get(f"{API}/search", headers=world["reader"]["headers"], params={"q": f"{NAME} 균열"})).json()["data"]
        asked = (await c.post(f"{API}/ask", headers=world["reader"]["headers"], json={"question": f"{NAME} 균열은 어디서 시작하나"})).json()["data"]
        world["llm"].load({"rules": [{"match": {"contains": "물음:"}, "reply": {"text": query.MISS}}]})
        missed = (await c.post(f"{API}/ask", headers=world["reader"]["headers"], json={"question": f"{NAME} 무게는?"})).json()["data"]
    assert [(p["slug"], p["via"]) for p in found["pages"]] == [(f"ent-part-q{RUN}", "entity")]  # 좁은 문서는 없다
    assert [e["name"] for e in found["entities"]] == [NAME]
    assert asked["answer"] == ANSWER and [x["n"] for x in asked["citations"]] == [1, 2] and asked["miss"] is False
    assert asked["scope"] == ["org"]
    assert missed["miss"] is True and missed["question_id"]  # MCP 길은 질문을 바로 남긴다


async def test_done_carries_the_scope_of_what_was_read(world: dict[str, Any]) -> None:
    wide = (await _ask(world["reader"], f"{NAME} 균열은 어디서 시작하나"))[-1][1]
    narrow = (await _ask(world["aff"], f"{NAME} 최대 응력"))[-1][1]
    assert wide["scope"] == ["org"]
    assert narrow["cited"] == 2 and narrow["scope"] == ["aff:SYN-CAE1"]  # 각주는 전사 문서뿐이어도 좁은 문서를 읽었으면 그 범위


async def test_time_limit_closes_the_stream(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(query, "QUERY_TOTAL_S", 0.5)
    world["llm"].load({"rules": [{"match": {"contains": "물음:"},
                                  "reply": {"text": ANSWER, "chunk_chars": 4, "chunk_delay_s": 0.2}}]})
    frames = await _ask(world["reader"], f"{NAME} 균열은 어디서 시작하나")
    assert [k for k, _ in frames][-2:] == ["error", "done"] and "시간 제한" in frames[-2][1]["message"]
    assert frames[-1][1]["timeout"] is True and not [d for k, d in frames if k == "citation"]
    streamed = "".join(d["text"] for k, d in frames if k == "token")
    assert 0 < len(streamed) < len(ANSWER)  # 받은 데까지만
