# 위키 후보 시험 — 동의 candidate 원천은 주인만(admin 도 못 봄) · held · 승인하면 고른 범위의 새 원천을 들인다 · 나만 · 버리기 · 기한
"""docs/llm-wiki W6 — request §6-3(Q1 B 후보 + 한 번 승인) · 0058(멱등 열쇠에 범위). 포털 P7 이 보내는 꼴을 그대로 쓴다."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
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
from app.wiki import audience, candidates, sources

RUN = uuid4().hex[:8]
API = "/api/v1/wiki"
FIX = Path(__file__).parent / "fixtures" / "wiki"
PREFIX = f"w6-cand-{RUN}"


async def _user(s: Any, name: str, role: str, *, aff: str | None = None) -> dict[str, Any]:
    uid = str(uuid4())
    email = f"{PREFIX}-{name}@example.com"
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at)
    """), {"id": uid, "e": email, "n": f"W6 {name}", "pw": hash_password("x" * 16), "r": role, "a": aff,
           "p": [] if aff else None, "at": datetime.now(UTC) if aff else None})
    return {"id": uid, "email": email, "role": role, "headers": {"Authorization": f"Bearer {make_access_token(uid)}"}}


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    async with session_scope() as s:
        w = {"owner": await _user(s, "owner", "editor", aff="SYN-CAE1"), "other": await _user(s, "other", "editor", aff="SYN-CAE1"),
             "admin": await _user(s, "admin", "admin")}
    yield w
    audience.set_viewer(audience.SYSTEM)
    async with session_scope() as s:
        ids = [str(r[0]) for r in (await s.execute(text("SELECT id FROM wiki_sources WHERE origin_ref LIKE :p"),
                                                   {"p": f"{PREFIX}-%"})).all()]
        docs = [str(r[0]) for r in (await s.execute(text(
            "SELECT doc_id FROM wiki_sources WHERE id = ANY(CAST(:i AS uuid[])) AND doc_id IS NOT NULL"), {"i": ids})).all()]
        await s.execute(text("DELETE FROM wiki_jobs WHERE args ->> 'source_id' = ANY(:i)"), {"i": ids})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE title LIKE ANY(:t) OR detail ->> 'source_id' = ANY(:i)"),
                        {"t": [f"%({sources.short_id(i)})" for i in ids], "i": ids})
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[]))"), {"d": docs})
        # 앞 줄을 가리키는 새 줄(승인)부터 — supersedes_id 는 불변이라 비우지 못한다
        await s.execute(text("DELETE FROM wiki_sources WHERE id = ANY(CAST(:i AS uuid[])) AND supersedes_id IS NOT NULL"), {"i": ids})
        await s.execute(text("DELETE FROM wiki_sources WHERE id = ANY(CAST(:i AS uuid[]))"), {"i": ids})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"{PREFIX}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"{PREFIX}-%"})
    for d in docs:
        meili_indexer.delete_document(d)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _envelope(who: dict[str, Any], name: str, *, owner: str | None = None) -> dict[str, Any]:
    env = json.loads((FIX / "sources" / "13-qa-hinge-origin.json").read_text(encoding="utf-8"))  # aff:SYN-CAE1 문답
    env["origin"]["ref"] = f"{PREFIX}-{name}"
    env["owner"] = {"email": owner or who["email"]}
    env["consent"] = {"by": owner or who["email"], "at": datetime.now(UTC).isoformat(), "mode": "candidate"}
    return env


async def _send(who: dict[str, Any], name: str, **kw: Any) -> Any:
    async with _client() as c:
        return await c.post(f"{API}/sources", headers=who["headers"], json=_envelope(who, name, **kw))


async def _row(source_id: str) -> Any:
    async with session_scope() as s:
        return (await s.execute(text("""
            SELECT audience, ingest_state, status, consent, supersedes_id::text FROM wiki_sources WHERE id = CAST(:i AS uuid)
        """), {"i": source_id})).one()


async def test_candidate_is_held_and_only_the_owner_sees_it(world: dict[str, Any]) -> None:
    r = await _send(world["owner"], "a")
    assert r.status_code == 201, r.text
    sid = r.json()["data"]["id"]
    assert r.json()["data"]["ingest_state"] == "held"
    row = await _row(sid)
    consent = json.loads(row[3]) if isinstance(row[3], str) else row[3]
    assert list(row[0]) == [f"user:{world['owner']['id']}"] and consent["suggested_audience"] == ["aff:SYN-CAE1"]
    async with _client() as c:
        seen = {k: (await c.get(f"{API}/sources/{sid}", headers=world[k]["headers"])).status_code for k in ("owner", "other", "admin")}
        mine = (await c.get(f"{API}/candidates", headers=world["owner"]["headers"])).json()["data"]
        theirs = (await c.get(f"{API}/candidates", headers=world["other"]["headers"])).json()["data"]
        listed = (await c.get(f"{API}/sources", headers=world["admin"]["headers"], params={"limit": 200})).json()["data"]
    assert seen == {"owner": 200, "other": 404, "admin": 404}  # 후보는 주인만 — admin 도 못 본다
    assert [x["id"] for x in mine] == [sid] and mine[0]["suggested_audience"] == ["aff:SYN-CAE1"] and theirs == []
    assert sid not in {x["id"] for x in listed}


async def test_approve_ingests_in_the_chosen_scope(world: dict[str, Any]) -> None:
    sid = (await _send(world["owner"], "b")).json()["data"]["id"]
    async with _client() as c:
        stranger = await c.post(f"{API}/candidates/{sid}/approve", headers=world["other"]["headers"], json={})
        ok = await c.post(f"{API}/candidates/{sid}/approve", headers=world["owner"]["headers"], json={})
        after = (await c.get(f"{API}/candidates", headers=world["owner"]["headers"])).json()["data"]
    assert stranger.status_code == 404
    assert ok.status_code == 200, ok.text
    new = ok.json()["data"]
    assert new["id"] != sid and new["audience"] == ["aff:SYN-CAE1"] and after == []
    fresh, old = await _row(new["id"]), await _row(sid)
    assert (list(fresh[0]), fresh[1], fresh[2], fresh[4]) == (["aff:SYN-CAE1"], "queued", "active", sid)
    assert old[2] == "superseded"
    async with session_scope() as s:
        job = (await s.execute(text("SELECT op, state FROM wiki_jobs WHERE args ->> 'source_id' = :i"), {"i": new["id"]})).one()
    assert tuple(job) == ("ingest", "queued")


async def test_approve_just_for_me_and_discard_and_expire(world: dict[str, Any]) -> None:
    me = f"user:{world['owner']['id']}"
    a = (await _send(world["owner"], "c")).json()["data"]["id"]
    b = (await _send(world["owner"], "d")).json()["data"]["id"]
    c_ = (await _send(world["owner"], "e")).json()["data"]["id"]
    async with _client() as c:
        solo = await c.post(f"{API}/candidates/{a}/approve", headers=world["owner"]["headers"], json={"audience": [me]})
        gone = await c.post(f"{API}/candidates/{b}/discard", headers=world["owner"]["headers"])
        again = await c.post(f"{API}/candidates/{b}/approve", headers=world["owner"]["headers"], json={})
        org = await c.post(f"{API}/candidates/{c_}/approve", headers=world["owner"]["headers"], json={"audience": ["org"]})
    assert solo.json()["data"]["id"] == a and (await _row(a))[1] == "queued"  # 나만 — 그 줄을 그대로 들인다
    assert gone.json()["data"]["status"] == "withdrawn" and again.status_code == 404
    assert org.status_code == 403  # 전사는 admin 만 — 받기 규칙 그대로
    async with session_scope() as s:
        n = await candidates.expire(s, ttl_days=7, now=datetime.now(UTC) + timedelta(days=8))
    assert n >= 1 and (await _row(c_))[2] == "withdrawn"


async def test_candidate_owner_must_be_a_user(world: dict[str, Any]) -> None:
    r = await _send(world["admin"], "f", owner=f"{PREFIX}-nobody@example.com")
    assert r.status_code == 422 and "MXWP 사용자" in r.json()["error"]["message"]
