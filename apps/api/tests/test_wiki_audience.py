# 보이기 범위(W2) 시험 — 위키 audience · restricted 를 읽는 사람별로, 문서 길마다 새는 것이 없는지 본다
"""docs/llm-wiki W2 완료 기준 — '길마다 시험(범위 셋 × 길 전부) 누설 0'. 선례는 test_block_permissions_paths.py.

문서 여섯(범위 org · aff · plat · aff+plat 의 위키 문서, restricted 일반 문서, 보통 문서)과 읽는 사람 여섯(소속 · 플랫폼 ·
아무것도 · 오래된 소속 · restricted 작성자 · admin)을 만들고 각 길에서 보이는 slug 집합을 견준다. 시험 문서는 `w2-aud-…`,
사람은 `w2-aud-…@example.com` 이고 끝에 지운다.
"""
from __future__ import annotations

import copy
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app
from app.wiki import audience

_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
BASE = json.loads((_SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
RUN = uuid4().hex[:8]

DOCS = {  # 이름 → (wiki audience 또는 None, confidentiality)
    "org": (["org"], "internal"),
    "aff": (["aff:SYN-CAE1"], "internal"),
    "plat": (["plat:plmdefect"], "internal"),
    "both": (["aff:SYN-CAE1", "plat:plmdefect"], "internal"),
    "restricted": (None, "restricted"),
    "plain": (None, "internal"),
}
EVERYONE = {"org", "plain"}
EXPECT = {  # 읽는 사람 → 보이는 문서
    "aff": EVERYONE | {"aff"},
    "plat": EVERYONE | {"plat"},
    "none": EVERYONE,
    "stale": EVERYONE,  # 소속 값을 받은 지 오래 — aff: 를 없는 것으로
    "author": EVERYONE | {"restricted"},
    "admin": set(DOCS),
}


def _slug(name: str) -> str:
    return f"w2-aud-{RUN}-{name}"


def _ulid() -> str:
    return uuid4().hex[:26].upper()


def _payload(name: str, confidentiality: str) -> dict[str, Any]:
    doc = copy.deepcopy(BASE)
    doc["id"] = _ulid()
    doc["slug"] = _slug(name)
    doc["title"] = f"W2 범위 시험 {RUN} {name}"
    doc["metadata"]["confidentiality"] = confidentiality
    for sec in doc["sections"]:
        sec["id"] = _ulid()
        for b in sec["blocks"]:
            b["id"] = _ulid()
    if name == "plain":
        links = " ".join(f"[[{_slug(n)}]]" for n in DOCS if n != "plain")
        doc["sections"][0]["blocks"].append({"type": "paragraph", "id": _ulid(), "text": links})
    return doc


async def _user(s: Any, name: str, role: str, *, aff: str | None = None, plat: list[str] | None = None,
                access_at: datetime | None = None) -> str:
    uid = str(uuid4())
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at)
    """), {"id": uid, "e": f"w2-aud-{RUN}-{name}@example.com", "n": f"W2 {name}", "pw": hash_password("x" * 16),
           "r": role, "a": aff, "p": plat, "at": access_at})
    return uid


@pytest.fixture
async def world() -> Any:
    now = datetime.now(UTC)
    tokens: dict[str, str | None] = {"admin": None}
    async with session_scope() as s:
        uids = {
            "aff": await _user(s, "aff", "reader", aff="SYN-CAE1", plat=[], access_at=now),
            "plat": await _user(s, "plat", "reader", plat=["plat:plmdefect"], access_at=now),
            "none": await _user(s, "none", "reader"),
            "stale": await _user(s, "stale", "reader", aff="SYN-CAE1", plat=[], access_at=now - timedelta(hours=48)),
            "author": await _user(s, "author", "editor"),
        }
        # 직접 넣는다 — document_service.create_document 는 dev Meili 색인 · 웹훅까지 부른다.
        for name, (aud, conf) in DOCS.items():
            owner = uids["author"] if name == "restricted" else uids["none"]
            body = json.dumps(_payload(name, conf), ensure_ascii=False)
            doc_id = (await s.execute(text("""
                INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
                VALUES (:slug, :title, '', 'published', CAST(:c AS jsonb), CAST(:o AS uuid)) RETURNING id
            """), {"slug": _slug(name), "title": f"W2 범위 시험 {RUN} {name}", "c": body, "o": owner})).scalar_one()
            await s.execute(text("""
                INSERT INTO document_versions (document_id, version, content_json, edited_by)
                VALUES (:d, 1, CAST(:c AS jsonb), CAST(:o AS uuid))
            """), {"d": doc_id, "c": body, "o": owner})
            if aud is not None:
                await s.execute(text("""
                    INSERT INTO wiki_pages (doc_id, kind, managed, audience)
                    VALUES (:d, 'entity', 'ai', CAST(:a AS text[]))
                """), {"d": doc_id, "a": aud})
        await s.commit()
    for who, uid in uids.items():
        tokens[who] = make_access_token(uid)
    yield tokens
    async with session_scope() as s:
        await s.execute(text("DELETE FROM documents WHERE slug LIKE :p"), {"p": f"w2-aud-{RUN}-%"})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w2-aud-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w2-aud-{RUN}-%"})


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _auth(token: str | None) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"} if token else {}


def _names(slugs: Any) -> set[str]:
    prefix = f"w2-aud-{RUN}-"
    return {s[len(prefix):] for s in slugs if isinstance(s, str) and s.startswith(prefix)}


# ── 순수 계산 ─────────────────────────────────────────────────────────────────────────────────

def test_viewer_tokens_and_freshness() -> None:
    now = datetime.now(UTC)
    fresh = audience.viewer_from_user({"id": "u1", "email": "A@Example.com", "role": "reader",
                                       "portal_affiliation": "X", "portal_plat": ["plat:p", "nope"],
                                       "portal_access_at": now.isoformat()}, now=now)
    assert fresh.tokens == ("aff:X", "org", "plat:p", "user:u1") and fresh.email == "a@example.com"
    stale = audience.viewer_from_user({"id": "u1", "role": "reader", "portal_affiliation": "X",
                                       "portal_access_at": (now - timedelta(hours=25)).isoformat()}, now=now)
    assert stale.tokens == ("org", "user:u1")
    assert audience.viewer_from_user({"id": "u2", "role": "admin"}).sees_all


def test_missing_viewer_is_loud() -> None:
    with pytest.raises(audience.ViewerMissing):
        audience.sql_params()


# ── 문서 길 ───────────────────────────────────────────────────────────────────────────────────

async def test_document_get_per_viewer(world: dict[str, str | None]) -> None:
    async with _client() as c:
        for who, visible in EXPECT.items():
            for name in DOCS:
                r = await c.get(f"/api/v1/documents/{_slug(name)}", headers=_auth(world[who]))
                assert (r.status_code == 200) == (name in visible), (who, name, r.status_code)
                if name not in visible:
                    assert r.status_code == 404  # 있는지도 말하지 않는다


async def test_document_list_per_viewer(world: dict[str, str | None]) -> None:
    async with _client() as c:
        for who, visible in EXPECT.items():
            r = await c.get("/api/v1/documents", params={"q": "W2 범위 시험", "limit": 100},
                            headers=_auth(world[who]))
            assert r.status_code == 200, r.text
            got = _names(d["slug"] for d in r.json()["data"])
            assert got == visible, (who, got)


async def test_versions_and_export_follow_document(world: dict[str, str | None]) -> None:
    async with _client() as c:
        for name in DOCS:
            visible = name in EXPECT["none"]
            for path in (f"/api/v1/documents/{_slug(name)}/versions",
                         f"/api/v1/documents/{_slug(name)}/versions/1",
                         f"/api/v1/documents/{_slug(name)}/export.html"):
                r = await c.get(path, headers=_auth(world["none"]))
                assert (r.status_code == 200) == visible, (path, r.status_code)


async def test_backlinks_hide_invisible_sources(world: dict[str, str | None]) -> None:
    """보이는 문서의 역링크에 범위 밖 문서(제목 · 요약)가 섞이지 않는다."""
    async with session_scope() as s:
        target = (await s.execute(text("SELECT id FROM documents WHERE slug = :s"), {"s": _slug("plain")})).scalar_one()
        for name in DOCS:
            src = (await s.execute(text("SELECT id FROM documents WHERE slug = :s"), {"s": _slug(name)})).scalar_one()
            await s.execute(text("""
                INSERT INTO links (source_doc_id, target_doc_id, target_slug, anchor)
                VALUES (:src, :tgt, :ts, NULL)
            """), {"src": src, "tgt": target, "ts": _slug("plain")})
        await s.commit()
    async with _client() as c:
        for who in ("aff", "none", "admin"):
            r = await c.get(f"/api/v1/documents/{_slug('plain')}/backlinks", headers=_auth(world[who]))
            assert r.status_code == 200, r.text
            got = _names(x["slug"] for x in r.json()["data"])
            assert got == EXPECT[who], (who, got)


async def test_share_link_only_for_anonymous_visible(world: dict[str, str | None]) -> None:
    """공유 링크는 로그인 없이 열린다 — ["org"] 범위 · restricted 아님만 만들 수 있다(admin 도)."""
    async with _client() as c:
        for name in DOCS:
            r = await c.post(f"/api/v1/documents/{_slug(name)}/share", json={})
            assert r.status_code in (200, 201) if name in EVERYONE else r.status_code == 403, (name, r.text)


async def test_share_link_closes_when_scope_narrows(world: dict[str, str | None]) -> None:
    async with _client() as c:
        made = await c.post(f"/api/v1/documents/{_slug('plain')}/share", json={})
        token = made.json()["data"]["token"]
        assert (await c.get(f"/api/v1/share/{token}")).status_code == 200
        async with session_scope() as s:
            doc_id = (await s.execute(text("SELECT id FROM documents WHERE slug = :s"),
                                      {"s": _slug("plain")})).scalar_one()
            await s.execute(text("""
                INSERT INTO wiki_pages (doc_id, kind, managed, audience)
                VALUES (:d, 'entity', 'ai', ARRAY['aff:SYN-CAE1'])
            """), {"d": doc_id})
            await s.commit()
        assert (await c.get(f"/api/v1/share/{token}")).status_code == 410


async def test_oembed_hides_narrow_wiki_pages(world: dict[str, str | None], monkeypatch: pytest.MonkeyPatch) -> None:
    from app.core.config import get_settings

    base = get_settings().web_base_url.rstrip("/")
    async with _client() as c:
        for name in ("org", "aff", "plat"):
            r = await c.get("/api/v1/oembed", params={"url": f"{base}/docs/{_slug(name)}"})
            assert (r.status_code == 200) == (name == "org"), (name, r.status_code, r.text[:200])
            if name != "org":
                assert r.status_code == 404


async def _link_all_to(target: str) -> None:
    async with session_scope() as s:
        tid = (await s.execute(text("SELECT id FROM documents WHERE slug = :s"), {"s": _slug(target)})).scalar_one()
        for name in DOCS:
            if name == target:
                continue
            src = (await s.execute(text("SELECT id FROM documents WHERE slug = :s"), {"s": _slug(name)})).scalar_one()
            await s.execute(text("""
                INSERT INTO links (source_doc_id, target_doc_id, target_slug, anchor) VALUES (:src, :tgt, :ts, NULL)
            """), {"src": src, "tgt": tid, "ts": _slug(target)})
            await s.execute(text("""
                INSERT INTO links (source_doc_id, target_doc_id, target_slug, anchor) VALUES (:src, NULL, :ts, NULL)
            """), {"src": tid, "ts": _slug(name)})
        await s.commit()


async def test_link_graph_drops_invisible_nodes(world: dict[str, str | None]) -> None:
    """범위 밖 문서는 노드에서 빠진다 — 'missing' 으로도 그리지 않는다(이름이 샌다)."""
    await _link_all_to("plain")
    async with _client() as c:
        for who in ("aff", "plat", "none", "admin"):
            r = await c.get("/api/v1/links/graph", params={"root": _slug("plain"), "depth": 1},
                            headers=_auth(world[who]))
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            nodes = _names(n["slug"] for n in data["nodes"])
            assert nodes == EXPECT[who], (who, nodes)
            edge_ends = _names(x for e in data["edges"] for x in (e["source"], e["target"]))
            assert edge_ends <= EXPECT[who], (who, edge_ends)


async def test_home_today_picks_only_visible(world: dict[str, str | None]) -> None:
    """'오늘의 문서' 후보 · 이웃 · 그래프 노드에 범위 밖 문서가 없다(시험 문서를 indegree 맨 위로 올려 후보로 만든다)."""
    from app.routers import home as home_mod

    await _link_all_to("plain")
    async with session_scope() as s:
        await s.execute(text("UPDATE documents SET indegree = 1000000 WHERE slug LIKE :p"), {"p": f"w2-aud-{RUN}-%"})
        await s.commit()
    home_mod._TODAY_CACHE.clear()
    try:
        async with _client() as c:
            for who in ("aff", "none"):
                r = await c.get("/api/v1/home/today", headers=_auth(world[who]))
                assert r.status_code == 200, r.text
                data = r.json()["data"]
                seen = _names([data["doc"]["slug"]] + [n["slug"] for n in data["neighbors"]]
                              + [n["slug"] for n in data["graph"]["nodes"]])
                assert seen <= EXPECT[who], (who, seen)
    finally:
        home_mod._TODAY_CACHE.clear()


async def test_dep_graph_drops_invisible_nodes(world: dict[str, str | None]) -> None:
    """본문 [[slug]] 로 짓는 의존 그래프 — 범위 밖 문서는 노드째 빠진다(캐시도 읽는 사람별)."""
    from app.routers import dep_graph as dep_mod

    dep_mod._cache_clear()
    async with _client() as c:
        for who in ("aff", "plat", "none", "admin"):
            r = await c.get("/api/v1/dep-graph", params={"root_slug": _slug("plain"), "depth": 1},
                            headers=_auth(world[who]))
            assert r.status_code == 200, r.text
            nodes = _names(n["slug"] for n in r.json()["data"]["nodes"])
            assert nodes == EXPECT[who], (who, nodes)
    dep_mod._cache_clear()


async def test_triples_hide_out_of_scope_ends(world: dict[str, str | None]) -> None:
    async with session_scope() as s:
        for name in DOCS:
            if name != "plain":
                await s.execute(text("""
                    INSERT INTO doc_triples (id, subject_slug, predicate, object_slug, source)
                    VALUES (gen_random_uuid(), :s, '관련', :o, 'manual')
                """), {"s": _slug("plain"), "o": _slug(name)})
        await s.commit()
    try:
        async with _client() as c:
            for who in ("aff", "none", "admin"):
                listed = await c.get("/api/v1/triples", params={"subject": _slug("plain")}, headers=_auth(world[who]))
                assert listed.status_code == 200, listed.text
                objs = _names(t["object_slug"] for t in listed.json()["data"])
                assert objs == EXPECT[who] - {"plain"}, (who, objs)
                sub = await c.get("/api/v1/triples/subgraph", params={"root": _slug("plain"), "depth": 1},
                                  headers=_auth(world[who]))
                assert _names(sub.json()["data"]["nodes"]) == EXPECT[who], (who, sub.json()["data"]["nodes"])
    finally:
        async with session_scope() as s:
            await s.execute(text("DELETE FROM doc_triples WHERE subject_slug = :s"), {"s": _slug("plain")})
            await s.commit()


def test_meili_audience_fields_and_filter() -> None:
    from app.search import meili_indexer as mi

    assert mi.audience_fields(None, "internal", "o1", None, {}) == {"aud1": "org", "aud2": "*", "aud3": "*", "readers": ["*"]}
    f = mi.audience_fields(["plat:p", "aff:X"], "restricted", "o1", ["r1"],
                           {"metadata": {"owners": ["A@x.com"], "reviewers": "not-a-list"}})
    assert (f["aud1"], f["aud2"], f["aud3"]) == ("aff:X", "plat:p", "*")
    assert f["readers"] == ["email:a@x.com", "user:o1", "user:r1"]
    assert mi.audience_filter_exprs(audience.SYSTEM) == []
    exprs = mi.audience_filter_exprs(audience.Viewer(kind="user", user_id="u1", email='e"x@y', tokens=("org", "user:u1")))
    assert exprs[0] == '(aud1 NOT EXISTS OR aud1 IN ["*", "org", "user:u1"])'
    assert exprs[-1] == '(readers NOT EXISTS OR readers IN ["*", "user:u1", "email:e\\"x@y"])'


async def test_search_and_chat_search_hide_out_of_scope(world: dict[str, str | None]) -> None:
    """검색(/search · /search/suggest)과 챗 search_corpus — 범위 밖 문서는 제목 · 스니펫째 빠진다(dev Meili 에 넣었다 지운다)."""
    from app.search import meili_indexer as mi
    from app.services import chat_agent

    async with session_scope() as s:
        await s.execute(text("REFRESH MATERIALIZED VIEW documents_flat_v"))
        await s.commit()
        ids = [str(i) for i in (await s.execute(
            text("SELECT id FROM documents WHERE slug LIKE :p"), {"p": f"w2-aud-{RUN}-%"})).scalars().all()]
        rows = [r for r in [await mi._fetch_flat_row(s, i) for i in ids] if r]
    assert len(rows) == len(DOCS)
    idx = mi.get_client().index(mi.INDEX_UID)
    mi.get_client().wait_for_task(idx.add_documents(rows, primary_key=mi.PRIMARY_KEY).task_uid, timeout_in_ms=30_000)
    try:
        async with _client() as c:
            for who, visible in EXPECT.items():
                r = await c.get("/api/v1/search", params={"q": RUN, "limit": 50}, headers=_auth(world[who]))
                assert r.status_code == 200, r.text
                assert _names(h["slug"] for h in r.json()["data"]) == visible, (who, r.json()["data"])
                sug = await c.get("/api/v1/search/suggest", params={"q": RUN}, headers=_auth(world[who]))
                assert _names(d["slug"] for d in sug.json()["data"]["documents"]) <= visible, who
        async with session_scope() as s:
            row = (await s.execute(text("SELECT id, email, role FROM users WHERE email = :e"),
                                   {"e": f"w2-aud-{RUN}-none@example.com"})).first()
            assert row is not None
            with audience.acting_as(audience.viewer_from_user({"id": str(row[0]), "email": row[1], "role": row[2]})):
                res = await chat_agent._tool_search_corpus(s, {"role": row[2]}, {"query": RUN, "limit": 20})
        assert _names(x["slug"] for x in res["results"]) == EXPECT["none"], res
    finally:
        last = None
        for i in ids:
            last = idx.delete_document(i)
        if last is not None:
            mi.get_client().wait_for_task(last.task_uid, timeout_in_ms=30_000)


async def test_list_audience_org_for_outbound_push(world: dict[str, str | None]) -> None:
    """AIDataHub 로 밀어낼 목록(`?audience=org`) — admin 토큰이어도 로그인 없이 보일 문서만."""
    async with _client() as c:
        for who in ("admin", "aff", "author"):
            r = await c.get("/api/v1/documents", params={"q": "W2 범위 시험", "limit": 100, "audience": "org"},
                            headers=_auth(world[who]))
            assert r.status_code == 200, r.text
            assert _names(d["slug"] for d in r.json()["data"]) == EVERYONE, who
        bad = await c.get("/api/v1/documents", params={"audience": "everyone"})
        assert bad.status_code == 422


async def _ids() -> dict[str, str]:
    async with session_scope() as s:
        rows = (await s.execute(text("SELECT slug, id::text FROM documents WHERE slug LIKE :p"),
                                {"p": f"w2-aud-{RUN}-%"})).all()
    prefix = f"w2-aud-{RUN}-"
    return {slug[len(prefix):]: did for slug, did in rows}


async def _uid(who: str) -> str:
    async with session_scope() as s:
        return str((await s.execute(text("SELECT id FROM users WHERE email = :e"),
                                    {"e": f"w2-aud-{RUN}-{who}@example.com"})).scalar_one())


async def test_recipient_can_see_helper(world: dict[str, str | None]) -> None:
    """알림 · 메일 쪽 판정(viewer_for_user + can_see) — 요청 밖에서 받는 사람 기준으로."""
    ids = await _ids()
    async with session_scope() as s:
        for who in ("aff", "plat", "none", "stale", "author"):
            viewer = await audience.viewer_for_user(s, await _uid(who))
            seen = {name for name, did in ids.items() if await audience.can_see(s, viewer, did)}
            assert seen == EXPECT[who], (who, seen)
        assert await audience.can_see(s, None, ids["plain"]) is False


async def test_notifications_hide_out_of_scope_docs(world: dict[str, str | None]) -> None:
    """알림은 만들 때 제목을 담는다 — 지금 볼 수 없는 문서의 알림은 목록 · 안 읽은 수에서 빠진다."""
    uid = await _uid("none")
    async with session_scope() as s:
        for name in ("plain", "aff", "restricted"):
            await s.execute(text("""
                INSERT INTO notifications (user_id, kind, payload)
                VALUES (CAST(:u AS uuid), 'comment_mention', CAST(:p AS jsonb))
            """), {"u": uid, "p": json.dumps({"slug": _slug(name), "doc_title": f"제목 {name}"})})
        await s.commit()
    async with _client() as c:
        r = await c.get("/api/v1/notifications", headers=_auth(world["none"]))
    assert r.status_code == 200, r.text
    assert _names(n["payload"].get("slug") for n in r.json()["data"]) == {"plain"}
    assert r.json()["meta"]["unread"] == 1
    async with session_scope() as s:
        await s.execute(text("DELETE FROM notifications WHERE user_id = CAST(:u AS uuid)"), {"u": uid})
        await s.commit()


async def test_subscription_events_skip_out_of_scope_subscribers(world: dict[str, str | None]) -> None:
    """구독자라도 지금 그 문서를 볼 수 없으면 알림 · 요약 메일 줄을 만들지 않는다(메일로 제목이 샌다)."""
    from app.services import digest_runner

    ids = await _ids()
    uids = {who: await _uid(who) for who in ("aff", "none")}
    async with session_scope() as s:
        for uid in uids.values():
            await s.execute(text("""
                INSERT INTO subscriptions (user_id, document_id) VALUES (CAST(:u AS uuid), CAST(:d AS uuid))
            """), {"u": uid, "d": ids["aff"]})
        await s.commit()
        n = await digest_runner._dispatch_inner(s, event_kind="doc_edited", document_id=ids["aff"],
                                               payload={"slug": _slug("aff")}, actor_user_id=None)
        got = set((await s.execute(text("""
            SELECT user_id::text FROM notifications WHERE payload->>'slug' = :s
        """), {"s": _slug("aff")})).scalars().all())
        assert n == 1 and got == {uids["aff"]}, (n, got)
        await s.execute(text("DELETE FROM notifications WHERE payload->>'slug' = :s"), {"s": _slug("aff")})
        await s.execute(text("DELETE FROM subscriptions WHERE document_id = CAST(:d AS uuid)"), {"d": ids["aff"]})
        await s.commit()
