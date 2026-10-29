# 위키 예산 시험 — 조용한 시간 · 하루 예산(미룸 · 기록) · 묻기 우선(느린 가짜 LLM 에서도 묻기가 앞선다) · LLM 동시 수 · 쓴 양 장부
"""docs/llm-wiki W7 완료 기준 '예산 상한을 지킨다 · 가짜 LLM 이 느릴 때도 묻기가 앞선다' — request §5-9 · §5-13 · CONTRACTS §8.

시각은 가짜 LLM 이 요청마다 남긴 도착 · 끝(time.monotonic)으로 견준다. 하루 예산은 먼 날(2030)로 시계를 옮겨 장부의 다른 줄과
섞이지 않게 한다.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
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
from app.wiki import audience, budget, jobs, sources, worker
from app.wiki import schema as wiki_schema
from app.wiki.envelope import SourceEnvelope

RUN = uuid4().hex[:8]
API = "/api/v1/wiki"
FIX = Path(__file__).parent / "fixtures" / "wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
KST = ZoneInfo("Asia/Seoul")
NAME = f"힌지 브래킷 B{RUN}"
ANSWER = "균열은 체결부 모서리에서 시작한다 [1]. 최대 응력은 412 MPa 다 [1]."


def _at(day: int, hh: int, mm: int = 0) -> datetime:
    return datetime(2030, 1, day, hh, mm, tzinfo=KST)


def test_quiet_hours_math() -> None:
    book = wiki_schema.DEFAULT  # 20:00-08:00
    assert not budget.in_quiet(book, _at(1, 10))
    assert budget.in_quiet(book, _at(1, 23)) and budget.in_quiet(book, _at(2, 7, 59))
    assert not budget.in_quiet(book, _at(2, 8))
    assert budget.next_quiet_start(book, _at(1, 10)) == _at(1, 20)
    assert budget.next_quiet_start(book, _at(1, 23)) == _at(1, 23)  # 이미 조용한 시간
    assert budget.next_quiet_start(book, _at(2, 8)) == _at(2, 20)
    assert budget.day_start(_at(1, 23, 30)) == _at(1, 0)
    assert budget.needs_quiet("inquire", {}) and budget.needs_quiet("lint", {"llm": True})
    assert not budget.needs_quiet("lint", {}) and not budget.needs_quiet("ingest", {})  # 들이기 · LLM 없는 점검은 언제나


@pytest.fixture
async def ledger() -> Any:
    """2030-01-01 의 장부 줄 — 시험이 넣고 끝에 지운다."""
    marks: list[int] = []

    async def spend(tokens: int, at: datetime) -> None:
        async with session_scope() as s:
            marks.append((await s.execute(text("""
                INSERT INTO wiki_llm_usage (at, role, tokens, name) VALUES (:at, 'background', :t, :n) RETURNING id
            """), {"at": at, "t": tokens, "n": f"test-{RUN}"})).scalar_one())

    yield spend
    async with session_scope() as s:
        await s.execute(text("DELETE FROM wiki_llm_usage WHERE id = ANY(:ids) OR name = :n"), {"ids": marks, "n": f"test-{RUN}"})


async def test_gate_quiet_hours_and_daily_cap(monkeypatch: pytest.MonkeyPatch, ledger: Any) -> None:
    monkeypatch.setattr(budget, "now", lambda: _at(1, 10))
    async with session_scope() as s:
        assert await budget.gate(s, "ingest", {}) is None  # 낮에도 들인다
        assert await budget.gate(s, "lint", {}) is None  # LLM 없는 점검은 언제나
        until, why = await budget.gate(s, "inquire", {})
        assert until == _at(1, 20) and "조용한 시간" in why
        until, _ = await budget.gate(s, "lint", {"llm": True})
        assert until == _at(1, 20)
    await ledger(wiki_schema.DEFAULT.spec.budget.daily_tokens, _at(1, 9))
    async with session_scope() as s:
        assert await budget.used_today(s, _at(1, 10)) == wiki_schema.DEFAULT.spec.budget.daily_tokens
        until, why = await budget.gate(s, "ingest", {})
        assert until == _at(2, 0) and why.startswith("하루 예산")
        until, _ = await budget.gate(s, "inquire", {})
        assert until == _at(2, 0)  # 다음 날 0시는 이미 조용한 시간
        assert await budget.gate(s, "lint", {}) is None  # LLM 을 안 쓰면 예산과 상관없다
        assert await budget.used_today(s, _at(2, 1)) == 0  # KST 하루가 바뀌면 새로


async def test_worker_defers_over_budget_without_spending_attempts(monkeypatch: pytest.MonkeyPatch, ledger: Any) -> None:
    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    monkeypatch.setattr(budget, "now", lambda: _at(1, 10))
    await ledger(wiki_schema.DEFAULT.spec.budget.daily_tokens + 1, _at(1, 9, 30))
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        job_id = await jobs.enqueue(s, "ingest", {"source_id": str(uuid4()), "test": RUN})
    try:
        assert await worker.run_once(f"test-bud-{RUN}", ops=["ingest"]) is True
        async with session_scope() as s:
            state, attempts, error, wait_h = (await s.execute(text("""
                SELECT state, attempts, error, EXTRACT(EPOCH FROM not_before - NOW()) / 3600 FROM wiki_jobs WHERE id = CAST(:i AS uuid)
            """), {"i": job_id})).one()
            logged = (await s.execute(text("""
                SELECT COUNT(*) FROM wiki_log WHERE title LIKE '하루 예산 다 씀%' AND at > NOW() - INTERVAL '1 minute'
            """))).scalar_one()
        assert (state, attempts) == ("queued", 0)  # 시도 수를 쓰지 않았다
        assert error.startswith("하루 예산") and 13.9 < float(wait_h) < 14.1  # 2030-01-02 0시까지(14시간)
        assert logged >= 1
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM wiki_jobs WHERE id = CAST(:i AS uuid)"), {"i": job_id})
            await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
            await s.execute(text("DELETE FROM wiki_log WHERE title LIKE '하루 예산 다 씀%' AND at > NOW() - INTERVAL '10 minutes'"))


# ── 묻기 우선 · 동시 수 · 장부 ─────────────────────────────────────────────────────────────────────

def _plan(delay_s: float) -> dict[str, Any]:
    return {"match": {"schema": "wiki_plan"}, "reply": {
        "json": {"summary": "{{summary}}", "pages": [{"slug": "{{cand}}", "why": "원천의 사실을 담는다."}]},
        "capture": {"cand": "후보: ([a-z0-9-]+)", "summary": "\\n요약: ([^\\n]*)"},
        "usage": {"prompt_tokens": 1200, "completion_tokens": 80}, "delay_s": delay_s}}


_WRITE = {"match": {"schema": "wiki_write"}, "reply": {
    "json": {"ops": [{"op": "block.insert", "doc": "{{doc}}", "section": "{{sec}}",
                      "block": {"type": "paragraph", "text": "{{summary}}"},
                      "cites": [{"sid": "{{sid}}", "loc": {"path": "/"}}], "why": "원천을 옮긴다."}]},
    "capture": {"doc": "\\n문서: ([a-z0-9-]+)", "sid": "<<<원천 (src_[0-9a-f]+)", "summary": "\\n요약: ([^\\n]*)",
                "sec": "\\n## ([^\\n(]+?) \\(AI\\)"},
    "usage": {"prompt_tokens": 1500, "completion_tokens": 200}}}
_RESOLVE = {"match": {"schema": "wiki_resolve"}, "reply": {"json": {"choices": []}}}


async def _user(s: Any, name: str, role: str) -> dict[str, Any]:
    uid = str(uuid4())
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role) VALUES (CAST(:id AS uuid), :e, :n, :pw, :r)
    """), {"id": uid, "e": f"w7-bud-{RUN}-{name}@example.com", "n": f"W7 {name}", "pw": hash_password("x" * 16), "r": role})
    return {"id": uid, "email": f"w7-bud-{RUN}-{name}@example.com", "role": role,
            "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


def _env(name: str, n: int) -> dict[str, Any]:
    env = json.loads(next((FIX / "sources").glob(f"{name}*.json")).read_text(encoding="utf-8"))
    env["origin"]["ref"] = f"w7-bud-{RUN}-{n}-{env['origin']['ref']}"
    for hint in env.get("subject_hints") or []:
        hint["name"] = f"{hint['name']} B{RUN}{n}"
        hint["ext"] = {k: f"{v}-{RUN}{n}" for k, v in (hint.get("ext") or {}).items()}
    return env


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch, fake_llm: Any) -> Any:
    st = get_settings()
    for key, value in (("wiki_enabled", True), ("wiki_llm_base_url", fake_llm.base_url), ("wiki_llm_model", fake_llm.model),
                       ("wiki_llm_api_key", ""), ("wiki_llm_structured", "json_schema"),
                       ("wiki_query_llm_base_url", ""), ("wiki_query_llm_model", "")):
        monkeypatch.setattr(st, key, value)
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        w: dict[str, Any] = {"llm": fake_llm, "admin": await _user(s, "admin", "admin"),
                             "reader": await _user(s, "reader", "reader")}
        owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
        ent = str((await s.execute(text("""
            INSERT INTO wiki_entities (type_key, canonical_name, audience) VALUES ('part', :n, ARRAY['org']) RETURNING id
        """), {"n": NAME})).scalar_one())
        slug = f"ent-part-b{RUN}"
        content = {**BASE, "slug": slug, "title": NAME, "sections": [{"id": "s0", "title": "요약", "blocks": [
            {"type": "paragraph", "id": f"b{RUN}1", "text": "1.5 m 낙하에서 체결부 모서리에 균열이 난다."}]}]}
        doc = str((await s.execute(text("""
            INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
            VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o) RETURNING id
        """), {"slug": slug, "t": NAME, "c": json.dumps(content, ensure_ascii=False), "o": owner})).scalar_one())
        await s.execute(text("""
            INSERT INTO wiki_pages (doc_id, kind, managed, audience, entity_id) VALUES (:d, 'entity', 'ai', ARRAY['org'], CAST(:e AS uuid))
        """), {"d": doc, "e": ent})
        await s.commit()
    yield w
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        src = [(str(r[0]), r[1]) for r in (await s.execute(text(
            "SELECT id, doc_id FROM wiki_sources WHERE origin_ref LIKE :p"), {"p": f"w7-bud-{RUN}-%"})).all()]
        ids = [i for i, _ in src]
        cs = [str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM wiki_changesets WHERE plan ->> 'source_id' = ANY(:ids)"), {"ids": ids})).all()]
        docs = {str(d) for _, d in src if d} | {str(r[0]) for r in (await s.execute(text(
            "SELECT DISTINCT doc_id FROM wiki_citations WHERE source_id = ANY(CAST(:ids AS uuid[]))"), {"ids": ids})).all()}
        docs |= {str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM documents WHERE slug LIKE :p OR title LIKE :t"), {"p": f"%b{RUN}%", "t": f"%B{RUN}%"})).all()}
        await s.execute(text("DELETE FROM wiki_citations WHERE source_id = ANY(CAST(:ids AS uuid[]))"), {"ids": ids})
        job_ids = [str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM wiki_jobs WHERE args ->> 'source_id' = ANY(:ids)"), {"ids": ids})).all()]
        await s.execute(text("DELETE FROM wiki_llm_usage WHERE job_id = ANY(CAST(:j AS uuid[]))"), {"j": job_ids})
        await s.execute(text("DELETE FROM wiki_jobs WHERE id = ANY(CAST(:j AS uuid[]))"), {"j": job_ids})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("""
            DELETE FROM wiki_log WHERE changeset_id = ANY(CAST(:cs AS uuid[])) OR title LIKE ANY(:t)
               OR actor IN (SELECT 'user:' || id FROM users WHERE email LIKE :e)
        """), {"cs": cs, "t": [f"%({sources.short_id(i)})" for i in ids], "e": f"w7-bud-{RUN}-%"})
        await s.execute(text("DELETE FROM wiki_changesets WHERE id = ANY(CAST(:cs AS uuid[]))"), {"cs": cs})
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[]))"), {"d": sorted(docs)})
        await s.execute(text("DELETE FROM wiki_entities WHERE canonical_name LIKE :n"), {"n": f"%B{RUN}%"})
        await s.execute(text("DELETE FROM wiki_sources WHERE origin_ref LIKE :p"), {"p": f"w7-bud-{RUN}-%"})
        await s.execute(text("DELETE FROM wiki_questions WHERE created_by IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w7-bud-{RUN}-%"})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w7-bud-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w7-bud-{RUN}-%"})
    for doc_id in docs:
        meili_indexer.delete_document(doc_id)


async def _receive(w: dict[str, Any], n: int, name: str = "03") -> str:
    async with session_scope() as s:
        got = await sources.receive(s, SourceEnvelope.model_validate(_env(name, n)), caller=w["admin"], ingest=True)
    return got.id


async def _wait_for(llm: Any, rule: int, timeout: float = 10.0) -> dict[str, Any]:
    for _ in range(int(timeout / 0.05)):
        hit = next((c for c in llm.calls if c["rule"] == rule), None)
        if hit is not None:
            return hit
        await asyncio.sleep(0.05)
    raise AssertionError(f"rule {rule} was never called")


async def test_background_yields_to_interactive_query(world: dict[str, Any]) -> None:
    """들이기의 계획 호출이 느린 사이 묻기가 들어오면 — 묻기는 기다리지 않고, 들이기의 다음 호출은 묻기가 끝난 뒤에야 간다."""
    world["llm"].load({"rules": [_plan(1.2), _WRITE, _RESOLVE,
                                 {"match": {"contains": "물음:"},
                                  "reply": {"text": ANSWER, "chunk_chars": 4, "chunk_delay_s": 0.15}}]})
    await _receive(world, 1)
    bg = asyncio.create_task(worker.run_once(f"test-bud-{RUN}-a", ops=["ingest"]))
    plan = await _wait_for(world["llm"], 0)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(f"{API}/query", headers=world["reader"]["headers"],
                         json={"messages": [{"role": "user", "content": f"{NAME} 균열은 어디서 시작하나"}]})
    tokens = [json.loads(line[6:])["text"] for chunk in r.text.split("\n\n") if chunk.startswith("event: token")
              for line in chunk.splitlines() if line.startswith("data: ")]
    assert r.status_code == 200 and "".join(tokens) == ANSWER
    assert await bg is True
    query = next(c for c in world["llm"].calls if c["rule"] == 3)
    write = next(c for c in world["llm"].calls if c["rule"] == 1)
    assert query["at"] < plan["done_at"]  # 묻기는 느린 배경 호출이 끝나기를 기다리지 않았다
    assert query["done_at"] - query["at"] > 1.0  # 묻기가 흐르는 동안(조각 열 · 0.15초씩)
    assert write["at"] >= query["done_at"] - 0.05, (write["at"], query["done_at"])  # 배경의 다음 호출은 묻기 뒤에


async def test_background_calls_respect_concurrency(world: dict[str, Any]) -> None:
    """LLM 동시 수 1(규칙서 첫 판) — 워커 둘이 같이 돌아도 배경 호출은 하나씩 간다."""
    world["llm"].load({"rules": [_plan(0.8), _WRITE, _RESOLVE]})
    await _receive(world, 2)
    await _receive(world, 3, "05")
    done = await asyncio.gather(worker.run_once(f"test-bud-{RUN}-b", ops=["ingest"]),
                                worker.run_once(f"test-bud-{RUN}-c", ops=["ingest"]))
    assert done == [True, True]
    calls = sorted(world["llm"].calls, key=lambda c: c["at"])
    for a, b in zip(calls, calls[1:], strict=False):
        assert b["at"] >= a["done_at"] - 0.05, [(c["rule"], round(c["at"], 2), round(c["done_at"], 2)) for c in calls]


async def test_usage_is_written_to_the_ledger(world: dict[str, Any]) -> None:
    world["llm"].load({"rules": [_plan(0), _WRITE, _RESOLVE]})
    sid = await _receive(world, 4)
    assert await worker.run_once(f"test-bud-{RUN}-d", ops=["ingest"]) is True
    async with session_scope() as s:
        job_id, usage = (await s.execute(text("""
            SELECT id, usage FROM wiki_jobs WHERE args ->> 'source_id' = :i
        """), {"i": sid})).one()
        rows = (await s.execute(text("""
            SELECT role, name, tokens FROM wiki_llm_usage WHERE job_id = :j ORDER BY id
        """), {"j": job_id})).all()
    # 앞 시험의 비슷한 이름이 후보가 되면 wiki_resolve 도 한 번 — 호출마다 한 줄
    assert {r[1] for r in rows} >= {"wiki_plan", "wiki_write"} and {r[0] for r in rows} == {"background"}
    assert ("wiki_plan", 1280) in [(r[1], r[2]) for r in rows] and ("wiki_write", 1700) in [(r[1], r[2]) for r in rows]
    usage = usage if isinstance(usage, dict) else json.loads(usage)
    assert usage["prompt_tokens"] + usage["completion_tokens"] == sum(r[2] for r in rows)  # 작업 줄의 쓴 양 = 장부
