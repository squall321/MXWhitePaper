# 위키 온톨로지 시험 — 첫 판(유형 14 · 술어 18) · 제안 → admin 승인 · 거절(까닭 꼭) · 술어의 정의역 · 치역 · 지운 문서의 triple · 위키 관계는 읽기만
"""docs/llm-wiki W5 — CONTRACTS §2-6 · request §5-10. 시험이 만든 유형 · 술어 key 는 `t<RUN>` 으로 시작하고 끝에 지운다(기록 줄도)."""
from __future__ import annotations

import json
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
from app.wiki import ontology

RUN = uuid4().hex[:8]
API = "/api/v1/wiki"
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))
FIRST_TYPES = {"product-model", "project", "dev-stage", "part", "supplier", "material", "failure-mode", "mechanism",
               "field-case", "sim-case", "sim-type", "reliability-test", "countermeasure", "concept"}


async def _user(s: Any, name: str, role: str) -> dict[str, str]:
    uid = str(uuid4())
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role) VALUES (CAST(:id AS uuid), :e, :n, :pw, :r)
    """), {"id": uid, "e": f"w5-ont-{RUN}-{name}@example.com", "n": f"W5 {name}", "pw": hash_password("x" * 16), "r": role})
    return {"Authorization": f"Bearer {make_access_token(uid)}"}


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


@pytest.fixture
async def heads(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    async with session_scope() as s:
        out = {r: await _user(s, r, r) for r in ("reader", "editor", "admin")}
    yield out
    async with session_scope() as s:
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE op = 'ontology' AND detail->>'key' LIKE :k"), {"k": f"t{RUN}%"})
        await s.execute(text("DELETE FROM wiki_predicates WHERE key LIKE :k"), {"k": f"t{RUN}%"})
        await s.execute(text("DELETE FROM wiki_entity_types WHERE key LIKE :k"), {"k": f"t{RUN}%"})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w5-ont-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w5-ont-{RUN}-%"})


async def test_first_edition(heads: dict[str, dict[str, str]]) -> None:
    async with _client() as c:
        r = await c.get(f"{API}/ontology", params={"status": "approved"}, headers=heads["reader"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert {t["key"] for t in data["types"]} >= FIRST_TYPES
    part = next(t for t in data["types"] if t["key"] == "part")
    assert "bom_code" in part["ext_axes"]["ext_ids"]
    preds = {p["key"]: p for p in data["predicates"]}
    assert len({k for k in preds if not k.startswith(f"t{RUN}")}) >= 18
    assert preds["part-of"]["domain_types"] == ["part"] and preds["part-of"]["range_types"] == ["part", "product-model"]
    assert preds["correlates-with"]["symmetric"] is True


async def test_type_propose_approve_reject(heads: dict[str, dict[str, str]]) -> None:
    body = {"key": f"t{RUN}-fixture", "label_ko": "지그", "abbr": f"t{RUN}", "ext_axes": {"ext_ids": ["ra_entity"]}}
    async with _client() as c:
        assert (await c.post(f"{API}/ontology/types", json=body, headers=heads["reader"])).status_code == 403
        r = await c.post(f"{API}/ontology/types", json=body, headers=heads["editor"])
        assert r.status_code == 201, r.text
        assert r.json()["data"]["status"] == "proposed"
        assert (await c.post(f"{API}/ontology/types", json=body, headers=heads["editor"])).status_code == 409
        same_abbr = {**body, "key": f"t{RUN}-other"}
        assert (await c.post(f"{API}/ontology/types", json=same_abbr, headers=heads["editor"])).status_code == 409
        orphan = {**body, "key": f"t{RUN}-child", "abbr": f"u{RUN}", "parent_key": f"t{RUN}-fixture"}
        assert (await c.post(f"{API}/ontology/types", json=orphan, headers=heads["editor"])).status_code == 422  # 상위가 아직 제안

        key = body["key"]
        assert (await c.post(f"{API}/ontology/types/{key}/approve", headers=heads["editor"])).status_code == 403
        r = await c.post(f"{API}/ontology/types/{key}/approve", headers=heads["admin"])
        assert r.status_code == 200, r.text
        assert r.json()["data"]["status"] == "approved"
        assert (await c.post(f"{API}/ontology/types/{key}/approve", headers=heads["admin"])).status_code == 409
        r = await c.post(f"{API}/ontology/types", json=orphan, headers=heads["editor"])
        assert r.status_code == 201, r.text  # 상위가 승인된 뒤엔 된다

        child = orphan["key"]
        assert (await c.post(f"{API}/ontology/types/{child}/reject", json={"note": " "}, headers=heads["admin"])).status_code == 422
        r = await c.post(f"{API}/ontology/types/{child}/reject", json={"note": "지그와 겹친다"}, headers=heads["admin"])
        assert r.status_code == 200, r.text
        assert r.json()["data"]["status"] == "rejected" and r.json()["data"]["decision_note"] == "지그와 겹친다"
        rejected = (await c.get(f"{API}/ontology", params={"status": "rejected"}, headers=heads["reader"])).json()["data"]
    assert child in {t["key"] for t in rejected["types"]}
    async with session_scope() as s:
        assert key in await ontology.approved_types(s) and child not in await ontology.approved_types(s)
        actions = [r[0] for r in (await s.execute(text("""
            SELECT detail->>'action' FROM wiki_log WHERE op = 'ontology' AND detail->>'key' LIKE :k ORDER BY id
        """), {"k": f"t{RUN}%"})).all()]
    assert actions == ["propose", "approve", "propose", "reject"]


async def test_predicate_propose_needs_approved_types(heads: dict[str, dict[str, str]]) -> None:
    body = {"key": f"t{RUN}-made-of", "label_ko": "로 만든다", "inverse_ko": "로 만든 것이다",
            "domain_types": ["part"], "range_types": ["nope-type"]}
    async with _client() as c:
        r = await c.post(f"{API}/ontology/predicates", json=body, headers=heads["editor"])
        assert r.status_code == 422 and r.json()["error"]["details"]["unknown_types"] == ["nope-type"]
        r = await c.post(f"{API}/ontology/predicates", json={**body, "range_types": ["material"]}, headers=heads["editor"])
        assert r.status_code == 201, r.text
        async with session_scope() as s:
            assert body["key"] not in await ontology.predicates(s)  # 제안은 들이기가 쓰지 않는다
        r = await c.post(f"{API}/ontology/predicates/{body['key']}/approve", headers=heads["admin"])
        assert r.status_code == 200, r.text
    async with session_scope() as s:
        pred = (await ontology.predicates(s))[body["key"]]
    assert pred.fits("part", "material") and not pred.fits("material", "part")


async def test_predicate_fits() -> None:
    async with session_scope() as s:
        preds = await ontology.predicates(s)
    assert preds["part-of"].fits("part", "product-model") and preds["part-of"].fits("part", "part")
    assert not preds["part-of"].fits("part", "material")
    assert preds["correlates-with"].fits("field-case", "sim-case") and preds["correlates-with"].fits("sim-case", "field-case")
    assert preds["same-as"].fits("part", "part") and not preds["same-as"].fits("part", "material")
    assert preds["observed-in"].fits("failure-mode", "field-case") and not preds["observed-in"].fits("field-case", "failure-mode")


async def test_deleted_document_takes_its_triples(heads: dict[str, dict[str, str]]) -> None:
    slugs = [f"t{RUN}-a", f"t{RUN}-b"]
    async with session_scope() as s:
        owner = (await s.execute(text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1"))).scalar_one()
        for slug in slugs:
            await s.execute(text("""
                INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
                VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), :o)
            """), {"slug": slug, "t": f"온톨로지 시험 {slug}", "c": json.dumps({**BASE, "slug": slug}, ensure_ascii=False),
                   "o": owner})
        for i, (src, pkey, status) in enumerate((("manual", None, None), ("wiki", "part-of", "accepted"),
                                                  ("wiki", "has-failure-mode", "retired"))):
            await s.execute(text("""
                INSERT INTO doc_triples (id, subject_slug, predicate, object_slug, source, predicate_key, wiki_status)
                VALUES (:id, :a, :p, :b, :src, :k, :st)
            """), {"id": f"t{RUN}{i}", "a": slugs[0], "p": f"관계 {i}", "b": slugs[1], "src": src, "k": pkey, "st": status})
    try:
        async with _client() as c:
            r = await c.get("/api/v1/triples", params={"subject": slugs[0]}, headers=heads["admin"])
            assert r.status_code == 200, r.text
            got = {t["id"]: t for t in r.json()["data"]}
            assert set(got) == {f"t{RUN}0", f"t{RUN}1"}  # 내린 관계는 내지 않는다
            assert got[f"t{RUN}1"]["predicate_key"] == "part-of" and got[f"t{RUN}1"]["wiki_status"] == "accepted"
            wiki_only = (await c.get("/api/v1/triples", params={"subject": slugs[0], "source": "wiki"},
                                     headers=heads["admin"])).json()["data"]
            assert [t["id"] for t in wiki_only] == [f"t{RUN}1"]
            r = await c.delete(f"/api/v1/triples/t{RUN}1", headers=heads["admin"])
            assert r.status_code == 409, r.text  # 위키 관계는 묶음으로만
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM documents WHERE slug = :s"), {"s": slugs[1]})
            left = (await s.execute(text("SELECT count(*) FROM doc_triples WHERE id LIKE :p"), {"p": f"t{RUN}%"})).scalar()
            await s.execute(text("DELETE FROM documents WHERE slug = :s"), {"s": slugs[0]})
    assert left == 0  # 목적어 문서가 지워지면 그 triple 도 간다
