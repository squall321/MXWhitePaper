# 위키 들이기 시험 — 가짜 LLM(진짜 소켓)으로 계획 · 쓰기 → 검증 V1~V11 → 자동 반영 · 검토 큐 · 되돌리기, 합성 원천 20 → 문서
"""docs/llm-wiki W4 완료 기준 — 합성 20 → 문서 · 틀린 가짜 답 여섯 가지가 다 걸림 · 되돌리기 복원.

원천의 힌트 이름 · 외부 id 에 이 실행의 꼬리(RUN)를 붙여 엔티티 · 문서가 dev DB 의 다른 것과 겹치지 않게 한다. 만든 것(원천 · 작업 ·
묶음 · 근거 · 기록 · 문서 · 엔티티 · 색인 줄 · 사람)은 끝에 지운다.
"""
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
from app.services import document_service
from app.wiki import apply as wiki_apply
from app.wiki import audience, sources, worker
from app.wiki import review as wiki_review
from app.wiki.envelope import SourceEnvelope

RUN = uuid4().hex[:8]
FIX = Path(__file__).parent / "fixtures" / "wiki"
API = "/api/v1/wiki"


def _j(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _env(name: str, **over: Any) -> dict[str, Any]:
    env = json.loads(next((FIX / "sources").glob(f"{name}*.json")).read_text(encoding="utf-8"))
    env["origin"]["ref"] = f"w4-{RUN}-{env['origin']['ref']}"
    for hint in env.get("subject_hints") or []:
        hint["name"] = f"{hint['name']} {RUN}"
        hint["ext"] = {k: f"{v}-{RUN}" for k, v in (hint.get("ext") or {}).items()}
    env.update(over)
    return env


def _scenario(name: str, **fill: str) -> dict[str, Any]:
    raw = (FIX / "scenarios" / f"{name}.json").read_text(encoding="utf-8")
    for key, value in fill.items():
        raw = raw.replace("{{" + key + "}}", value)
    return json.loads(raw)


async def _user(s: Any, name: str, role: str, *, aff: str | None = None, plat: list[str] | None = None,
                reviewer: bool = False) -> dict[str, Any]:
    uid = str(uuid4())
    email = f"w4-ing-{RUN}-{name}@example.com"
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at,
                           wiki_reviewer)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at, :rv)
    """), {"id": uid, "e": email, "n": f"W4 {name}", "pw": hash_password("x" * 16), "r": role, "a": aff,
           "p": plat, "at": datetime.now(UTC) if (aff or plat) else None, "rv": reviewer})
    return {"id": uid, "email": email, "role": role, "portal_affiliation": aff, "portal_plat": plat,
            "portal_access_at": datetime.now(UTC).isoformat() if (aff or plat) else None,
            "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


@pytest.fixture
async def wiki(monkeypatch: pytest.MonkeyPatch, fake_llm: Any) -> Any:
    st = get_settings()
    for key, value in (("wiki_enabled", True), ("wiki_llm_base_url", fake_llm.base_url), ("wiki_llm_model", fake_llm.model),
                       ("wiki_llm_api_key", ""), ("wiki_llm_structured", "json_schema")):
        monkeypatch.setattr(st, key, value)
    audience.set_viewer(audience.SYSTEM)
    fake_llm.load("ingest-normal.json")
    async with session_scope() as s:
        people = {
            "admin": await _user(s, "admin", "admin"),
            "reviewer": await _user(s, "reviewer", "editor", aff="SYN-CAE1", plat=["plat:plmdefect"], reviewer=True),
            "reader": await _user(s, "reader", "reader"),
        }
        await s.commit()
    yield {"llm": fake_llm, **people}
    audience.set_viewer(audience.SYSTEM)
    await _cleanup()


async def _cleanup() -> None:
    async with session_scope() as s:
        src = [(str(r[0]), r[1]) for r in (await s.execute(text(
            "SELECT id, doc_id FROM wiki_sources WHERE origin_ref LIKE :p"), {"p": f"w4-{RUN}-%"})).all()]
        src_ids = [i for i, _ in src]
        cs_rows = (await s.execute(text(
            "SELECT id, applied, plan FROM wiki_changesets WHERE plan ->> 'source_id' = ANY(:ids)"), {"ids": src_ids})).all()
        cs_ids = [str(r[0]) for r in cs_rows]
        doc_ids = {str(d) for _, d in src if d} | {d for r in cs_rows for d in (_j(r[1]) or {})}
        # 반영이 깨져 되감긴(보관된) 문서는 applied 에 없다 — 계획의 문서를 slug 로 함께 찾는다.
        plan_slugs = sorted({p["slug"] for r in cs_rows for p in (_j(r[2]) or {}).get("pages") or []})
        doc_ids |= {str(r[0]) for r in (await s.execute(text(
            "SELECT d.id FROM documents d JOIN wiki_pages wp ON wp.doc_id = d.id WHERE d.slug = ANY(:s)"),
            {"s": plan_slugs})).all()}
        doc_ids |= {str(r[0]) for r in (await s.execute(text(
            "SELECT DISTINCT doc_id FROM wiki_citations WHERE source_id = ANY(CAST(:ids AS uuid[]))"), {"ids": src_ids})).all()}
        doc_ids |= {str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM documents WHERE slug LIKE :p"), {"p": f"%{RUN}%"})).all()}
        await s.execute(text("DELETE FROM wiki_citations WHERE source_id = ANY(CAST(:ids AS uuid[]))"), {"ids": src_ids})
        await s.execute(text("DELETE FROM wiki_jobs WHERE args ->> 'source_id' = ANY(:ids)"), {"ids": src_ids})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE changeset_id = ANY(CAST(:cs AS uuid[])) OR title LIKE ANY(:t)"),
                        {"cs": cs_ids, "t": [f"%({sources.short_id(i)})" for i in src_ids]})
        await s.execute(text("DELETE FROM wiki_changesets WHERE id = ANY(CAST(:cs AS uuid[]))"), {"cs": cs_ids})
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[]))"), {"d": sorted(doc_ids)})
        await s.execute(text("DELETE FROM wiki_entities WHERE canonical_name LIKE :n"), {"n": f"%{RUN}"})
        await s.execute(text("DELETE FROM wiki_sources WHERE origin_ref LIKE :p"), {"p": f"w4-{RUN}-%"})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w4-ing-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w4-ing-{RUN}-%"})
    for doc_id in doc_ids:
        meili_indexer.delete_document(doc_id)


async def _receive(who: dict[str, Any], name: str, *, ingest: bool = True, **over: Any) -> str:
    async with session_scope() as s:
        got = await sources.receive(s, SourceEnvelope.model_validate(_env(name, **over)), caller=who, ingest=ingest)
    return got.id


async def _drain() -> int:
    n = 0
    while await worker.run_once(f"test-w4-{RUN}", ops=["ingest"]):
        n += 1
    return n


async def _change(source_id: str) -> dict[str, Any]:
    async with session_scope() as s:
        cs_id = (await s.execute(text("""
            SELECT id FROM wiki_changesets WHERE plan ->> 'source_id' = :i ORDER BY created_at DESC LIMIT 1
        """), {"i": source_id})).scalar_one()
        return await wiki_apply.load_changeset(s, str(cs_id))


def _verdict(cs: dict[str, Any], rule: str) -> str:
    return next(c["verdict"] for c in cs["validation"] if c["rule"] == rule)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_one_source_becomes_a_page_with_citations(wiki: dict[str, Any]) -> None:
    sid = await _receive(wiki["admin"], "03")  # org 해석 결과 — 첫 후보는 사례 문서
    assert await _drain() == 1
    cs = await _change(sid)
    assert cs["status"] == "auto_applied", cs["validation"]
    page = cs["plan"]["pages"][0]
    assert page["slug"] == f"case-sim-{sid.replace('-', '')[:8]}" and page["new"] is True
    async with _client() as c:
        doc = (await c.get(f"/api/v1/documents/{page['slug']}", headers=wiki["reader"]["headers"],
                           params={"with": "citations"})).json()["data"]
    first = doc["content"]["sections"][0]
    assert first["title"] == "요약" and len(first["blocks"]) == 1
    cites = doc["citations"][first["blocks"][0]["id"]]
    assert [c["source_id"] for c in cites] == [sid] and cites[0]["short"] == sources.short_id(sid)
    auto = next(sec for sec in doc["content"]["sections"] if sec["title"] == "원천")
    assert sources.short_id(sid).replace("src_", "src-") in json.dumps(auto, ensure_ascii=False)  # 자동 절 — 원천 문서 링크
    async with session_scope() as s:
        state, src_doc = (await s.execute(text("""
            SELECT ws.ingest_state, d.content_json FROM wiki_sources ws JOIN documents d ON d.id = ws.doc_id
             WHERE ws.id = CAST(:i AS uuid)
        """), {"i": sid})).one()
        log = (await s.execute(text("SELECT op, detail FROM wiki_log WHERE changeset_id = CAST(:c AS uuid)"),
                               {"c": cs["id"]})).one()
    assert state == "done" and page["slug"] in json.dumps(_j(src_doc), ensure_ascii=False)  # 원천 문서가 인용한 문서를 안다
    assert log[0] == "ingest" and _j(log[1])["status"] == "auto_applied"


@pytest.mark.parametrize(("scenario", "rule", "status"), [
    ("ingest-invented-number", "V3", "failed"),
    ("ingest-no-cite", "V2", "failed"),
    ("ingest-long-quote", "V10", "failed"),
    ("ingest-off-plan", "V6", "pending_review"),
])
async def test_wrong_answers_are_caught(wiki: dict[str, Any], scenario: str, rule: str, status: str) -> None:
    wiki["llm"].load(f"{scenario}.json")
    sid = await _receive(wiki["admin"], "05")
    await _drain()
    cs = await _change(sid)
    assert cs["status"] == status and _verdict(cs, rule) == ("fail" if status == "failed" else "review"), cs["validation"]
    assert cs["applied"] == {}
    async with session_scope() as s:
        made = (await s.execute(text("SELECT COUNT(*) FROM documents WHERE slug = :s"),
                                {"s": cs["plan"]["pages"][0]["slug"]})).scalar_one()
    assert made == 0  # 반영하지 않았다


async def test_mixed_scope_is_caught(wiki: dict[str, Any]) -> None:
    foreign = await _receive(wiki["admin"], "09", ingest=False)  # plat:plmdefect 원천
    wiki["llm"].load(_scenario("ingest-mixed-scope", foreign_sid=sources.short_id(foreign)))
    sid = await _receive(wiki["admin"], "14")  # org 문답
    await _drain()
    cs = await _change(sid)
    assert cs["status"] == "failed" and _verdict(cs, "V4") == "fail" and "plat:plmdefect" in json.dumps(
        cs["validation"], ensure_ascii=False)


async def test_locked_block_goes_to_review(wiki: dict[str, Any]) -> None:
    first = await _receive(wiki["admin"], "17")  # org 문답 — 부품 문서를 새로 만든다
    await _drain()
    slug = (await _change(first))["plan"]["pages"][0]["slug"]
    async with session_scope() as s:
        doc = await document_service.get_document_or_404(s, slug)
        content = _j(doc["content_json"])
        content["sections"][0]["blocks"][0]["meta"] = {"locked": True}
        await document_service.replace_document(s, slug=slug, payload=content, actor_id=wiki["admin"]["id"],
                                                if_match=document_service.make_etag(doc["id"], doc["version"]))
    wiki["llm"].load("ingest-locked-block.json")
    second = await _receive(wiki["admin"], "20")  # org 정정 — 같은 부품
    await _drain()
    cs = await _change(second)
    assert cs["plan"]["pages"][0]["slug"] == slug
    assert cs["status"] == "pending_review" and _verdict(cs, "V5") == "review"


async def test_review_queue_api(wiki: dict[str, Any]) -> None:
    wiki["llm"].load("ingest-off-plan.json")
    sid = await _receive(wiki["admin"], "19")  # org 심의
    await _drain()
    cs = await _change(sid)
    assert cs["status"] == "pending_review"
    rev, reader = wiki["reviewer"]["headers"], wiki["reader"]["headers"]
    async with _client() as c:
        assert (await c.get(f"{API}/changes", headers=reader)).status_code == 403  # 검토자 표지가 없다
        listed = (await c.get(f"{API}/changes", headers=rev, params={"status": "pending_review"})).json()["data"]
        detail = (await c.get(f"{API}/changes/{cs['id']}", headers=rev)).json()["data"]
        no_note = await c.post(f"{API}/changes/{cs['id']}/reject", headers=rev, json={})
        ok = await c.post(f"{API}/changes/{cs['id']}/approve", headers=rev, json={"note": "계획 안의 것만 반영"})
        again = await c.post(f"{API}/changes/{cs['id']}/approve", headers=rev, json={})
    assert cs["id"] in [x["id"] for x in listed]
    assert detail["docs"][0]["ops"][0]["after"] and any(v["rule"] == "V6" and v["verdict"] == "review"
                                                        for v in detail["validation"])
    assert no_note.status_code == 422
    assert ok.status_code == 200 and ok.json()["data"]["status"] == "applied"
    assert again.status_code == 409
    async with session_scope() as s:
        st = (await s.execute(text("SELECT status, decision_note FROM wiki_changesets WHERE id = CAST(:i AS uuid)"),
                              {"i": cs["id"]})).one()
        off = (await s.execute(text("SELECT COUNT(*) FROM documents WHERE slug = 'ent-part-not-in-plan'"))).scalar_one()
    assert tuple(st) == ("applied", "계획 안의 것만 반영") and off == 0  # 계획 밖 연산은 반영하지 않는다


async def test_revert_restores(wiki: dict[str, Any]) -> None:
    first = await _receive(wiki["admin"], "15")  # org 문답 — 새 문서
    await _drain()
    cs1 = await _change(first)
    slug = cs1["plan"]["pages"][0]["slug"]
    second = await _receive(wiki["admin"], "15", origin={**_env("15")["origin"], "ref": f"w4-{RUN}-other"})
    await _drain()
    cs2 = await _change(second)
    assert cs2["plan"]["pages"][0]["slug"] == slug and cs2["status"] == "auto_applied"
    async with session_scope() as s:
        doc_id = cs2["plan"]["pages"][0]["doc_id"]
        frm, to = cs2["applied"][doc_id]
        await wiki_review.revert(s, cs2["id"], user=wiki["admin"])
        ver = (await s.execute(text("SELECT version, content_json FROM documents WHERE id = CAST(:d AS uuid)"),
                               {"d": doc_id})).one()
        old = (await s.execute(text(
            "SELECT content_json FROM document_versions WHERE document_id = CAST(:d AS uuid) AND version = :v"),
            {"d": doc_id, "v": frm})).scalar_one()
        left = (await s.execute(text("SELECT COUNT(*) FROM wiki_citations WHERE changeset_id = CAST(:c AS uuid)"),
                                {"c": cs2["id"]})).scalar_one()
    assert ver[0] == to + 1 and _j(ver[1])["sections"] == _j(old)["sections"] and left == 0
    async with session_scope() as s:
        with pytest.raises(Exception, match="반영된 묶음만"):
            await wiki_review.revert(s, cs2["id"], user=wiki["admin"])
    async with session_scope() as s:  # 앞 묶음은 그 뒤 판이 생겨(되돌림) 되돌리지 않는다
        with pytest.raises(Exception, match="또 바뀌었다"):
            await wiki_review.revert(s, cs1["id"], user=wiki["admin"])


async def test_unreachable_llm_defers_without_spending_attempts(wiki: dict[str, Any],
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "wiki_llm_base_url", "http://127.0.0.1:9/v1")
    sid = await _receive(wiki["admin"], "05")
    assert await worker.run_once(f"test-w4-{RUN}", ops=["ingest"]) is True
    async with session_scope() as s:
        job = (await s.execute(text("""
            SELECT state, attempts, not_before > NOW() FROM wiki_jobs WHERE args ->> 'source_id' = :i
        """), {"i": sid})).one()
        state = (await s.execute(text("SELECT ingest_state FROM wiki_sources WHERE id = CAST(:i AS uuid)"),
                                 {"i": sid})).scalar_one()
    assert tuple(job) == ("queued", 0, True) and state == "queued"


async def test_budget_overrun_holds(wiki: dict[str, Any]) -> None:
    normal = _scenario("ingest-normal")
    normal["rules"][0]["reply"]["usage"] = {"prompt_tokens": 70000, "completion_tokens": 10}
    wiki["llm"].load(normal)
    sid = await _receive(wiki["admin"], "05")
    await _drain()
    async with session_scope() as s:
        job = (await s.execute(text("SELECT state, error FROM wiki_jobs WHERE args ->> 'source_id' = :i"),
                               {"i": sid})).one()
        state = (await s.execute(text("SELECT ingest_state FROM wiki_sources WHERE id = CAST(:i AS uuid)"),
                                 {"i": sid})).scalar_one()
    assert job[0] == "held" and "예산" in job[1] and state == "held"


async def test_restricted_source_is_not_ingested(wiki: dict[str, Any]) -> None:
    sid = await _receive(wiki["admin"], "05", sensitivity="restricted")
    await _drain()
    async with session_scope() as s:
        state = (await s.execute(text("SELECT ingest_state FROM wiki_sources WHERE id = CAST(:i AS uuid)"),
                                 {"i": sid})).scalar_one()
        made = (await s.execute(text("SELECT COUNT(*) FROM wiki_changesets WHERE plan ->> 'source_id' = :i"),
                                {"i": sid})).scalar_one()
    assert state == "skipped" and made == 0
    assert wiki["llm"].calls == []  # LLM 을 부르지 않았다


async def test_synthetic_twenty_become_pages(wiki: dict[str, Any]) -> None:
    ids = [await _receive(wiki["admin"], f"{i:02d}") for i in range(1, 21)]
    assert await _drain() == 20
    async with session_scope() as s:
        states = dict((await s.execute(text("""
            SELECT CAST(id AS text), ingest_state FROM wiki_sources WHERE id = ANY(CAST(:ids AS uuid[]))
        """), {"ids": ids})).all())
        rows = (await s.execute(text("""
            SELECT status, plan ->> 'sid', validation FROM wiki_changesets WHERE plan ->> 'source_id' = ANY(:ids)
        """), {"ids": ids})).all()
        statuses = [r[0] for r in rows]
        bad = [(r[1], [c for c in _j(r[2]) if c["verdict"] != "pass"]) for r in rows if r[0] != "auto_applied"]
        scopes = {tuple(r[0]) for r in (await s.execute(text("""
            SELECT DISTINCT wp.audience FROM wiki_citations c JOIN wiki_pages wp ON wp.doc_id = c.doc_id
             WHERE c.source_id = ANY(CAST(:ids AS uuid[])) AND wp.kind <> 'source'
        """), {"ids": ids})).all()}
        leaks = (await s.execute(text("""
            SELECT COUNT(*) FROM wiki_citations c JOIN wiki_pages wp ON wp.doc_id = c.doc_id
              JOIN wiki_sources ws ON ws.id = c.source_id
             WHERE c.source_id = ANY(CAST(:ids AS uuid[]))
               AND NOT (array_remove(ws.audience, 'org') <@ wp.audience)
        """), {"ids": ids})).scalar_one()
    assert states[ids[0]] == "skipped"  # 01 은 02(같은 잡의 새 판)에 밀렸다
    assert all(states[i] == "done" for i in ids[1:]), states
    assert len(statuses) == 19 and set(statuses) == {"auto_applied"}, bad
    assert scopes == {("org",), ("aff:SYN-CAE1",), ("plat:plmdefect",), ("aff:SYN-CAE1", "plat:plmdefect")}
    assert leaks == 0  # 어느 문서도 자기 범위 밖 원천을 인용하지 않는다
