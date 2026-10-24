# 위키 제안 시험 — 기계 호출(API 토큰 · 위임)은 위키 문서를 직접 못 고친다(409) · wiki_propose 는 늘 검토 · 승인하면 반영 · 검증 실패 · 범위
"""docs/llm-wiki W6 — CONTRACTS §7 `wiki_propose`(바깥 에이전트의 쓰기는 늘 검토) · '기존 쓰기 도구는 위키 문서 거부'."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest
import ulid
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core import auth
from app.core.config import get_settings
from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app
from app.search import meili_indexer
from app.wiki import audience, sources
from app.wiki.envelope import SourceEnvelope

RUN = uuid4().hex[:8]
API = "/api/v1/wiki"
FIX = Path(__file__).parent / "fixtures" / "wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
PREFIX = f"w6-prop-{RUN}"
PAGE = f"ent-part-p{RUN}"
B1, B9, H1 = (str(ulid.new()) for _ in range(3))  # 블록 id 는 ULID 꼴이어야 한다(V1)


async def _user(s: Any, name: str, role: str, *, aff: str | None = None, reviewer: bool = False) -> dict[str, Any]:
    uid = str(uuid4())
    email = f"{PREFIX}-{name}@example.com"
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at, wiki_reviewer)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at, :rv)
    """), {"id": uid, "e": email, "n": f"W6 {name}", "pw": hash_password("x" * 16), "r": role, "a": aff,
           "p": [] if aff else None, "at": datetime.now(UTC) if aff else None, "rv": reviewer})
    return {"id": uid, "email": email, "role": role, "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


async def _doc(s: Any, slug: str, *, wiki: list[str] | None, block: str) -> str:
    owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
    content = {**BASE, "slug": slug, "title": f"제안 시험 {slug}", "sections": [{
        **BASE["sections"][0], "id": str(ulid.new()), "title": "요약", "subsections": [],
        "blocks": [{"type": "paragraph", "id": block, "text": "최대 응력은 아직 모른다."}]}]}
    doc_id = str((await s.execute(text("""
        INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
        VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o) RETURNING id
    """), {"slug": slug, "t": content["title"], "c": json.dumps(content, ensure_ascii=False), "o": owner})).scalar_one())
    if wiki:
        await s.execute(text("""
            INSERT INTO wiki_pages (doc_id, kind, managed, audience) VALUES (:d, 'entity', 'ai', CAST(:a AS text[]))
        """), {"d": doc_id, "a": wiki})
    return doc_id


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        w = {"editor": await _user(s, "editor", "editor"), "reviewer": await _user(s, "reviewer", "editor", reviewer=True),
             "admin": await _user(s, "admin", "admin")}
        for name, fixture in (("org", "03-sim-stcx-job0002-rib.json"), ("aff", "01-sim-stcx-job0001-r1.json")):
            env = json.loads((FIX / "sources" / fixture).read_text(encoding="utf-8"))
            env["origin"]["ref"] = f"{PREFIX}-{name}"
            env["owner"] = {"email": w["admin"]["email"]}
            w[f"src_{name}"] = (await sources.receive(s, SourceEnvelope.model_validate(env), caller=w["admin"], ingest=False)).id
    async with session_scope() as s:
        await _doc(s, PAGE, wiki=["org"], block=B1)
        await _doc(s, f"{PAGE}--syn-cae1", wiki=["aff:SYN-CAE1"], block=B9)
        await _doc(s, f"plain-p{RUN}", wiki=None, block=H1)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post("/api/v1/me/api-tokens", headers=w["editor"]["headers"], json={"name": f"{PREFIX}", "scopes": ["write"]})
        w["pat"] = {"Authorization": f"Bearer {r.json()['data']['token']}"}
    yield w
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        cs = [str(r[0]) for r in (await s.execute(text("""
            SELECT id FROM wiki_changesets WHERE created_by IN (SELECT id FROM users WHERE email LIKE :e)
        """), {"e": f"{PREFIX}-%"})).all()]
        src = [w["src_org"], w["src_aff"]]
        docs = [str(r[0]) for r in (await s.execute(text("""
            SELECT id FROM documents WHERE slug LIKE :p OR slug = :plain
            UNION SELECT doc_id FROM wiki_sources WHERE id = ANY(CAST(:i AS uuid[])) AND doc_id IS NOT NULL
        """), {"p": f"{PAGE}%", "plain": f"plain-p{RUN}", "i": src})).all()]
        await s.execute(text("DELETE FROM wiki_citations WHERE source_id = ANY(CAST(:i AS uuid[]))"), {"i": src})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE changeset_id = ANY(CAST(:c AS uuid[]))"), {"c": cs})
        await s.execute(text("DELETE FROM wiki_changesets WHERE id = ANY(CAST(:c AS uuid[]))"), {"c": cs})
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[]))"), {"d": docs})
        await s.execute(text("DELETE FROM wiki_sources WHERE id = ANY(CAST(:i AS uuid[]))"), {"i": src})
        for table in ("api_tokens", "audit_logs"):
            await s.execute(text(f"DELETE FROM {table} WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                            {"e": f"{PREFIX}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"{PREFIX}-%"})
    for d in docs:
        meili_indexer.delete_document(d)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _update(text_: str, sid: str) -> dict[str, Any]:
    return {"op": "block.update", "doc": PAGE, "block_id": B1, "block": {"type": "paragraph", "text": text_},
            "cites": [{"sid": sid, "loc": {"path": "/results/0"}}], "why": "해석 결과를 옮긴다."}


async def test_machine_calls_cannot_write_wiki_pages(world: dict[str, Any]) -> None:
    async with _client() as c:
        pat_wiki = await c.patch(f"/api/v1/documents/{PAGE}/title", headers=world["pat"], json={"title": "바꿈"})
        pat_block = await c.delete(f"/api/v1/documents/{PAGE}/blocks/{B1}", headers=world["pat"])
        pat_plain = await c.patch(f"/api/v1/documents/plain-p{RUN}/title", headers=world["pat"], json={"title": "바꿈"})
        web_wiki = await c.patch(f"/api/v1/documents/{PAGE}/title", headers=world["editor"]["headers"], json={"title": "바꿈"})
        pat_view = await c.post(f"/api/v1/documents/{PAGE}/view", headers=world["pat"])
    assert pat_wiki.status_code == 409 and pat_wiki.json()["error"]["code"] == "WIKI_USE_PROPOSE"
    assert pat_block.status_code == 409
    assert pat_plain.status_code != 409 and web_wiki.status_code != 409 and pat_view.status_code != 409  # 사람 문서 · 웹 세션 · 곁길
    req = SimpleNamespace(method="PUT", url=SimpleNamespace(path=f"/api/v1/documents/{PAGE}"))
    async with session_scope() as s:
        with pytest.raises(auth.WikiPageWrite):
            await auth._guard_wiki_writes(s, req, {"auth_via": "delegated:gateway"})  # type: ignore[arg-type]


async def test_propose_is_always_reviewed_and_applies(world: dict[str, Any]) -> None:
    sid = sources.short_id(world["src_org"])
    async with _client() as c:
        r = await c.post(f"{API}/propose", headers=world["pat"],
                         json={"summary": "리브 추가안의 최대 응력을 적는다.", "ops": [_update("최대 응력은 338 MPa 다.", sid)]})
        assert r.status_code == 201, r.text
        cs = r.json()["data"]
        assert cs["status"] == "pending_review", cs["validation"]
        v6 = next(c_ for c_ in cs["validation"] if c_["rule"] == "V6")
        assert v6["verdict"] == "review" and "바깥 제안은 늘 검토" in v6["detail"]
        detail = (await c.get(f"{API}/changes/{cs['id']}", headers=world["reviewer"]["headers"])).json()["data"]
        assert detail["docs"][0]["ops"][0]["after"] == "최대 응력은 338 MPa 다."
        ok = await c.post(f"{API}/changes/{cs['id']}/approve", headers=world["reviewer"]["headers"], json={})
        assert ok.status_code == 200, ok.text
        doc = (await c.get(f"/api/v1/documents/{PAGE}", headers=world["editor"]["headers"], params={"with": "citations"})).json()["data"]
    block = doc["content"]["sections"][0]["blocks"][0]
    assert block["text"] == "최대 응력은 338 MPa 다." and doc["citations"][block["id"]][0]["source_id"] == world["src_org"]


async def test_propose_checks(world: dict[str, Any]) -> None:
    async with _client() as c:
        invented = await c.post(f"{API}/propose", headers=world["pat"],
                                json={"summary": "x", "ops": [_update("최대 응력은 999 MPa 다.", sources.short_id(world["src_org"]))]})
        unseen_src = await c.post(f"{API}/propose", headers=world["pat"],
                                  json={"summary": "x", "ops": [_update("최대 응력은 412 MPa 다.", sources.short_id(world["src_aff"]))]})
        narrow = await c.post(f"{API}/propose", headers=world["pat"], json={"summary": "x", "ops": [
            {**_update("좁은 값.", sources.short_id(world["src_org"])), "doc": f"{PAGE}--syn-cae1", "block_id": B9}]})
        reader = await c.post(f"{API}/propose", headers=world["admin"]["headers"] | {}, json={"summary": "x", "ops": []})
    assert invented.json()["data"]["status"] == "failed" and {v["rule"]: v["verdict"] for v in invented.json()["data"]["validation"]}["V3"] == "fail"
    assert {v["rule"]: v["verdict"] for v in unseen_src.json()["data"]["validation"]}["V2"] == "fail"  # 못 보는 원천은 근거가 아니다
    assert narrow.status_code == 422  # 볼 수 없는 문서
    assert reader.status_code == 422  # 연산이 없다
