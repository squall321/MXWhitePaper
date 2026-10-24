# 서비스 계정의 API 토큰 호출(게이트웨이의 신원 없는 내부 호출) 시야 시험 — org 만 · restricted 못 봄 · 같은 계정의 웹 세션 · 사람 admin 은 다 본다
"""사용자 결정 10-24 · WK-D43 — admin 우회는 사람 admin 에게만. 서비스 계정은 `MXWP_SERVICE_ACCOUNTS` 로 고른다(시험은 이 실행의 계정)."""
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
from app.wiki import audience

RUN = uuid4().hex[:8]
BASE = json.loads(Path("/workspace/packages/shared/samples/05-minimal-doc.json").read_text(encoding="utf-8"))


def _slug(name: str) -> str:
    return f"w2-svc-{RUN}-{name}"


async def _user(s: Any, name: str, role: str) -> tuple[str, str]:
    uid, email = str(uuid4()), f"w2-svc-{RUN}-{name}@example.com"
    await s.execute(text("""
        INSERT INTO users (id, email, name, password_hash, role) VALUES (CAST(:id AS uuid), :e, :n, :pw, :r)
    """), {"id": uid, "e": email, "n": f"W2 {name}", "pw": hash_password("x" * 16), "r": role})
    return uid, email


async def _doc(s: Any, name: str, owner: str, *, aud: list[str] | None = None, conf: str = "internal") -> None:
    body = {**BASE, "slug": _slug(name), "title": f"서비스 시야 시험 {RUN} {name}",
            "metadata": {**BASE["metadata"], "confidentiality": conf}}
    doc_id = (await s.execute(text("""
        INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
        VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), CAST(:o AS uuid)) RETURNING id
    """), {"slug": body["slug"], "t": body["title"], "c": json.dumps(body, ensure_ascii=False), "o": owner})).scalar_one()
    if aud:
        await s.execute(text("""
            INSERT INTO wiki_pages (doc_id, kind, managed, audience) VALUES (:d, 'entity', 'ai', CAST(:a AS text[]))
        """), {"d": doc_id, "a": aud})


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _pat(jwt: str) -> str:
    async with _client() as c:
        r = await c.post("/api/v1/me/api-tokens", headers={"Authorization": f"Bearer {jwt}"},
                         json={"name": f"w2-svc-{RUN}", "scopes": ["read"]})
    assert r.status_code in (200, 201), r.text
    return r.json()["data"]["token"]


@pytest.fixture
async def world(monkeypatch: pytest.MonkeyPatch) -> Any:
    async with session_scope() as s:
        svc, svc_email = await _user(s, "svc", "admin")
        human, _ = await _user(s, "human", "admin")
        await _doc(s, "org", svc)
        await _doc(s, "aff", svc, aud=["aff:SYN-CAE1"])
        await _doc(s, "restricted", svc, conf="restricted")
        await s.commit()
    monkeypatch.setattr(get_settings(), "mxwp_service_accounts", f"someone@example.com, {svc_email.upper()}")
    svc_jwt, human_jwt = make_access_token(svc), make_access_token(human)
    yield {"svc_pat": await _pat(svc_jwt), "svc_jwt": svc_jwt, "human_pat": await _pat(human_jwt), "svc_email": svc_email}
    async with session_scope() as s:
        await s.execute(text("DELETE FROM documents WHERE slug LIKE :p"), {"p": f"w2-svc-{RUN}-%"})
        for table in ("api_tokens", "audit_logs"):
            await s.execute(text(f"DELETE FROM {table} WHERE user_id IN (SELECT id FROM users WHERE email LIKE :e)"),
                            {"e": f"w2-svc-{RUN}-%"})
        await s.execute(text("DELETE FROM users WHERE email LIKE :e"), {"e": f"w2-svc-{RUN}-%"})


async def _seen(token: str) -> dict[str, int]:
    async with _client() as c:
        return {name: (await c.get(f"/api/v1/documents/{_slug(name)}", headers={"Authorization": f"Bearer {token}"}))
                .status_code for name in ("org", "aff", "restricted")}


async def test_service_token_sees_org_only(world: dict[str, Any]) -> None:
    assert await _seen(world["svc_pat"]) == {"org": 200, "aff": 404, "restricted": 404}  # 지은이여도 restricted 는 못 본다
    async with _client() as c:
        listed = (await c.get("/api/v1/documents", headers={"Authorization": f"Bearer {world['svc_pat']}"},
                              params={"q": RUN, "limit": 100})).json()["data"]
    assert {d["slug"] for d in listed} == {_slug("org")}


async def test_same_account_web_session_and_human_admin_token_see_all(world: dict[str, Any]) -> None:
    assert await _seen(world["svc_jwt"]) == {"org": 200, "aff": 200, "restricted": 200}  # 같은 계정의 웹 세션은 사람 admin
    assert await _seen(world["human_pat"]) == {"org": 200, "aff": 200, "restricted": 200}  # 목록 밖 admin 의 토큰


def test_is_service_call(world: dict[str, Any]) -> None:
    email = world["svc_email"]
    assert audience.is_service_call({"auth_via": "api_token", "email": email}) is True
    assert audience.is_service_call({"email": email}) is False  # 웹 세션
    assert audience.is_service_call({"auth_via": "delegated:gateway", "email": email}) is False
    assert audience.is_service_call({"auth_via": "api_token", "email": "other@example.com"}) is False
