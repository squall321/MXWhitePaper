# 위키 엔티티 등록부 시험 — 보이기 · full(외부 id 는 만든 범위의 사람만) · 별칭 · 외부 id 충돌 · 중복 후보 · 합치기(검토 → 반영 → 되돌리기) · V4 · V7
"""docs/llm-wiki W5 — request §5-10 · CONTRACTS §2-6 · §4 `entity.merge`(늘 검토). 이름 · slug 에 이 실행의 꼬리(RUN)를 붙이고 끝에 지운다."""
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
from app.wiki import audience, resolve

RUN = uuid4().hex[:8]
API = "/api/v1/wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
AFF = ["aff:SYN-CAE1"]


async def _user(s: Any, name: str, role: str, *, aff: bool = False, reviewer: bool = False) -> dict[str, Any]:
    uid = str(uuid4())
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at, wiki_reviewer)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at, :rv)
    """), {"id": uid, "e": f"w5-ent-{RUN}-{name}@example.com", "n": f"W5 {name}", "pw": hash_password("x" * 16), "r": role,
           "a": "SYN-CAE1" if aff else None, "p": [] if aff else None, "at": datetime.now(UTC) if aff else None,
           "rv": reviewer})
    return {"id": uid, "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


async def _entity(s: Any, type_key: str, name: str, aud: list[str], ext: dict[str, str] | None = None,
                  aliases: list[str] | None = None) -> str:
    return str((await s.execute(text("""
        INSERT INTO wiki_entities (type_key, canonical_name, aliases, ext_ids, audience)
        VALUES (:t, :n, CAST(:al AS text[]), CAST(:x AS jsonb), CAST(:a AS text[])) RETURNING id
    """), {"t": type_key, "n": name, "al": aliases or [], "x": json.dumps(ext or {}), "a": aud})).scalar_one())


async def _page(s: Any, slug: str, title: str, aud: list[str], entity: str) -> None:
    owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
    doc_id = (await s.execute(text("""
        INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
        VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o) RETURNING id
    """), {"slug": slug, "t": title, "c": json.dumps({**BASE, "slug": slug, "title": title}, ensure_ascii=False),
           "o": owner})).scalar_one()
    await s.execute(text("""
        INSERT INTO wiki_pages (doc_id, kind, managed, audience, entity_id) VALUES (:d, 'entity', 'ai', CAST(:a AS text[]), CAST(:e AS uuid))
    """), {"d": doc_id, "a": aud, "e": entity})


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    async with session_scope() as s:
        w: dict[str, Any] = {
            "reader": await _user(s, "reader", "reader"), "aff": await _user(s, "aff", "reader", aff=True),
            "editor": await _user(s, "editor", "editor"), "aff_editor": await _user(s, "affed", "editor", aff=True),
            "reviewer": await _user(s, "reviewer", "editor", aff=True, reviewer=True),
        }
        w["e1"] = await _entity(s, "part", f"힌지 브래킷 {RUN}", ["org"], {"bom_code": f"B1-{RUN}"})
        # 띄어쓰기만 다른 같은 개체(예전 해석이 만든 중복) — 별칭 하나를 가졌다
        w["e2"] = await _entity(s, "part", f"힌지브래킷 {RUN}", ["org"], aliases=[f"HB01 {RUN}"])
        w["e3"] = await _entity(s, "part", f"비밀 부품 {RUN}", AFF, {"bom_code": f"B3-{RUN}"})
        w["e4"] = await _entity(s, "material", f"SUS301 {RUN}", ["org"])
        w["e5"] = await _entity(s, "part", f"커버 글라스 {RUN}", ["org"])
        for key, slug, aud in (("e1", f"ent-part-e1{RUN}", ["org"]), ("e1", f"ent-part-e1{RUN}--syn-cae1", AFF),
                               ("e2", f"ent-part-e2{RUN}", ["org"]), ("e3", f"ent-part-e3{RUN}--syn-cae1", AFF),
                               ("e4", f"ent-mat-e4{RUN}", ["org"]), ("e5", f"ent-part-e5{RUN}", ["org"])):
            await _page(s, slug, f"엔티티 시험 {slug}", aud, w[key])
        await s.commit()
    yield w
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        cs = [str(r[0]) for r in (await s.execute(text("""
            SELECT id FROM wiki_changesets WHERE created_by IN (SELECT id FROM users WHERE email LIKE :e)
        """), {"e": f"w5-ent-{RUN}-%"})).all()]
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE changeset_id = ANY(CAST(:c AS uuid[])) OR title LIKE :t"),
                        {"c": cs, "t": f"%{RUN}%"})
        await s.execute(text("DELETE FROM wiki_changesets WHERE id = ANY(CAST(:c AS uuid[]))"), {"c": cs})
        await s.execute(text("DELETE FROM documents WHERE slug LIKE :p"), {"p": f"%{RUN}%"})
        await s.execute(text("UPDATE wiki_entities SET merged_into = NULL WHERE canonical_name LIKE :n"), {"n": f"%{RUN}"})
        await s.execute(text("DELETE FROM wiki_entities WHERE canonical_name LIKE :n"), {"n": f"%{RUN}"})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w5-ent-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w5-ent-{RUN}-%"})


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_list_and_visibility(world: dict[str, Any]) -> None:
    async with _client() as c:
        plain = {e["id"]: e for e in (await c.get(f"{API}/entities", params={"q": RUN, "limit": 50},
                                                  headers=world["reader"]["headers"])).json()["data"]}
        aff = {e["id"]: e for e in (await c.get(f"{API}/entities", params={"q": RUN, "type": "part"},
                                                headers=world["aff"]["headers"])).json()["data"]}
        hidden = await c.get(f"{API}/entities/{world['e3']}", headers=world["reader"]["headers"])
        one = (await c.get(f"{API}/entities/{world['e3']}", headers=world["aff"]["headers"])).json()["data"]
    assert set(plain) == {world[k] for k in ("e1", "e2", "e4", "e5")}  # 좁은 문서뿐인 e3 는 안 보인다
    assert plain[world["e1"]]["full"] is True and plain[world["e1"]]["ext_ids"] == {"bom_code": f"B1-{RUN}"}
    assert [p["slug"] for p in plain[world["e1"]]["pages"]] == [f"ent-part-e1{RUN}"]  # 좁은 문서는 목록에도 없다
    assert set(aff) == {world[k] for k in ("e1", "e2", "e3", "e5")} and len(aff[world["e1"]]["pages"]) == 2
    assert hidden.status_code == 404
    assert one["full"] is True and one["ext_ids"] == {"bom_code": f"B3-{RUN}"}


async def test_edit_aliases_and_ext_ids(world: dict[str, Any]) -> None:
    ed = world["editor"]["headers"]
    async with _client() as c:
        ok = await c.patch(f"{API}/entities/{world['e1']}", json={"aliases": [f"HB 브래킷 {RUN}", f"힌지  브래킷 {RUN}"]}, headers=ed)
        clash_alias = await c.patch(f"{API}/entities/{world['e5']}", json={"aliases": [f"힌지-브래킷 {RUN}"]}, headers=ed)
        clash_ext = await c.patch(f"{API}/entities/{world['e2']}", json={"ext_ids": {"bom_code": f"B1-{RUN}"}}, headers=ed)
        bad_key = await c.patch(f"{API}/entities/{world['e2']}", json={"ext_ids": {"BOM": "x"}}, headers=ed)
        narrow = await c.patch(f"{API}/entities/{world['e3']}", json={"aliases": ["x"]}, headers=ed)
        reader = await c.patch(f"{API}/entities/{world['e1']}", json={"aliases": []}, headers=world["reader"]["headers"])
    assert ok.status_code == 200, ok.text
    assert ok.json()["data"]["aliases"] == [f"HB 브래킷 {RUN}"]  # 제 이름과 같은 열쇠의 별칭은 버린다
    assert clash_alias.status_code == 409 and clash_ext.status_code == 409
    assert bad_key.status_code == 422 and narrow.status_code == 404 and reader.status_code == 403


async def test_merge_review_apply_revert(world: dict[str, Any]) -> None:
    rv, ed = world["reviewer"]["headers"], world["editor"]["headers"]
    async with _client() as c:
        assert (await c.get(f"{API}/entities/duplicates", headers=world["reader"]["headers"])).status_code == 403
        dups = (await c.get(f"{API}/entities/duplicates", headers=rv)).json()["data"]
        pair = next(d for d in dups if {d["a"]["id"], d["b"]["id"]} == {world["e1"], world["e2"]})
        assert pair["why"] == "name"
        r = await c.post(f"{API}/entities/merge", json={"from_id": world["e2"], "into_id": world["e1"], "note": "띄어쓰기만 다르다"},
                         headers=ed)
        assert r.status_code == 201, r.text
        cs = r.json()["data"]
        assert cs["status"] == "pending_review" and {v["rule"]: v["verdict"] for v in cs["validation"]}["V6"] == "review"
        detail = (await c.get(f"{API}/changes/{cs['id']}", headers=rv)).json()["data"]
        assert detail["merges"][0]["from"]["name"] == f"힌지브래킷 {RUN}" and detail["merges"][0]["applied"] is None
        ok = await c.post(f"{API}/changes/{cs['id']}/approve", headers=rv, json={"note": "같은 부품"})
        assert ok.status_code == 200, ok.text
        e1 = (await c.get(f"{API}/entities/{world['e1']}", headers=ed)).json()["data"]
        dups = (await c.get(f"{API}/entities/duplicates", headers=rv)).json()["data"]
    # 별칭은 옮겨 오고, 열쇠가 e1 이름과 같은 e2 이름은 굳이 별칭으로 두지 않는다(해석이 띄어쓰기를 지워 이름으로 맞춘다)
    assert e1["aliases"] == [f"HB01 {RUN}"] and e1["merged_from"] == [{"id": world["e2"], "name": f"힌지브래킷 {RUN}"}]
    assert {p["slug"]: bool(p["stale_since"]) for p in e1["pages"]} == {f"ent-part-e1{RUN}": False, f"ent-part-e2{RUN}": True}
    assert not any({d["a"]["id"], d["b"]["id"]} == {world["e1"], world["e2"]} for d in dups)  # 합친 뒤 중복 0
    async with session_scope() as s:
        st = (await s.execute(text("SELECT status, merged_into::text FROM wiki_entities WHERE id = CAST(:i AS uuid)"),
                              {"i": world["e2"]})).one()
        with audience.acting_as(audience.SYSTEM):
            got = await resolve.targets(s, {"id": str(uuid4()), "kind": "qa", "audience": ["org"], "payload": {},
                                            "subject_hints": [{"type": "part", "name": f"힌지브래킷 {RUN}"}]})
    assert tuple(st) == ("merged", world["e1"])
    assert [(t.slug, t.entity_id) for t in got] == [(f"ent-part-e1{RUN}", world["e1"])]  # 옮겨 온 낡은 문서가 아니라 원래 문서

    async with _client() as c:
        back = await c.post(f"{API}/changes/{cs['id']}/revert", headers=rv)
        assert back.status_code == 200, back.text
        e2 = (await c.get(f"{API}/entities/{world['e2']}", headers=ed)).json()["data"]
        e1 = (await c.get(f"{API}/entities/{world['e1']}", headers=ed)).json()["data"]
    assert e2["status"] == "active" and [(p["slug"], p["stale_since"]) for p in e2["pages"]] == [(f"ent-part-e2{RUN}", None)]
    assert e1["aliases"] == [] and e1["merged_from"] == []


async def test_merge_checks_fail(world: dict[str, Any]) -> None:
    async with _client() as c:
        narrow = await c.post(f"{API}/entities/merge", json={"from_id": world["e3"], "into_id": world["e1"]},
                              headers=world["aff_editor"]["headers"])
        types = await c.post(f"{API}/entities/merge", json={"from_id": world["e4"], "into_id": world["e1"]},
                             headers=world["editor"]["headers"])
        unseen = await c.post(f"{API}/entities/merge", json={"from_id": world["e3"], "into_id": world["e1"]},
                              headers=world["editor"]["headers"])
        approve = await c.post(f"{API}/changes/{types.json()['data']['id']}/approve", headers=world["reviewer"]["headers"])
    verdicts = {v["rule"]: v["verdict"] for v in narrow.json()["data"]["validation"]}
    assert narrow.json()["data"]["status"] == "failed" and verdicts["V4"] == "fail"  # 좁은 엔티티를 넓은 엔티티로 — 샌다
    assert types.json()["data"]["status"] == "failed" and "유형이 다르다" in json.dumps(types.json()["data"], ensure_ascii=False)
    assert unseen.status_code == 404 and approve.status_code == 409
