# 위키 원천 받기 시험 — 멱등 · 새 판 · 범위 · 주인 규칙 · 원천 문서 · 첨부 · 철회 · 기록 · 꺼짐 · 상태
"""docs/llm-wiki W3 완료 기준 — '멱등(두 번 → 한 줄)' · '불변(UPDATE 거부)'. 합성 원천(fixtures/wiki)만 쓴다.

dev DB · MinIO · Meili 를 그대로 쓰므로 만든 것(원천 · 작업 · 기록 · 문서 · 색인 줄 · 객체 · 사람)은 끝에 지운다.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import ulid
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.core.config import get_settings
from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app
from app.routers import wiki as wiki_router
from app.search import meili_indexer
from app.storage import minio_adapter

RUN = uuid4().hex[:8]
FIX = Path(__file__).parent / "fixtures" / "wiki" / "sources"
AFF = "SYN-CAE1"
API = "/api/v1/wiki"


def _json(v: Any) -> Any:
    return json.loads(v) if isinstance(v, str) else v


def _email(name: str) -> str:
    return f"w3-src-{RUN}-{name}@example.com"


def _env(name: str = "01-sim-stcx-job0001-r1.json", **over: Any) -> dict[str, Any]:
    env = json.loads((FIX / name).read_text(encoding="utf-8"))
    env["origin"]["ref"] = f"w3-{RUN}-{env['origin']['ref']}"
    env.update(over)
    return env


async def _user(s: Any, name: str, role: str, *, aff: str | None = None) -> str:
    uid = str(uuid4())
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role, portal_affiliation, portal_plat, portal_access_at)
        VALUES (CAST(:id AS uuid), :e, :n, :pw, :r, :a, CAST(:p AS text[]), :at)
    """), {"id": uid, "e": _email(name), "n": f"W3 {name}", "pw": hash_password("x" * 16), "r": role, "a": aff,
           "p": [] if aff else None, "at": datetime.now(UTC) if aff else None})
    return uid


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(get_settings(), "wiki_enabled", True)
    async with session_scope() as s:
        uids = {
            "admin": await _user(s, "admin", "admin"),
            "aff": await _user(s, "aff", "editor", aff=AFF),
            "plain": await _user(s, "plain", "editor"),
            "reader": await _user(s, "reader", "reader", aff=AFF),
            "other": await _user(s, "other", "reader"),
        }
        await s.commit()
    yield {name: (uid, {"Authorization": f"Bearer {make_access_token(uid)}"}) for name, uid in uids.items()}
    await _cleanup()


async def _cleanup() -> None:
    objects: list[tuple[str, str]] = []
    async with session_scope() as s:
        rows = (await s.execute(text("SELECT id, doc_id, blobs FROM wiki_sources WHERE origin_ref LIKE :p"),
                                {"p": f"w3-{RUN}-%"})).all()
        src_ids = [str(r[0]) for r in rows]
        doc_ids = [str(r[1]) for r in rows if r[1]]
        objects += [(get_settings().minio_bucket_wiki_sources, b["key"]) for r in rows for b in _json(r[2])]
        await s.execute(text("DELETE FROM wiki_jobs WHERE args ->> 'source_id' = ANY(:ids)"), {"ids": src_ids})
        await s.execute(text("SET LOCAL mxwp.wiki_purge = 'on'"))
        await s.execute(text("DELETE FROM wiki_log WHERE detail ->> 'source_id' = ANY(:ids)"), {"ids": src_ids})
        await s.execute(text("DELETE FROM wiki_sources WHERE origin_ref LIKE :p"), {"p": f"w3-{RUN}-%"})
        await s.execute(text("DELETE FROM documents WHERE id = ANY(CAST(:d AS uuid[]))"), {"d": doc_ids})
        await s.execute(text("DELETE FROM images WHERE original_name LIKE :n"), {"n": f"w3-{RUN}-%"})
        await s.execute(text("DELETE FROM files WHERE filename LIKE :n"), {"n": f"w3-{RUN}-%"})
        await s.execute(text("DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                        {"e": f"w3-src-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w3-src-{RUN}-%"})
    for doc_id in doc_ids:
        meili_indexer.delete_document(doc_id)
    cli = minio_adapter.internal_client()
    for bucket in (get_settings().minio_bucket_images, get_settings().minio_bucket_files):  # 행보다 먼저 올린 업로드 객체
        objects += [(bucket, o["Key"]) for o in cli.list_objects_v2(Bucket=bucket, Prefix=f"w3-{RUN}/").get("Contents", [])]
    for bucket, key in objects:
        cli.delete_object(Bucket=bucket, Key=key)


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _post(h: dict[str, str], env: dict[str, Any], *, ingest: bool = True) -> Any:
    async with _client() as c:
        return await c.post(f"{API}/sources", json=env, headers=h, params={} if ingest else {"ingest": "0"})


async def _count(sql: str, **params: Any) -> int:
    async with session_scope() as s:
        return int((await s.execute(text(sql), params)).scalar_one())


async def test_disabled_is_404(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "wiki_enabled", False)
    async with _client() as c:
        for r in (await c.get(f"{API}/health"), await c.post(f"{API}/sources", json=_env())):
            assert r.status_code == 404 and r.json()["error"]["code"] == "wiki_disabled"


async def test_same_envelope_twice_is_one_row(world: dict[str, Any]) -> None:
    _, admin = world["admin"]
    env = _env()
    first = await _post(admin, env)
    assert first.status_code == 201, first.text
    d1 = first.json()["data"]
    assert d1["dedup"] is False and d1["ingest_state"] == "queued" and re.fullmatch(r"src-[0-9a-f]{8}", d1["doc_slug"])
    again = await _post(admin, env)
    assert again.status_code == 200 and again.json()["data"]["id"] == d1["id"] and again.json()["data"]["dedup"] is True
    assert await _count("SELECT COUNT(*) FROM wiki_sources WHERE origin_ref = :r", r=env["origin"]["ref"]) == 1
    assert await _count("SELECT COUNT(*) FROM wiki_jobs WHERE op = 'ingest' AND args ->> 'source_id' = :i",
                        i=d1["id"]) == 1


async def test_ingest_zero_queues_nothing(world: dict[str, Any]) -> None:
    _, admin = world["admin"]
    r = await _post(admin, _env(), ingest=False)
    assert r.status_code == 201 and r.json()["data"]["ingest_state"] == "new"
    assert await _count("SELECT COUNT(*) FROM wiki_jobs WHERE args ->> 'source_id' = :i", i=r.json()["data"]["id"]) == 0


async def test_audience_and_owner_rules(world: dict[str, Any]) -> None:
    _, plain = world["plain"]
    aff_uid, aff = world["aff"]
    _, admin = world["admin"]
    assert (await _post(plain, _env(audience=["org"], owner=None))).status_code == 403  # 전사는 관리자만
    denied = await _post(plain, _env(owner=None))  # 갖지 않은 소속
    assert denied.status_code == 403 and denied.json()["error"]["details"]["missing"] == [f"aff:{AFF}"]
    assert (await _post(aff, _env())).status_code == 403  # 남을 주인으로(봉투의 owner 는 다른 사람)
    mine = await _post(aff, _env(owner=None))
    assert mine.status_code == 201, mine.text
    async with session_scope() as s:
        row = (await s.execute(text("""
            SELECT owner_email, CAST(owner_user_id AS text), CAST(submitted_by AS text), via FROM wiki_sources
             WHERE id = CAST(:i AS uuid)
        """), {"i": mine.json()["data"]["id"]})).one()
    assert tuple(row) == (_email("aff"), aff_uid, aff_uid, "upload")
    org = await _post(admin, _env("13-qa-hinge-origin.json", audience=["org"]))
    assert org.status_code == 201, org.text


async def test_new_revision_supersedes_active(world: dict[str, Any]) -> None:
    _, admin = world["admin"]
    r1 = (await _post(admin, _env("01-sim-stcx-job0001-r1.json"))).json()["data"]
    r2 = await _post(admin, _env("02-sim-stcx-job0001-r2.json"))
    assert r2.status_code == 201
    async with session_scope() as s:
        rows = dict((await s.execute(text("""
            SELECT CAST(id AS text), status || ':' || COALESCE(CAST(supersedes_id AS text), '-') FROM wiki_sources
             WHERE origin_ref LIKE :p
        """), {"p": f"w3-{RUN}-SYN-JOB-0001"})).all())
    assert rows == {r1["id"]: "superseded:-", r2.json()["data"]["id"]: f"active:{r1['id']}"}


async def test_source_document_follows_audience(world: dict[str, Any]) -> None:
    _, admin = world["admin"]
    _, reader = world["reader"]
    _, other = world["other"]
    got = (await _post(admin, _env())).json()["data"]
    async with _client() as c:
        doc = (await c.get(f"/api/v1/documents/{got['doc_slug']}", headers=reader)).json()["data"]
        hidden = await c.get(f"/api/v1/documents/{got['doc_slug']}", headers=other)
        listed = (await c.get(f"{API}/sources", headers=reader, params={"system": "stcx"})).json()
        not_listed = (await c.get(f"{API}/sources", headers=other, params={"system": "stcx"})).json()
        one = await c.get(f"{API}/sources/{got['id']}", headers=reader)
        one_hidden = await c.get(f"{API}/sources/{got['id']}", headers=other)
    assert hidden.status_code == 404 and one_hidden.status_code == 404
    content = doc["content"]
    assert [sec["title"] for sec in content["sections"]] == ["요약", "핵심 값", "출처", "이 원천을 인용한 문서"]
    assert content["metadata"]["confidentiality"] == "internal"
    assert content["metadata"]["owners"] == ["syn.analyst1@example.com"]
    tables = [b for b in content["sections"][1]["blocks"] if b["type"] == "table"]
    results = next(t for t in tables if t.get("caption") == "results")
    assert ["max_von_mises_stress", "412", "MPa", "힌지 브래킷 체결부 모서리"] in results["rows"]  # 숫자는 원천 그대로
    assert got["id"] in [x["id"] for x in listed["data"]] and got["id"] not in [x["id"] for x in not_listed["data"]]
    detail = one.json()["data"]
    assert detail["short"] == "src_" + got["id"].replace("-", "")[:8] and detail["payload"]["results"][0]["value"] == 412
    async with session_scope() as s:
        page = (await s.execute(text("""
            SELECT wp.kind, wp.audience FROM wiki_pages wp JOIN documents d ON d.id = wp.doc_id WHERE d.slug = :s
        """), {"s": got["doc_slug"]})).one()
    assert page[0] == "source" and list(page[1]) == [f"aff:{AFF}"]


async def test_bad_envelope_points_at_body_field(world: dict[str, Any]) -> None:
    _, admin = world["admin"]
    env = _env()
    env["body"]["setup"]["conditions"]["drop_height"] = 1.5  # 맨 숫자 — 숫자는 {value, unit} 로만
    r = await _post(admin, env)
    assert r.status_code == 422
    fields = [e["field"] for e in r.json()["error"]["details"]["errors"]]
    assert any(f.startswith("body.setup.conditions.drop_height") for f in fields), fields


async def _uploads(uid: str) -> tuple[str, str, str, bytes]:
    """이미지 하나 · 파일 하나를 업로드 표 · 버킷에 직접 둔다(업로드 길 자체는 test_uploads 가 본다)."""
    settings = get_settings()
    cli = minio_adapter.internal_client()
    img_raw, file_raw = f"w3 image {RUN}".encode(), f"w3 raw {RUN}".encode()
    img_key, file_key = f"w3-{RUN}/orig.webp", f"w3-{RUN}/raw.csv"
    cli.put_object(Bucket=settings.minio_bucket_images, Key=img_key, Body=img_raw, ContentType="image/webp")
    cli.put_object(Bucket=settings.minio_bucket_files, Key=file_key, Body=file_raw, ContentType="text/csv")
    file_id, img_ulid = f"w3{RUN}file", str(ulid.new())
    async with session_scope() as s:
        img_id = str((await s.execute(text("""
            INSERT INTO images (ulid, sha256, original_name, mime_type, size_bytes, storage_keys, uploaded_by)
            VALUES (:ulid, :sha, :n, 'image/webp', :b, CAST(:k AS jsonb), CAST(:u AS uuid)) RETURNING id
        """), {"ulid": img_ulid, "sha": hashlib.sha256(img_raw).hexdigest(), "n": f"w3-{RUN}-fig.webp",
               "b": len(img_raw), "k": json.dumps({"orig": img_key}), "u": uid})).scalar_one())
        await s.execute(text("""
            INSERT INTO files (id, owner_user_id, filename, mime, size_bytes, storage_key)
            VALUES (:i, CAST(:u AS uuid), :n, 'text/csv', :b, :k)
        """), {"i": file_id, "u": uid, "n": f"w3-{RUN}-raw.csv", "b": len(file_raw), "k": file_key})
        await s.commit()
    return img_id, img_ulid, file_id, img_raw


async def test_attachments_copied_by_sha(world: dict[str, Any]) -> None:
    admin_uid, admin = world["admin"]
    _, reader = world["reader"]
    img_id, img_ulid, file_id, img_raw = await _uploads(admin_uid)
    env = _env(attachments=[{"name": "fig1.png", "mime": "image/png", "upload_id": img_ulid},
                            {"name": "raw.csv", "mime": "text/csv", "upload_id": file_id}])
    r = await _post(admin, env)
    assert r.status_code == 201, r.text
    async with session_scope() as s:
        blobs = _json((await s.execute(text("SELECT blobs FROM wiki_sources WHERE id = CAST(:i AS uuid)"),
                                       {"i": r.json()["data"]["id"]})).scalar_one())
    assert [(b["role"], b["name"]) for b in blobs] == [("figure", "fig1.png"), ("raw", "raw.csv")]
    sha = hashlib.sha256(img_raw).hexdigest()
    assert blobs[0]["sha256"] == sha and blobs[0]["key"] == f"{sha[:2]}/{sha}" and blobs[0]["mime"] == "image/webp"
    head = minio_adapter.internal_client().head_object(Bucket=get_settings().minio_bucket_wiki_sources, Key=blobs[1]["key"])
    assert head["ContentLength"] == blobs[1]["bytes"]
    async with _client() as c:
        doc = (await c.get(f"/api/v1/documents/{r.json()['data']['doc_slug']}", headers=reader)).json()["data"]
    content = doc["content"]
    figs = next(sec for sec in content["sections"] if sec["title"] == "그림")
    assert [b.get("imageId") for b in figs["blocks"]] == [img_id]
    missing = await _post(admin, _env("03-sim-stcx-job0002-rib.json",
                                      attachments=[{"name": "x.png", "mime": "image/png", "upload_id": "nope"}]))
    assert missing.status_code == 422 and missing.json()["error"]["details"]["upload_id"] == "nope"


async def test_withdraw_cancels_logs_and_archives(world: dict[str, Any]) -> None:
    _, aff = world["aff"]
    _, reader = world["reader"]
    _, other = world["other"]
    got = (await _post(aff, _env(owner=None))).json()["data"]
    url = f"{API}/sources/{got['id']}/withdraw"
    async with _client() as c:
        assert (await c.post(url, headers=other)).status_code == 404  # 못 보는 원천은 없는 원천
        assert (await c.post(url, headers=reader)).status_code == 403  # 보이지만 주인이 아니다
        done = await c.post(url, headers=aff)
        again = await c.post(url, headers=aff)
        doc = await c.get(f"/api/v1/documents/{got['doc_slug']}", headers=reader)
        log = (await c.get(f"{API}/log", headers=reader)).json()["data"]
        log_other = (await c.get(f"{API}/log", headers=other)).json()["data"]
        md = await c.get(f"{API}/log.md", headers=reader)
    assert done.status_code == 200 and done.json()["data"] == {"id": got["id"], "status": "withdrawn", "changed": True,
                                                               "cancelled_jobs": 1}
    assert again.json()["data"]["changed"] is False
    assert doc.status_code == 200 and doc.json()["data"]["status"] == "archived"  # 원천 문서는 보관됐다(목록 · 검색에서 빠진다)
    async with session_scope() as s:
        state = (await s.execute(text("""
            SELECT ws.status, ws.ingest_state, j.state FROM wiki_sources ws
              JOIN wiki_jobs j ON j.args ->> 'source_id' = CAST(ws.id AS text) WHERE ws.id = CAST(:i AS uuid)
        """), {"i": got["id"]})).one()
    assert tuple(state) == ("withdrawn", "skipped", "cancelled")
    mine = [e for e in log if e["detail"].get("source_id") == got["id"]]
    assert len(mine) == 1 and mine[0]["op"] == "withdraw" and mine[0]["detail"]["by"] == "owner"
    assert not [e for e in log_other if e["detail"].get("source_id") == got["id"]]
    assert md.headers["content-type"].startswith("text/markdown")
    short = "src_" + got["id"].replace("-", "")[:8]
    assert re.search(rf"^## \[\d{{4}}-\d\d-\d\d \d\d:\d\d\] withdraw \| .+ \({short}\)$", md.text, re.M), md.text[-500:]


async def test_owner_email_is_immutable(world: dict[str, Any]) -> None:
    _, admin = world["admin"]
    got = (await _post(admin, _env())).json()["data"]
    with pytest.raises(DBAPIError, match="immutable"):
        async with session_scope() as s:
            await s.execute(text("UPDATE wiki_sources SET owner_email = 'x@example.com' WHERE id = CAST(:i AS uuid)"),
                            {"i": got["id"]})


async def test_health_without_auth(world: dict[str, Any], fake_llm: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "wiki_llm_base_url", fake_llm.base_url)
    monkeypatch.setattr(wiki_router, "_llm_state", None)
    async with _client() as c:
        up = (await c.get(f"{API}/health")).json()["data"]
        monkeypatch.setattr(get_settings(), "wiki_llm_base_url", "")
        monkeypatch.setattr(wiki_router, "_llm_state", None)
        unset = (await c.get(f"{API}/health")).json()["data"]
    assert up["llm"] == "ok" and unset["llm"] == "unset"
    assert set(up["jobs"]) == {"queued", "running", "held", "oldest_queued_s", "failed_24h", "last_failure"}
    assert up["jobs"]["last_failure"] is None or set(up["jobs"]["last_failure"]) == {"op", "at"}  # 실패 글은 내지 않는다
