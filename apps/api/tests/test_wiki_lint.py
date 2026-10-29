# 위키 점검 시험 — 심은 결함(모순 · 낡음 · 고아 · 빠진 문서 · 빠진 링크 · 빈틈 · 근거 없음 · 꼴 · 밀린 검토)이 다 잡히고, 범위대로 보이고, 한 줄로 이어진다
"""docs/llm-wiki W7 완료 기준 '일부러 심은 모순 · 낡음 · 고아 · 빠진 문서 · 빠진 링크 · 빈틈이 다 잡힌다' — request §5-8 · CONTRACTS §2-8.

손으로 지은 위키(원천은 합성 묶음을 받고, 문서는 SQL 로) 하나에 결함을 하나씩 심는다. 끝에서 끝(합성 원천 20 → 가짜 LLM 들이기 → 밤
점검)은 묶음에 심긴 셋(모순 · 낡음 · 빈틈)을 본다. 힌트 이름 · 외부 id 에 이 실행의 꼬리를 붙여 다른 시험과 겹치지 않게 한다.
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
from app.wiki import audience, budget, jobs, lint, pages, sources, worker
from app.wiki import schema as wiki_schema
from app.wiki.envelope import SourceEnvelope

RUN = uuid4().hex[:8]
SUF = f"L{RUN}"
API = "/api/v1/wiki"
FIX = Path(__file__).parent / "fixtures" / "wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
HINGE, GLASS, CONCEPT = f"힌지 브래킷 {SUF}", f"커버 글라스 {SUF}", f"낙하 충격 개념 {SUF}"
P_ORG, P_AFF, CASE = f"ent-part-l{RUN}", f"ent-part-l{RUN}--syn-cae1", f"case-sim-l{RUN}a"
GLASS_PAGE, ORPHAN = f"ent-part-glass-l{RUN}", f"ent-concept-l{RUN}"
AFF = ["aff:SYN-CAE1"]
B = {k: pages.new_id() for k in ("o1", "o2", "a1", "a2", "c1", "x1")}  # 블록 id 는 ULID 여야 저장된다
_RUNS: list[str] = []  # 이 시험이 돌린 점검 — 끝에 그 기록 · 고침 묶음 · 실행 줄을 지운다


def _env(name: str) -> dict[str, Any]:
    env = json.loads(next((FIX / "sources").glob(f"{name}*.json")).read_text(encoding="utf-8"))
    env["origin"]["ref"] = f"w7-lint-{RUN}-{env['origin']['ref']}"
    for hint in env.get("subject_hints") or []:
        hint["name"] = f"{hint['name']} {SUF}"
        hint["ext"] = {k: f"{v}-{RUN}" for k, v in (hint.get("ext") or {}).items()}
    return env


async def _user(s: Any, name: str, role: str, *, aff: str | None = None, plat: list[str] | None = None,
                reviewer: bool = False) -> dict[str, Any]:
    uid = str(uuid4())
    email = f"w7-lint-{RUN}-{name}@example.com"
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at, wiki_reviewer)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at, :rv)
    """), {"id": uid, "e": email, "n": f"W7 {name}", "pw": hash_password("x" * 16), "r": role, "a": aff, "p": plat,
           "at": datetime.now(UTC) if (aff or plat) else None, "rv": reviewer})
    return {"id": uid, "email": email, "role": role, "portal_affiliation": aff, "portal_plat": plat,
            "portal_access_at": datetime.now(UTC).isoformat() if (aff or plat) else None,
            "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _page(s: Any, *, slug: str, title: str, type_key: str, kind: str, aud: list[str], entity: str | None,
                blocks: dict[str, list[tuple[str, str]]], only: list[str] | None = None) -> str:
    """규칙서 꼴(또는 `only` 절만)의 위키 문서 — 블록은 {절: [(블록 id, 글)]}."""
    owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
    content = pages.skeleton(wiki_schema.DEFAULT, slug=slug, type_key=type_key, title=title, summary="", owners=[],
                             division=BASE["metadata"]["division"])
    content["metadata"] = BASE["metadata"]
    if only is not None:
        content["sections"] = [sec for sec in content["sections"] if sec["title"] in only]
    for sec in content["sections"]:
        sec["blocks"] = [{"type": "paragraph", "id": bid, "text": body} for bid, body in blocks.get(sec["title"], [])]
    doc_id = str((await s.execute(text("""
        INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
        VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o) RETURNING id
    """), {"slug": slug, "t": title, "c": json.dumps(content, ensure_ascii=False), "o": owner})).scalar_one())
    await s.execute(text("""
        INSERT INTO wiki_pages (doc_id, kind, managed, audience, entity_id, schema_version)
        VALUES (CAST(:d AS uuid), :k, 'ai', CAST(:a AS text[]), CAST(:e AS uuid), 1)
    """), {"d": doc_id, "k": kind, "a": aud, "e": entity})
    return doc_id


async def _cite(s: Any, doc: str, block: str, source: str) -> None:
    await s.execute(text("""
        INSERT INTO wiki_citations (doc_id, block_id, source_id, locator) VALUES (CAST(:d AS uuid), :b, CAST(:s AS uuid), '{}')
    """), {"d": doc, "b": block, "s": source})


async def _entity(s: Any, type_key: str, name: str) -> str:
    return str((await s.execute(text("""
        INSERT INTO wiki_entities (type_key, canonical_name, audience) VALUES (:t, :n, ARRAY['org']) RETURNING id
    """), {"t": type_key, "n": name})).scalar_one())


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    for key in ("wiki_llm_base_url", "wiki_llm_model"):
        monkeypatch.setattr(get_settings(), key, "")
    audience.set_viewer(audience.SYSTEM)
    w: dict[str, Any] = {}
    async with session_scope() as s:
        w["admin"] = await _user(s, "admin", "admin")
        w["reviewer"] = await _user(s, "reviewer", "editor", aff="SYN-CAE1", plat=["plat:plmdefect"], reviewer=True)
        w["reader"] = await _user(s, "reader", "reader")
    src: dict[str, str] = {}
    for n in ("01", "02", "03", "04", "10", "12", "15"):  # 01 을 먼저 — 02 가 오면 01 은 새 판에 밀린다(낡음)
        async with session_scope() as s:
            src[n] = (await sources.receive(s, SourceEnvelope.model_validate(_env(n)), caller=w["admin"], ingest=False)).id
    w["src"] = src
    async with session_scope() as s:
        hinge, glass, concept = await _entity(s, "part", HINGE), await _entity(s, "part", GLASS), \
            await _entity(s, "concept", CONCEPT)
        w["hinge"] = hinge
        d = w["docs"] = {}
        # 전사 부품 문서 — 근거 있는 블록에 다른 엔티티 이름(빠진 링크 · 자동 고침), 사람이 넣은 근거 없는 블록(근거 없음)
        d["org"] = await _page(s, slug=P_ORG, title=HINGE, type_key="part", kind="entity", aud=["org"], entity=hinge,
                               blocks={"요약": [(B["o1"], f"{GLASS} 와 함께 1.5 m 전각도 낙하를 본다.")],
                                       "해석에서": [(B["o2"], "사람이 적은 메모 — 근거가 아직 없다.")]})
        await _cite(s, d["org"], B["o1"], src["03"])
        # 소속 부품 문서 — 모순 둘(02 · 04)을 인용, 옛 사례로 링크
        d["aff"] = await _page(s, slug=P_AFF, title=f"{HINGE} (aff:SYN-CAE1)", type_key="part", kind="entity", aud=AFF,
                               entity=hinge, blocks={"해석에서": [
                                   (B["a1"], "최대 응력은 405 MPa 다."),
                                   (B["a2"], f"[[{CASE}|옛 해석 사례]] 와 다른 보고서는 296 MPa 를 말한다.")]})
        await _cite(s, d["aff"], B["a1"], src["02"])
        await _cite(s, d["aff"], B["a2"], src["04"])
        # 옛 사례 — 새 판에 밀린 01 을 인용(낡음)
        d["case"] = await _page(s, slug=CASE, title=f"옛 해석 사례 {SUF}", type_key="sim-case", kind="case", aud=AFF,
                                entity=None, blocks={"요약": [(B["c1"], f"[[{P_AFF}|{HINGE}]] 의 최대 응력 412 MPa.")]})
        await _cite(s, d["case"], B["c1"], src["01"])
        d["glass"] = await _page(s, slug=GLASS_PAGE, title=GLASS, type_key="part", kind="entity", aud=["org"], entity=glass,
                                 blocks={})
        # 고아 + 꼴 — 아무도 링크하지 않고, 절이 '정의' 하나뿐
        d["orphan"] = await _page(s, slug=ORPHAN, title=CONCEPT, type_key="concept", kind="entity", aud=["org"],
                                  entity=concept, blocks={"정의": [(B["x1"], "낙하 충격은 1.5 m 에서 본다.")]},
                                  only=["정의"])
        await _cite(s, d["orphan"], B["x1"], src["03"])
        # 사람 문서(위키 아님)가 전사 문서 둘로 링크 — 그 둘은 고아가 아니다
        owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
        guide = {**BASE, "slug": f"guide-l{RUN}", "title": f"안내 {SUF}", "sections": [{"id": "g1", "title": "안내", "blocks": [
            {"type": "paragraph", "id": f"g{RUN}1", "text": f"[[{P_ORG}]] · [[{GLASS_PAGE}]] 를 본다."}]}]}
        await s.execute(text("""
            INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
            VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o)
        """), {"slug": guide["slug"], "t": guide["title"], "c": json.dumps(guide, ensure_ascii=False), "o": owner})
        # 9일 묵은 검토
        w["stuck"] = str((await s.execute(text("""
            INSERT INTO wiki_changesets (op, status, audience, plan, created_at, created_by)
            VALUES ('human_request', 'pending_review', ARRAY['org'], CAST(:p AS jsonb), NOW() - INTERVAL '9 days',
                    CAST(:u AS uuid)) RETURNING id
        """), {"p": json.dumps({"summary": f"lint test {RUN}", "pages": []}), "u": w["admin"]["id"]})).scalar_one())
    yield w
    audience.set_viewer(audience.SYSTEM)
    await _cleanup(w)


async def _cleanup(w: dict[str, Any]) -> None:
    async with session_scope() as s:
        srcs = [str(r[0]) for r in (await s.execute(text(
            "SELECT id FROM wiki_sources WHERE origin_ref LIKE :p"), {"p": f"w7-lint-{RUN}-%"})).all()]
        cs_ids = [str(r[0]) for r in (await s.execute(text("""
            SELECT id FROM wiki_changesets WHERE plan ->> 'source_id' = ANY(:ids) OR id = CAST(:stuck AS uuid)
               OR plan ->> 'lint_run' = ANY(:runs)
        """), {"ids": srcs, "stuck": w.get("stuck"), "runs": _RUNS})).all()]
        docs = [str(r[0]) for r in (await s.execute(text("""
            SELECT id FROM documents WHERE slug LIKE :p OR id IN (SELECT doc_id FROM wiki_sources WHERE id = ANY(CAST(:ids AS uuid[])))
               OR id IN (SELECT DISTINCT doc_id FROM wiki_citations WHERE source_id = ANY(CAST(:ids AS uuid[])))
        """), {"p": f"%l{RUN}%", "ids": srcs})).all()]
        qs = [str(r[0]) for r in (await s.execute(text("""
            SELECT id FROM wiki_questions WHERE text LIKE :t OR text LIKE :t2
        """), {"t": f"%{SUF}%", "t2": f"%{RUN}%"})).all()]
        await s.execute(text("""
            DELETE FROM wiki_lint_findings WHERE doc_ids && CAST(:d AS uuid[]) OR source_ids && CAST(:s AS uuid[])
               OR title LIKE :t OR detail ->> 'changeset' = ANY(:cs)
        """), {"d": docs, "s": srcs, "t": f"%{SUF}%", "cs": cs_ids + ([w["stuck"]] if w.get("stuck") else [])})
        await s.execute(text("DELETE FROM notifications WHERE kind = 'wiki_stuck_review' AND payload ->> 'changeset_id' = :c"),
                        {"c": w.get("stuck")})
        await s.execute(text("DELETE FROM wiki_questions WHERE id = ANY(CAST(:q AS uuid[]))"), {"q": qs})
        await s.execute(text("DELETE FROM wiki_citations WHERE doc_id = ANY(CAST(:d AS uuid[])) OR source_id = ANY(CAST(:s AS uuid[]))"),
                        {"d": docs, "s": srcs})
        await s.execute(text("""
            DELETE FROM wiki_jobs WHERE args ->> 'source_id' = ANY(:s) OR args ->> 'changeset_id' = ANY(:cs)
               OR (op = 'lint' AND args ->> 'changeset_id' IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM wiki_changesets c WHERE CAST(c.id AS text) = wiki_jobs.args ->> 'changeset_id'))
        """), {"s": srcs, "cs": cs_ids})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("""
            DELETE FROM wiki_log WHERE changeset_id = ANY(CAST(:cs AS uuid[])) OR title LIKE ANY(:t)
               OR job_id IN (SELECT job_id FROM wiki_lint_runs WHERE id = ANY(CAST(:runs AS uuid[])))
        """), {"cs": cs_ids, "t": [f"%{SUF}%", *(f"%({sources.short_id(i)})" for i in srcs)], "runs": _RUNS})
        await s.execute(text("DELETE FROM wiki_lint_runs WHERE id = ANY(CAST(:runs AS uuid[]))"), {"runs": _RUNS})
        await s.execute(text("DELETE FROM wiki_changesets WHERE id = ANY(CAST(:cs AS uuid[]))"), {"cs": cs_ids})
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[])) OR slug = :report"),
                        {"d": docs, "report": f"lint-{budget.now():%Y%m%d}"})
        await s.execute(text("DELETE FROM wiki_entities WHERE canonical_name LIKE :n"), {"n": f"%{SUF}"})
        await s.execute(text("DELETE FROM wiki_sources WHERE id = ANY(CAST(:s AS uuid[]))"), {"s": srcs})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w7-lint-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w7-lint-{RUN}-%"})
    for doc_id in docs:
        meili_indexer.delete_document(doc_id)


async def _lint(**args: Any) -> dict[str, Any]:
    job = jobs.Job(id=str(uuid4()), op="lint", args={"scope": "full", **args})
    async with session_scope() as s:
        out = await lint.run(s, job)
    _RUNS.append(out["run"])
    return out


async def _findings(w: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """이 실행이 심은 것에 걸린 결함 — 규칙별(이름 꼬리 · 이 시험의 문서 · 원천 · 밀린 검토)."""
    async with session_scope() as s:
        rows = (await s.execute(text("""
            SELECT f.id, f.rule, f.title, f.status, f.audience, f.detail, f.question_id, f.first_seen_at, f.doc_ids, f.source_ids
              FROM wiki_lint_findings f
             WHERE f.title LIKE :t OR f.doc_ids && (SELECT COALESCE(array_agg(id), '{}') FROM documents WHERE slug LIKE :p)
                OR f.source_ids && CAST(:srcs AS uuid[]) OR f.detail ->> 'changeset' = :stuck
        """), {"t": f"%{SUF}%", "p": f"%l{RUN}%", "srcs": list(w["src"].values()), "stuck": w.get("stuck") or ""})).all()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r[1], []).append({"id": str(r[0]), "title": r[2], "status": r[3], "audience": list(r[4]),
                                         "detail": r[5] if isinstance(r[5], dict) else json.loads(r[5]),
                                         "question_id": str(r[6]) if r[6] else None, "first_seen_at": r[7],
                                         "doc_ids": [str(x) for x in r[8]], "source_ids": [str(x) for x in r[9]]})
    return out



async def _content(slug: str) -> dict[str, Any]:
    async with session_scope() as s:
        raw = (await s.execute(text("SELECT content_json FROM documents WHERE slug = :s"), {"s": slug})).scalar_one()
    return raw if isinstance(raw, dict) else json.loads(raw)


def _section_text(content: dict[str, Any], title: str) -> str:
    sec = next(sec for sec in content["sections"] if sec["title"] == title)
    return " ".join(pages.block_text(b) for b in sec.get("blocks") or [])


async def test_planted_defects_are_all_caught(world: dict[str, Any]) -> None:
    out = await _lint()
    assert out["scope"] == "full" and out["report"]
    got = await _findings(world)
    titles = {rule: [f["title"] for f in items] for rule, items in got.items()}

    # 모순 — 02(405 MPa) · 04(296 MPa), 둘 다 소속 범위. 메시 · FE 모델 판 차이를 까닭 후보로 적는다
    (con,) = [f for f in got["contradiction"] if f["detail"].get("kind") == "number"]
    assert con["audience"] == AFF and set(con["source_ids"]) == {world["src"]["02"], world["src"]["04"]}
    assert con["detail"]["metric"] == "max_von_mises_stress" and con["status"] == "question_raised"
    assert {d["key"] for d in con["detail"]["differs"]} >= {"mesh_size", "setup.model"}
    note = _section_text(await _content(P_AFF), "서로 다른 말")  # 결정적 메모 — 두 값 · 두 원천
    assert "405 MPa" in note and "296 MPa" in note and sources.short_id(world["src"]["02"]) in note
    # 낡음 — 옛 사례가 새 판에 밀린 01 을 인용, 다시 들일 원천은 02
    (stale,) = [f for f in got["stale"] if f["doc_ids"] == [world["docs"]["case"]]]
    assert stale["audience"] == AFF and stale["detail"]["reingest"] == [world["src"]["02"]]
    # 고아 · 꼴 — 아무도 링크하지 않는 개념 문서(그 문서의 절도 하나뿐)
    assert any(CONCEPT in t for t in titles["orphan"]) and not any(t.endswith(f"{HINGE}: 들어오는 링크가 없다")
                                                                   for t in titles["orphan"])
    (schema_f,) = [f for f in got["schema"] if f["doc_ids"] == [world["docs"]["orphan"]]]
    assert "왜 중요한가" in schema_f["detail"]["missing"]
    # 빠진 링크 — 전사 부품 문서의 '커버 글라스' → 그 문서로 링크를 단 묶음이 자동 반영됐다
    (link,) = [f for f in got["missing_link"] if f["doc_ids"] == [world["docs"]["org"]]]
    assert link["status"] == "fixed" and link["detail"]["fix_status"] == "auto_applied"
    assert f"[[{GLASS_PAGE}|{GLASS}]]" in _section_text(await _content(P_ORG), "요약")
    # 근거 없음 — 사람이 넣은 블록, 질문(우선순위 4)
    (unc,) = [f for f in got["uncited"] if f["doc_ids"] == [world["docs"]["org"]]]
    assert unc["detail"]["blocks"] == [B["o2"]] and unc["status"] == "question_raised"
    # 빠진 문서 — '전각도 낙하' 는 소속 범위에서 셋(02 · 03 · 04)에 나오는데 해석 종류 문서가 없다
    assert any(f["audience"] == AFF and f["detail"]["name"] == f"전각도 낙하 {SUF}" for f in got["missing_page"])
    # 빈틈 — 배터리 스웰링은 시장(10 · 12)에만, 재현 해석이 없다 → 플랫폼 범위의 질문
    gaps = {f["detail"]["name"]: f for f in got["gap"] if f["detail"]["kind"] == "no_reproduction"}
    gap = gaps[f"배터리 스웰링 {SUF}"]
    assert gap["audience"] == ["plat:plmdefect"]
    assert f"힌지 브래킷 균열 {SUF}" not in gaps  # 해석(02 · 03 · 04)이 있다
    assert gap["status"] == "question_raised"
    # 밀린 검토 — 검토자에게 알림
    (stuck,) = got["stuck_review"]
    assert stuck["detail"]["days"] >= 9
    async with session_scope() as s:
        notified = (await s.execute(text("""
            SELECT COUNT(*) FROM notifications WHERE kind = 'wiki_stuck_review' AND user_id = CAST(:u AS uuid)
               AND payload ->> 'changeset_id' = :c
        """), {"u": world["reviewer"]["id"], "c": world["stuck"]})).scalar_one()
        qs = {r[0]: (list(r[1]), r[2]) for r in (await s.execute(text("""
            SELECT id::text, audience, origin FROM wiki_questions WHERE id = ANY(CAST(:ids AS uuid[]))
        """), {"ids": [con["question_id"], gap["question_id"], unc["question_id"]]})).all()}
    assert notified == 1
    assert qs[con["question_id"]] == (AFF, "lint") and qs[gap["question_id"]] == (["plat:plmdefect"], "lint")

    # 보고서 — 전사 결함만(좁은 결함의 값 · 제목은 없다)
    report = await _content(f"lint-{budget.now():%Y%m%d}")
    body = json.dumps(report, ensure_ascii=False)
    assert CONCEPT in body and "405" not in body and CASE not in body and "배터리 스웰링" not in body
    async with session_scope() as s:
        kind, aud = (await s.execute(text("""
            SELECT wp.kind, wp.audience FROM wiki_pages wp JOIN documents d ON d.id = wp.doc_id WHERE d.slug = :s
        """), {"s": f"lint-{budget.now():%Y%m%d}"})).one()
    assert (kind, list(aud)) == ("lint-report", ["org"])


async def test_findings_follow_audience_and_repeat_as_one_line(world: dict[str, Any]) -> None:
    await _lint()
    first = await _findings(world)
    async with _client() as c:
        mine = (await c.get(f"{API}/lint/findings", params={"limit": 200}, headers=world["reader"]["headers"])).json()
        wide = (await c.get(f"{API}/lint/findings", params={"limit": 200}, headers=world["reviewer"]["headers"])).json()
        orphan_id = next(f["id"] for f in first["orphan"] if CONCEPT in f["title"])
        denied = await c.post(f"{API}/lint/findings/{orphan_id}/dismiss", json={"note": "개념 문서는 따로 둔다"},
                              headers=world["reader"]["headers"])
        ok = await c.post(f"{API}/lint/findings/{orphan_id}/dismiss", json={"note": "개념 문서는 따로 둔다"},
                          headers=world["reviewer"]["headers"])
        queued = await c.post(f"{API}/lint", json={"scope": "docs", "slugs": [P_ORG]}, headers=world["reviewer"]["headers"])
        refused = await c.post(f"{API}/lint", json={}, headers=world["reader"]["headers"])
        health = (await c.get(f"{API}/health")).json()["data"]
    reader_titles = " ".join(f["title"] for f in mine["data"])
    assert CONCEPT in reader_titles and "근거 없음" in reader_titles
    assert "405" not in reader_titles and "배터리 스웰링" not in reader_titles and "옛 해석 사례" not in reader_titles
    assert any("405" in f["title"] for f in wide["data"]) and any("배터리 스웰링" in f["title"] for f in wide["data"])
    assert mine["meta"]["last_run"]["scope"] == "full"
    assert denied.status_code == 403 and ok.status_code == 200
    assert queued.status_code == 201 and refused.status_code == 403
    assert health["last_lint"]["scope"] == "full" and health["last_lint"]["open"] >= 1

    # 사람이 근거를 달면 다음 점검이 닫는다 · 버린 것은 다시 열지 않는다 · 같은 결함은 한 줄(질문 · 메모가 늘지 않는다)
    async with session_scope() as s:
        await _cite(s, world["docs"]["org"], B["o2"], world["src"]["03"])
        questions_before = (await s.execute(text("SELECT COUNT(*) FROM wiki_questions WHERE text LIKE :t"),
                                            {"t": f"%{SUF}%"})).scalar_one()
    await _lint()
    second = await _findings(world)
    unc = next(f for f in second["uncited"] if f["doc_ids"] == [world["docs"]["org"]])
    assert unc["status"] == "fixed"
    assert next(f for f in second["orphan"] if f["id"] == orphan_id)["status"] == "dismissed"
    con1 = next(f for f in first["contradiction"] if f["detail"].get("kind") == "number")
    con2 = next(f for f in second["contradiction"] if f["id"] == con1["id"])
    assert con2["first_seen_at"] == con1["first_seen_at"] and con2["status"] == "question_raised"
    assert sum(len(v) for v in second.values()) == sum(len(v) for v in first.values())
    note = _section_text(await _content(P_AFF), "서로 다른 말")
    assert note.count("405 MPa") == 1
    async with session_scope() as s:
        questions_after = (await s.execute(text("SELECT COUNT(*) FROM wiki_questions WHERE text LIKE :t"),
                                           {"t": f"%{SUF}%"})).scalar_one()
        logs = {tuple(r[0]) for r in (await s.execute(text("""
            SELECT DISTINCT audience FROM wiki_log WHERE op = 'lint' AND title = 'full' AND at > NOW() - INTERVAL '5 minutes'
        """))).all()}
    assert questions_after == questions_before
    assert {("org",), ("aff:SYN-CAE1",), ("plat:plmdefect",)} <= logs  # 범위마다 한 줄


async def test_incremental_lint_follows_apply(world: dict[str, Any]) -> None:
    """반영 직후 작은 점검 — 그 묶음의 문서만, 문서 하나로 닫히는 규칙 넷. 점검 자신의 고침 묶음은 다시 점검을 부르지 않는다."""
    async with session_scope() as s:
        cs = str((await s.execute(text("""
            INSERT INTO wiki_changesets (op, status, audience, applied, plan)
            VALUES ('ingest', 'auto_applied', ARRAY['org'], CAST(:a AS jsonb), '{}'::jsonb) RETURNING id
        """), {"a": json.dumps({world["docs"]["org"]: [1, 2]})})).scalar_one())
    out = await _lint(scope="incremental", changeset_id=cs)
    try:
        assert out["scope"] == f"incremental:{cs}"
        got = await _findings(world)
        assert [f["doc_ids"] for f in got.get("uncited", [])] == [[world["docs"]["org"]]]
        assert "orphan" not in got and "contradiction" not in got  # 위키 전체 규칙은 밤에만
        async with session_scope() as s:
            follow = (await s.execute(text("""
                SELECT COUNT(*) FROM wiki_jobs j JOIN wiki_changesets c ON CAST(c.id AS text) = j.args ->> 'changeset_id'
                 WHERE j.op = 'lint' AND c.op = 'lint_fix' AND c.plan -> 'pages' -> 0 ->> 'slug' = :s
            """), {"s": P_ORG})).scalar_one()
        assert follow == 0
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM wiki_changesets WHERE id = CAST(:i AS uuid)"), {"i": cs})


async def test_worker_runs_lint_jobs(world: dict[str, Any]) -> None:
    async with session_scope() as s:
        job_id = await lint.enqueue(s, scope="docs", slugs=[P_ORG])
    while await worker.run_once(f"test-lint-{RUN}", ops=["lint"]):
        async with session_scope() as s:
            if (await s.execute(text("SELECT state FROM wiki_jobs WHERE id = CAST(:i AS uuid)"),
                                {"i": job_id})).scalar_one() != "queued":
                break
    async with session_scope() as s:
        state, result = (await s.execute(text("SELECT state, result FROM wiki_jobs WHERE id = CAST(:i AS uuid)"),
                                         {"i": job_id})).one()
        await s.execute(text("DELETE FROM wiki_jobs WHERE id = CAST(:i AS uuid)"), {"i": job_id})
    assert state == "done" and (result if isinstance(result, dict) else json.loads(result))["scope"] == "docs"


async def test_text_contradictions_use_the_llm_within_the_lint_budget(world: dict[str, Any], fake_llm: Any,
                                                                      monkeypatch: pytest.MonkeyPatch) -> None:
    """밤 점검의 글 모순 — 같은 AI 절에서 근거 원천이 다른 두 블록 짝을 LLM 이 본다. lint_tokens 가 차면 남은 문서는 세고 멈춘다."""
    st = get_settings()
    for key, value in (("wiki_llm_base_url", fake_llm.base_url), ("wiki_llm_model", fake_llm.model), ("wiki_llm_api_key", ""),
                       ("wiki_llm_structured", "json_schema")):
        monkeypatch.setattr(st, key, value)
    book = wiki_schema.RuleBook(version=0, spec=wiki_schema.DEFAULT.spec.model_copy(update={
        "budget": wiki_schema.DEFAULT.spec.budget.model_copy(update={"lint_tokens": 500})}))

    async def load(_s: Any) -> wiki_schema.RuleBook:
        return book

    monkeypatch.setattr(wiki_schema, "load", load)
    fake_llm.load({"rules": [{"match": {"schema": "wiki_lint_pairs"}, "reply": {
        "json": {"pairs": [{"id": "p1", "contradicts": True, "why": "판정이 위험과 안전으로 갈린다"}]},
        "usage": {"prompt_tokens": 900, "completion_tokens": 60}}}]})
    async with session_scope() as s:  # 둘째 엔티티 문서에도 짝 — 예산 500 은 첫 문서의 한 번(960)으로 찬다
        ent = await _entity(s, "part", f"배터리 팩 {SUF}")
        d2 = await _page(s, slug=f"ent-part-bat-l{RUN}", title=f"배터리 팩 {SUF}", type_key="part", kind="entity", aud=["org"],
                         entity=ent, blocks={"요약": [(pages.new_id(), "팩은 안전하다."), (pages.new_id(), "팩이 부푼다.")]})
        content = await s.execute(text("SELECT content_json FROM documents WHERE id = CAST(:d AS uuid)"), {"d": d2})
        blocks = (content.scalar_one() if not isinstance(content, str) else None)
        blocks = blocks if isinstance(blocks, dict) else json.loads(blocks)
        ids = [b["id"] for sec in blocks["sections"] for b in sec["blocks"]]
        await _cite(s, d2, ids[0], world["src"]["03"])
        await _cite(s, d2, ids[1], world["src"]["15"])
    out = await _lint(llm=True)
    got = await _findings(world)
    texts = [f for f in got.get("contradiction", []) if f["detail"].get("kind") == "text"]
    calls = [c for c in fake_llm.calls if c["body"].get("response_format", {}).get("json_schema", {}).get("name") == "wiki_lint_pairs"]
    assert len(calls) == 1 and out["counts"]["llm_tokens"] == 960  # 한 번 부르고 예산이 찼다
    assert len(texts) == 1 and texts[0]["status"] == "question_raised" and texts[0]["detail"]["why"].startswith("판정이")
    async with session_scope() as s:
        logged = (await s.execute(text("""
            SELECT detail FROM wiki_log WHERE op = 'lint' AND title = 'full' AND job_id IN
                   (SELECT job_id FROM wiki_lint_runs WHERE id = CAST(:r AS uuid)) AND audience = ARRAY['org']
        """), {"r": out["run"]})).scalar_one()
    logged = logged if isinstance(logged, dict) else json.loads(logged)
    assert logged["LLM"].endswith("· 남김 1")  # 짝이 있는 둘째 문서는 예산 때문에 남겼다(짝이 없는 문서는 LLM 없이 본 것으로 센다)
    assert "<<<짝" in calls[0]["body"]["messages"][-1]["content"]  # 블록 글은 데이터 구획 안


# ── 끝에서 끝 — 합성 원천 20 → 가짜 LLM 들이기 → 밤 점검(묶음에 심긴 모순 · 낡음 · 빈틈) ─────────────────

@pytest.fixture
async def ingested(monkeypatch: pytest.MonkeyPatch, fake_llm: Any) -> Any:
    st = get_settings()
    for key, value in (("wiki_enabled", True), ("wiki_llm_base_url", fake_llm.base_url), ("wiki_llm_model", fake_llm.model),
                       ("wiki_llm_api_key", ""), ("wiki_llm_structured", "json_schema")):
        monkeypatch.setattr(st, key, value)
    fake_llm.load("ingest-normal.json")
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        admin = await _user(s, "e2e", "admin")
    ids: dict[str, str] = {}

    async def drain() -> None:
        while await worker.run_once(f"test-lint-e2e-{RUN}", ops=["ingest"]):
            pass

    async with session_scope() as s:
        ids["01"] = (await sources.receive(s, SourceEnvelope.model_validate(_env("01")), caller=admin)).id
    await drain()  # 01 을 들인 뒤에 02 가 온다 — 01 의 사례 문서가 낡는다
    for i in range(2, 21):
        async with session_scope() as s:
            ids[f"{i:02d}"] = (await sources.receive(s, SourceEnvelope.model_validate(_env(f"{i:02d}")), caller=admin)).id
    await drain()
    yield ids
    await _cleanup({"stuck": None})


async def test_bundle_plants_are_caught_end_to_end(ingested: dict[str, str]) -> None:
    await _lint()
    got = await _findings({"src": ingested})
    pair = {ingested["02"], ingested["04"]}
    assert any(set(f["source_ids"]) == pair and f["detail"]["metric"] == "max_von_mises_stress"
               for f in got.get("contradiction", []))  # 모순
    assert any(ingested["01"] in f["source_ids"] and f["detail"]["reingest"] == [ingested["02"]]
               for f in got.get("stale", []))  # 낡음 — 01 을 들인 사례 문서
    assert any(f["detail"].get("kind") == "no_reproduction" and f["detail"]["name"] == f"배터리 스웰링 {SUF}"
               for f in got.get("gap", []))  # 빈틈
    assert not any(f["detail"].get("kind") == "no_reproduction" and "힌지 브래킷 균열" in f["detail"]["name"]
                   for f in got.get("gap", []))  # 해석이 있는 불량은 빈틈이 아니다


def test_comparable_ignores_numeric_settings_but_not_design_variants() -> None:
    def row(**cond: Any) -> lint.SimRow:
        return lint.SimRow(src=None, subject=("m", "p"), name="p", entity_ids=[], model="v3", conditions=cond,  # type: ignore[arg-type]
                           results={})
    base = {"scenario": "전각도 낙하", "drop_height": {"value": 1.5, "unit": "m"}}
    assert lint.comparable(row(**base, mesh_size={"value": 0.5, "unit": "mm"}), row(**base, mesh_size={"value": 1.0, "unit": "mm"}))
    assert not lint.comparable(row(**base), row(**base, design_variation="리브 추가"))
    assert not lint.comparable(row(**base), row(scenario="전각도 낙하", drop_height={"value": 1.2, "unit": "m"}))
    assert lint.comparable(row(**base, bracket_material="SUS304"), row(**base))  # 한쪽만 적은 조건은 모른다로
    assert not lint.identical(row(**base, mesh_size={"value": 0.5, "unit": "mm"}), row(**base, mesh_size={"value": 1.0, "unit": "mm"}))

