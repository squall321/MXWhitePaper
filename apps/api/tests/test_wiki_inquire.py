# 위키 지속 질의 시험 — 위키로 답(원천이 됨) · 질문의 범위로만 읽음 · 허용된 읽기 전용 도구 · 사람 · 실험 제안 · 되풀이 뒤 사람 · 예산 · 일정 · 사람의 답
"""docs/llm-wiki W7 — request §5-9 · CONTRACTS §2-7 · WK-D11. LLM 은 가짜 LLM 서버, 게이트웨이는 가짜 MCP(tests/fakes/fake_mcp.py)만 쓴다.

시계는 먼 날(2030)의 조용한 시간으로 옮긴다 — 문지기의 조용한 시간 · 하루 예산이 장부의 다른 줄과 섞이지 않게.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app
from app.search import meili_indexer
from app.wiki import audience, budget, inquire, jobs, pages, questions, schedule, sources, worker
from app.wiki import schema as wiki_schema
from app.wiki.envelope import SourceEnvelope
from tests.fakes.fake_mcp import FakeMCP

RUN = uuid4().hex[:8]
SUF = f"I{RUN}"
API = "/api/v1/wiki"
FIX = Path(__file__).parent / "fixtures" / "wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
NAME = f"힌지 브래킷 {SUF}"
KST = ZoneInfo("Asia/Seoul")
NIGHT = datetime(2030, 1, 1, 23, 0, tzinfo=KST)
AFF = ["aff:SYN-CAE1"]


def _env(name: str) -> dict[str, Any]:
    env = json.loads(next((FIX / "sources").glob(f"{name}*.json")).read_text(encoding="utf-8"))
    env["origin"]["ref"] = f"w7-inq-{RUN}-{env['origin']['ref']}"
    for hint in env.get("subject_hints") or []:
        hint["name"] = f"{hint['name']} {SUF}"
        hint["ext"] = {k: f"{v}-{RUN}" for k, v in (hint.get("ext") or {}).items()}
    return env


async def _user(s: Any, name: str, role: str, *, aff: str | None = None, plat: list[str] | None = None,
                reviewer: bool = False) -> dict[str, Any]:
    uid = str(uuid4())
    email = f"w7-inq-{RUN}-{name}@example.com"
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at, wiki_reviewer)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at, :rv)
    """), {"id": uid, "e": email, "n": f"W7 {name}", "pw": hash_password("x" * 16), "r": role, "a": aff, "p": plat,
           "at": datetime.now(UTC) if (aff or plat) else None, "rv": reviewer})
    return {"id": uid, "email": email, "role": role, "portal_affiliation": aff, "portal_plat": plat,
            "portal_access_at": datetime.now(UTC).isoformat() if (aff or plat) else None,
            "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


async def _page(s: Any, slug: str, title: str, aud: list[str], entity: str, block: str, body: str, source: str) -> str:
    owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
    content = pages.skeleton(wiki_schema.DEFAULT, slug=slug, type_key="part", title=title, summary="", owners=[],
                             division=BASE["metadata"]["division"])
    content["metadata"] = BASE["metadata"]
    content["sections"][0]["blocks"] = [{"type": "paragraph", "id": block, "text": body}]
    doc = str((await s.execute(text("""
        INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
        VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o) RETURNING id
    """), {"slug": slug, "t": title, "c": json.dumps(content, ensure_ascii=False), "o": owner})).scalar_one())
    await s.execute(text("""
        INSERT INTO wiki_pages (doc_id, kind, managed, audience, entity_id) VALUES (CAST(:d AS uuid), 'entity', 'ai',
               CAST(:a AS text[]), CAST(:e AS uuid))
    """), {"d": doc, "a": aud, "e": entity})
    await s.execute(text("""
        INSERT INTO wiki_citations (doc_id, block_id, source_id, locator) VALUES (CAST(:d AS uuid), :b, CAST(:s AS uuid), '{}')
    """), {"d": doc, "b": block, "s": source})
    return doc


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch, fake_llm: Any) -> Any:
    st = get_settings()
    for key, value in (("wiki_enabled", True), ("wiki_llm_base_url", fake_llm.base_url), ("wiki_llm_model", fake_llm.model),
                       ("wiki_llm_api_key", ""), ("wiki_llm_structured", "json_schema"), ("wiki_query_llm_base_url", ""),
                       ("wiki_query_llm_model", ""), ("wiki_tools_url", ""), ("wiki_tools_token", "")):
        monkeypatch.setattr(st, key, value)
    monkeypatch.setattr(budget, "now", lambda: NIGHT)
    audience.set_viewer(audience.SYSTEM)
    w: dict[str, Any] = {"llm": fake_llm}
    async with session_scope() as s:
        w["admin"] = await _user(s, "admin", "admin")
        w["reviewer"] = await _user(s, "reviewer", "editor", aff="SYN-CAE1", plat=["plat:plmdefect"], reviewer=True)
        w["asker"] = await _user(s, "asker", "editor", aff="SYN-CAE1")
        w["reader"] = await _user(s, "reader", "reader")
    src: dict[str, str] = {}
    for n in ("02", "03"):
        async with session_scope() as s:
            src[n] = (await sources.receive(s, SourceEnvelope.model_validate(_env(n)), caller=w["admin"], ingest=False)).id
    w["src"] = src
    async with session_scope() as s:
        ent = str((await s.execute(text("""
            INSERT INTO wiki_entities (type_key, canonical_name, audience) VALUES ('part', :n, ARRAY['org']) RETURNING id
        """), {"n": NAME})).scalar_one())
        w["entity"] = ent
        await _page(s, f"ent-part-i{RUN}", NAME, ["org"], ent, pages.new_id(), "리브 추가안의 최대 응력은 338 MPa 다.", src["03"])
        await _page(s, f"ent-part-i{RUN}--syn-cae1", f"{NAME} (aff:SYN-CAE1)", AFF, ent, pages.new_id(),
                    "소속 해석의 최대 응력은 405 MPa 다.", src["02"])
    yield w
    audience.set_viewer(audience.SYSTEM)
    await _cleanup()


async def _cleanup() -> None:
    async with session_scope() as s:
        qs = [str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM wiki_questions WHERE text LIKE :t"), {"t": f"%{SUF}%"})).all()]
        refs = [f"wiki-inquiry/{q}" for q in qs] + [f"wiki-question/{q}" for q in qs]
        srcs = [str(r[0]) for r in (await s.execute(text("""
            SELECT id FROM wiki_sources WHERE origin_ref LIKE :p OR origin_ref = ANY(:refs)
        """), {"p": f"w7-inq-{RUN}-%", "refs": refs})).all()]
        cs = [str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM wiki_changesets WHERE plan ->> 'source_id' = ANY(:s)"), {"s": srcs})).all()]
        docs = [str(r[0]) for r in (await s.execute(text("""
            SELECT id FROM documents WHERE slug LIKE :p OR id IN (SELECT doc_id FROM wiki_sources WHERE id = ANY(CAST(:s AS uuid[])))
               OR id IN (SELECT doc_id FROM wiki_citations WHERE source_id = ANY(CAST(:s AS uuid[])))
        """), {"p": f"%i{RUN}%", "s": srcs})).all()]
        await s.execute(text("""
            DELETE FROM wiki_jobs WHERE args ->> 'question_id' = ANY(:q) OR args ->> 'source_id' = ANY(:s)
               OR args ->> 'changeset_id' = ANY(:cs)
        """), {"q": qs, "s": srcs, "cs": cs})
        await s.execute(text("DELETE FROM notifications WHERE kind = 'wiki_question' AND payload ->> 'question_id' = ANY(:q)"),
                        {"q": qs})
        await s.execute(text("DELETE FROM wiki_citations WHERE source_id = ANY(CAST(:s AS uuid[])) OR doc_id = ANY(CAST(:d AS uuid[]))"),
                        {"s": srcs, "d": docs})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("""
            DELETE FROM wiki_log WHERE title LIKE :t OR changeset_id = ANY(CAST(:cs AS uuid[]))
               OR title LIKE ANY(:st)
        """), {"t": f"%{SUF}%", "cs": cs, "st": [f"%({sources.short_id(i)})" for i in srcs]})
        await s.execute(text("DELETE FROM wiki_changesets WHERE id = ANY(CAST(:cs AS uuid[]))"), {"cs": cs})
        await s.execute(text("DELETE FROM wiki_questions WHERE id = ANY(CAST(:q AS uuid[]))"), {"q": qs})
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[]))"), {"d": docs})
        await s.execute(text("DELETE FROM wiki_entities WHERE canonical_name LIKE :n"), {"n": f"%{SUF}"})
        await s.execute(text("DELETE FROM wiki_sources WHERE id = ANY(CAST(:s AS uuid[]))"), {"s": srcs})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w7-inq-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w7-inq-{RUN}-%"})
    for doc_id in docs:
        meili_indexer.delete_document(doc_id)


async def _ask(w: dict[str, Any], body: str, aud: list[str], *, origin: str = "user", who: str = "asker") -> str:
    async with session_scope() as s:
        got = await questions.add(s, body, origin=origin, user=w[who], aud=aud)
    return got["id"]


async def _inquire(qid: str) -> dict[str, Any]:
    async with session_scope() as s:
        return await inquire.run(s, jobs.Job(id=str(uuid4()), op="inquire", args={"question_id": qid}))


async def _question(qid: str) -> dict[str, Any]:
    async with session_scope() as s:
        row = (await s.execute(text("""
            SELECT status, attempts, detail, answer_source_id FROM wiki_questions WHERE id = CAST(:i AS uuid)
        """), {"i": qid})).one()
    return {"status": row[0], "attempts": row[1], "detail": row[2] if isinstance(row[2], dict) else json.loads(row[2]),
            "answer_source_id": str(row[3]) if row[3] else None}


def _reply(**json_: Any) -> dict[str, Any]:
    return {"match": {"schema": "wiki_inquire"}, "reply": {"json": {"why": "시험", **json_},
                                                           "usage": {"prompt_tokens": 900, "completion_tokens": 60}}}


def _prompt(w: dict[str, Any]) -> str:
    return next(c for c in reversed(w["llm"].calls) if c["body"].get("response_format", {}).get(
        "json_schema", {}).get("name") == "wiki_inquire")["body"]["messages"][-1]["content"]


async def test_wiki_answer_becomes_a_source_in_the_question_scope(world: dict[str, Any]) -> None:
    world["llm"].load({"rules": [_reply(action="answer", answer="리브 추가안의 최대 응력은 338 MPa 다 [1].", cited=[1],
                                        confidence=0.9)]})
    qid = await _ask(world, f"{NAME} 리브 추가안의 응력은 얼마인가", ["org"])
    out = await _inquire(qid)
    assert out["action"] == "answer"
    prompt = _prompt(world)
    assert "338 MPa" in prompt and "405" not in prompt  # 전사 질문은 소속 문서를 읽지 않는다
    q = await _question(qid)
    assert q["status"] == "answered" and q["attempts"] == 1 and q["detail"]["confidence"] == 0.9
    async with session_scope() as s:
        kind, aud, via, payload, owner, ingest = (await s.execute(text("""
            SELECT ws.kind, ws.audience, ws.via, ws.payload, ws.owner_email,
                   (SELECT COUNT(*) FROM wiki_jobs j WHERE j.op = 'ingest' AND j.args ->> 'source_id' = CAST(ws.id AS text))
              FROM wiki_sources ws WHERE ws.id = CAST(:i AS uuid)
        """), {"i": q["answer_source_id"]})).one()
        logged = (await s.execute(text("SELECT detail FROM wiki_log WHERE op = 'inquire' AND title LIKE :t"),
                                  {"t": f"{NAME} 리브%"})).scalar_one()
    payload = payload if isinstance(payload, dict) else json.loads(payload)
    assert (kind, list(aud), via, ingest) == ("inquiry_answer", ["org"], "inquiry", 1)
    assert payload["answer"].endswith("[1].") and payload["evidence"][0]["kind"] == "doc"
    assert {"kind": "source", "ref": sources.short_id(world["src"]["03"])}.items() <= next(
        e for e in payload["evidence"] if e["kind"] == "source").items()
    assert owner == (await _admin_email())
    assert (logged if isinstance(logged, dict) else json.loads(logged))["결과"] == "답"

    # 소속 질문은 소속 문서도 읽는다
    world["llm"].load({"rules": [_reply(action="answer", answer="소속 해석은 405 MPa 다 [2].", cited=[2], confidence=0.8)]})
    qid2 = await _ask(world, f"{NAME} 소속 해석 응력은", AFF)
    await _inquire(qid2)
    assert "405 MPa" in _prompt(world)
    async with session_scope() as s:
        aud2 = (await s.execute(text("""
            SELECT ws.audience FROM wiki_sources ws JOIN wiki_questions q ON q.answer_source_id = ws.id WHERE q.id = CAST(:i AS uuid)
        """), {"i": qid2})).scalar_one()
    assert list(aud2) == AFF


async def _admin_email() -> str:
    async with session_scope() as s:
        return str((await s.execute(text(
            "SELECT email FROM users WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1"))).scalar_one())


async def test_ungrounded_answer_is_unknown_and_retries_until_a_person(world: dict[str, Any]) -> None:
    world["llm"].load({"rules": [_reply(action="answer", answer="아마 300 MPa 쯤일 것이다.", cited=[], confidence=0.4)]})
    qid = await _ask(world, f"{NAME} 근거 없이 답할 물음", ["org"], origin="query_miss")
    await _inquire(qid)
    q = await _question(qid)
    assert (q["status"], q["attempts"]) == ("open", 1) and "근거 번호도 도구 결과도 없는 답" in q["detail"]["last_try"]["why"]
    world["llm"].load({"rules": [_reply(action="unknown")]})
    await _inquire(qid)
    await _inquire(qid)  # 규칙서 max_asks_per_question 3
    q = await _question(qid)
    assert (q["status"], q["attempts"]) == ("needs_human", 3) and "3번 물어도" in q["detail"]["why"]
    async with session_scope() as s:
        notified = {str(r[0]) for r in (await s.execute(text("""
            SELECT user_id FROM notifications WHERE kind = 'wiki_question' AND payload ->> 'question_id' = :q
        """), {"q": qid})).all()}
    assert world["asker"]["id"] in notified  # 물은 사람 — 전사 물음이라 검토자도
    assert world["reviewer"]["id"] in notified and world["reader"]["id"] not in notified


async def test_needs_human_and_experiment_are_kept_with_reasons(world: dict[str, Any]) -> None:
    world["llm"].load({"rules": [_reply(action="needs_experiment", proposal="리브 두께 0.4 mm 로 1.5 m 낙하를 다시 본다.")]})
    exp = await _ask(world, f"{NAME} 리브가 더 얇아도 되나", AFF, origin="lint", who="admin")
    await _inquire(exp)
    q = await _question(exp)
    assert q["status"] == "needs_experiment" and q["detail"]["proposal"].startswith("리브 두께")
    world["llm"].load({"rules": [_reply(action="needs_human", why="시험 일정은 담당만 안다")]})
    mine = await _ask(world, f"{NAME} 시험 일정은", [f"user:{world['asker']['id']}"])
    await _inquire(mine)
    q = await _question(mine)
    assert q["status"] == "needs_human" and q["detail"]["why"] == "시험 일정은 담당만 안다"
    async with session_scope() as s:
        notified = {str(r[0]) for r in (await s.execute(text("""
            SELECT user_id FROM notifications WHERE kind = 'wiki_question' AND payload ->> 'question_id' = :q
        """), {"q": mine})).all()}
    assert notified == {world["asker"]["id"]}  # 혼자만 보는 물음은 물은 사람에게만


def _book(**inquiry: Any) -> wiki_schema.RuleBook:
    spec = wiki_schema.DEFAULT.spec
    budget_ = spec.budget.model_copy(update=inquiry.pop("budget", {}))
    return wiki_schema.RuleBook(version=0, spec=spec.model_copy(update={
        "inquiry": wiki_schema.Inquiry.model_validate(inquiry) if inquiry else spec.inquiry, "budget": budget_}))


@pytest.mark.parametrize("sse", [False, True])
async def test_tool_step_offers_only_allowlisted_read_only_tools(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch,
                                                                 sse: bool) -> None:
    book = _book(tools_allowlist=["plm_search", {"name": "secret_tool", "audience": ["plat:plmdefect"]}, "write_tool"])

    async def load(_s: Any) -> wiki_schema.RuleBook:
        return book

    monkeypatch.setattr(wiki_schema, "load", load)
    ro = {"readOnlyHint": True}
    gateway = [
        {"name": "plm_search", "description": "시장 불량 찾기", "inputSchema": {"type": "object"}, "annotations": ro,
         "result": lambda a: f"'{a.get('q')}' 시장 사례 3건 — SYN-PLM-9001 · 9002 · 9003"},
        {"name": "secret_tool", "description": "좁은 도구", "inputSchema": {"type": "object"}, "annotations": ro, "result": "비밀"},
        {"name": "write_tool", "description": "쓰기", "inputSchema": {"type": "object"}, "annotations": {}, "result": "x"},
        {"name": "unlisted_tool", "description": "목록 밖", "inputSchema": {"type": "object"}, "annotations": ro, "result": "x"},
    ]
    with FakeMCP(gateway, token=f"pat-{RUN}", sse=sse) as mcp:
        monkeypatch.setattr(get_settings(), "wiki_tools_url", mcp.url)
        monkeypatch.setattr(get_settings(), "wiki_tools_token", f"pat-{RUN}")
        world["llm"].load({"rules": [
            {**_reply(action="call_tool", tool="plm_search", args={"q": "힌지"}), "times": 1},
            _reply(action="answer", answer="시장 사례는 3건이다.", cited=[], confidence=0.7)]})
        qid = await _ask(world, f"{NAME} 시장 사례는 몇 건인가", ["org"])
        out = await _inquire(qid)
        calls = list(mcp.calls)
    assert out["action"] == "answer"
    first = next(c for c in world["llm"].calls if c["rule"] == 0)["body"]["messages"][-1]["content"]
    assert "plm_search" in first and "secret_tool" not in first and "write_tool" not in first and "unlisted_tool" not in first
    assert [m for m, _ in calls] == ["initialize", "notifications/initialized", "tools/list", "tools/call"]
    assert calls[-1][1] == {"name": "plm_search", "arguments": {"q": "힌지"}}
    q = await _question(qid)
    async with session_scope() as s:
        payload = (await s.execute(text("SELECT payload FROM wiki_sources WHERE id = CAST(:i AS uuid)"),
                                   {"i": q["answer_source_id"]})).scalar_one()
    payload = payload if isinstance(payload, dict) else json.loads(payload)
    assert payload["tool_calls"][0]["tool"] == "plm_search" and "3건" in payload["tool_calls"][0]["result_excerpt"]


async def test_question_budget_holds_the_job(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    book = _book(budget={"inquiry_tokens": 500})

    async def load(_s: Any) -> wiki_schema.RuleBook:
        return book

    monkeypatch.setattr(wiki_schema, "load", load)
    world["llm"].load({"rules": [_reply(action="unknown")]})  # 쓴 양 960 > 500
    qid = await _ask(world, f"{NAME} 예산을 넘는 물음", ["org"])
    async with session_scope() as s:
        job_id = await jobs.enqueue(s, "inquire", {"question_id": qid})
    assert await worker.run_once(f"test-inq-{RUN}", ops=["inquire"]) is True
    async with session_scope() as s:
        state = (await s.execute(text("SELECT state FROM wiki_jobs WHERE id = CAST(:i AS uuid)"), {"i": job_id})).scalar_one()
    q = await _question(qid)
    assert state == "held" and q["status"] == "needs_human" and "질문 예산" in q["detail"]["why"]


async def test_inquiry_waits_for_quiet_hours(world: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(budget, "now", lambda: datetime(2030, 1, 2, 10, 0, tzinfo=KST))
    qid = await _ask(world, f"{NAME} 낮에 줄 선 물음", ["org"])
    async with session_scope() as s:
        job_id = await jobs.enqueue(s, "inquire", {"question_id": qid})
    assert await worker.run_once(f"test-inq-{RUN}", ops=["inquire"]) is True
    async with session_scope() as s:
        state, error = (await s.execute(text("SELECT state, error FROM wiki_jobs WHERE id = CAST(:i AS uuid)"),
                                        {"i": job_id})).one()
    assert state == "queued" and "조용한 시간" in error and (await _question(qid))["status"] == "open"


async def test_schedule_queues_nightly_lint_standing_questions_and_inquiries(world: dict[str, Any],
                                                                             monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(budget, "now", lambda: datetime(2030, 1, 1, 2, 30, tzinfo=KST))
    async with session_scope() as s:
        await s.execute(text("DELETE FROM wiki_schedule"))
    first: dict[str, Any] = {}
    try:
        async with session_scope() as s:
            first = await schedule.tick(s)
        async with session_scope() as s:
            again = await schedule.tick(s)
            lint_args = (await s.execute(text("SELECT args FROM wiki_jobs WHERE id = CAST(:i AS uuid)"),
                                         {"i": first["lint"]})).scalar_one()
            standing = {r[0]: list(r[1]) for r in (await s.execute(text("""
                SELECT text, audience FROM wiki_questions WHERE origin = 'standing' AND text LIKE :t
            """), {"t": f"{NAME}%"})).all()}
            queued = (await s.execute(text("""
                SELECT COUNT(*) FROM wiki_jobs j JOIN wiki_questions q ON CAST(q.id AS text) = j.args ->> 'question_id'
                 WHERE j.op = 'inquire' AND q.text LIKE :t
            """), {"t": f"{NAME}%"})).scalar_one()
        assert (lint_args if isinstance(lint_args, dict) else json.loads(lint_args)) == {"scope": "full", "llm": True}
        part_q = wiki_schema.DEFAULT.spec.standing_questions[1].text
        assert standing == {f"{NAME}: {part_q}": ["org"], f"{NAME} (aff:SYN-CAE1): {part_q}": AFF}  # 문서(범위)마다 하나
        assert first["standing"]["added"] >= 2 and first["inquire"] >= 1 and queued >= 1
        assert again == {}  # 같은 날 · 한 시간 안에는 다시 줄 세우지 않는다
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM wiki_jobs WHERE id = CAST(:i AS uuid) OR (op = 'inquire' AND args ->> 'question_id' IN "
                                 "(SELECT CAST(id AS text) FROM wiki_questions WHERE origin = 'standing'))"),
                            {"i": first.get("lint")})
            await s.execute(text("DELETE FROM wiki_questions WHERE origin = 'standing' AND text LIKE :t"), {"t": f"{NAME}%"})
            await s.execute(text("DELETE FROM wiki_schedule"))


async def test_ingest_plan_questions_join_the_queue(world: dict[str, Any]) -> None:
    world["llm"].load({"rules": [
        {"match": {"schema": "wiki_plan"}, "reply": {
            "json": {"summary": "{{summary}}", "pages": [{"slug": "{{cand}}", "why": "담는다."}],
                     "questions": [f"리브 두께 기준은 무엇인가 {SUF}"], "contradictions": [f"앞 해석과 응력이 다르다 {SUF}"]},
            "capture": {"cand": "후보: ([a-z0-9-]+)", "summary": "\\n요약: ([^\\n]*)"}}},
        {"match": {"schema": "wiki_write"}, "reply": {"json": {"ops": []}}},
        {"match": {"schema": "wiki_resolve"}, "reply": {"json": {"choices": []}}}]})
    env = _env("03")
    env["origin"]["ref"] += "-plan"
    async with session_scope() as s:
        sid = (await sources.receive(s, SourceEnvelope.model_validate(env), caller=world["admin"])).id
    assert await worker.run_once(f"test-inq-{RUN}", ops=["ingest"]) is True
    async with session_scope() as s:
        rows = {r[0]: (r[1], list(r[2]), r[3]) for r in (await s.execute(text("""
            SELECT text, origin, audience, priority FROM wiki_questions WHERE text LIKE :t
        """), {"t": f"%{SUF}"})).all()}
        cs = (await s.execute(text("SELECT id FROM wiki_changesets WHERE plan ->> 'source_id' = :i"), {"i": sid})).scalar_one()
        ref = (await s.execute(text("SELECT origin_ref FROM wiki_questions WHERE text = :t"),
                               {"t": f"리브 두께 기준은 무엇인가 {SUF}"})).scalar_one()
    assert rows == {f"리브 두께 기준은 무엇인가 {SUF}": ("ingest", ["org"], 3), f"앞 해석과 응력이 다르다 {SUF}": ("ingest", ["org"], 2)}
    assert ref == f"ingest:{cs}"


async def test_people_answer_and_manage_questions(world: dict[str, Any]) -> None:
    narrow = await _ask(world, f"{NAME} 소속 담당의 답이 필요한 물음", AFF)
    wide = await _ask(world, f"{NAME} 전사 물음", ["org"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        h = {k: world[k]["headers"] for k in ("asker", "reader", "reviewer")}
        assert (await c.post(f"{API}/questions/{narrow}/answer", json={"answer": "담당이 정리했다."}, headers=h["reader"])).status_code == 403
        got = await c.post(f"{API}/questions/{narrow}/answer", json={"answer": "체결부 모서리부터 금이 간다.", "confidence": 0.9},
                           headers=h["asker"])
        assert got.status_code == 201, got.text
        assert (await c.post(f"{API}/questions/{wide}/answer", json={"answer": "전사 답."}, headers=h["asker"])).status_code == 403
        assert (await c.post(f"{API}/questions/{wide}/answer", json={"answer": "전사 답이다."},
                             headers=h["reviewer"])).status_code == 201
        one = (await c.get(f"{API}/questions/{narrow}", headers=h["asker"])).json()["data"]
        hidden = await c.get(f"{API}/questions/{narrow}", headers=h["reader"])
        mine = await _ask(world, f"{NAME} 내가 닫을 물음", ["org"])
        closed = await c.patch(f"{API}/questions/{mine}", json={"status": "closed"}, headers=h["asker"])
        denied = await c.patch(f"{API}/questions/{mine}", json={"status": "open"}, headers=h["reader"])
        reopened = await c.patch(f"{API}/questions/{mine}", json={"status": "open", "priority": 2}, headers=h["reviewer"])
    data = got.json()["data"]
    assert data["status"] == "answered" and data["source"]["short"].startswith("src_")
    assert one["answer_source"]["id"] == data["source"]["id"] and hidden.status_code == 404
    assert closed.json()["data"]["status"] == "closed" and denied.status_code == 403
    assert reopened.json()["data"]["status"] == "open" and reopened.json()["data"]["priority"] == 2
    async with session_scope() as s:
        owner, aud, kind = (await s.execute(text("SELECT owner_email, audience, kind FROM wiki_sources WHERE id = CAST(:i AS uuid)"),
                                            {"i": data["source"]["id"]})).one()
    assert (owner, list(aud), kind) == (world["asker"]["email"], AFF, "inquiry_answer")
