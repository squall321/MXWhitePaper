"""Sprint 6 — write 후 audit_logs 행 검증.

Cycle (audit viewer) — 신규 admin 라우터 `/api/v1/audit` (페이지/필터/CSV) 테스트
도 같은 파일에 묶어 둔다.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app

SAMPLES = Path("/workspace/packages/shared/samples")
if not SAMPLES.exists():
    SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"


def _ulid_like() -> str:
    import secrets
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "".join(secrets.choice(alphabet) for _ in range(26))


async def _login_admin(ac: AsyncClient) -> str:
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


@pytest.mark.asyncio
async def test_post_doc_writes_audit_row() -> None:
    sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
    new_slug = f"audit-test-{uuid.uuid4().hex[:8]}"
    sample["slug"] = new_slug
    sample["id"] = _ulid_like()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/documents", json=sample)
    assert r.status_code == 201, r.text

    async with session_scope() as s:
        row = (await s.execute(
            text("""
                SELECT action, target, payload
                FROM audit_logs
                WHERE target = :t
                ORDER BY created_at DESC
                LIMIT 1
            """),
            {"t": f"document:{new_slug}"},
        )).first()
        assert row is not None, "audit_logs row missing for new doc"
        assert row[0] == "document.create"
        # payload 는 JSONB → asyncpg 가 str 또는 dict 로 반환
        payload = row[2]
        if isinstance(payload, str):
            payload = json.loads(payload)
        assert payload.get("version") == 1

        # cleanup
        await s.execute(
            text("DELETE FROM documents WHERE slug = :slug"),
            {"slug": new_slug},
        )


# ── /api/v1/audit (admin viewer) ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_audit_list_happy_returns_envelope() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/audit",
            params={"limit": 5, "offset": 0},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["data"], list)
    meta = body["meta"]
    assert "total" in meta and isinstance(meta["total"], int)
    assert meta["limit"] == 5 and meta["offset"] == 0
    if body["data"]:
        row = body["data"][0]
        for key in (
            "id", "actor_user_id", "actor_name", "action",
            "target_kind", "target_id", "payload", "created_at",
        ):
            assert key in row, key


@pytest.mark.asyncio
async def test_audit_list_filter_combos() -> None:
    """date range + action + target_kind 결합 필터 — 결과는 필터 모순이 없으면
    항상 200 + list. 행이 0개여도 contract 만족."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}

        # since/until 같이 — 빈 윈도우 → 0 행
        r = await ac.get(
            "/api/v1/audit",
            params={
                "since": "2099-01-01T00:00:00Z",
                "until": "2099-01-02T00:00:00Z",
                "limit": 5,
            },
            headers=h,
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"] == []

        # action 정확매칭 — admin.maintenance.run 같은 known action
        r2 = await ac.get(
            "/api/v1/audit",
            params={"action": "document.create", "limit": 3},
            headers=h,
        )
        assert r2.status_code == 200, r2.text
        for row in r2.json()["data"]:
            assert row["action"] == "document.create"

        # target_kind = 'document' — 모든 행의 target_kind 가 매칭
        r3 = await ac.get(
            "/api/v1/audit",
            params={"target_kind": "document", "limit": 5},
            headers=h,
        )
        assert r3.status_code == 200, r3.text
        for row in r3.json()["data"]:
            assert row["target_kind"] == "document"


@pytest.mark.asyncio
async def test_audit_actions_distinct_cached() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        h = {"Authorization": f"Bearer {token}"}

        # cache hygiene — clear before measuring.
        from app.routers.audit import _actions_cache_clear
        _actions_cache_clear()

        r1 = await ac.get("/api/v1/audit/actions", headers=h)
        assert r1.status_code == 200, r1.text
        body1 = r1.json()
        assert isinstance(body1["data"], list)
        assert body1["meta"]["cached"] is False

        # 2nd call — cached
        r2 = await ac.get("/api/v1/audit/actions", headers=h)
        assert r2.status_code == 200, r2.text
        assert r2.json()["meta"]["cached"] is True
        assert r2.json()["data"] == body1["data"]


@pytest.mark.asyncio
async def test_audit_csv_streams_attachment() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        token = await _login_admin(ac)
        r = await ac.get(
            "/api/v1/audit/csv",
            params={"limit": 10},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200, r.text
    ct = r.headers.get("content-type", "")
    assert ct.startswith("text/csv"), ct
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd and "audit-log.csv" in cd
    body = r.text
    # First line is the header.
    lines = body.splitlines()
    assert lines, "csv body empty"
    assert lines[0].startswith("id,created_at,actor_user_id,")


@pytest.mark.asyncio
async def test_audit_non_admin_forbidden() -> None:
    """Reader user → 403 on every audit endpoint."""
    from app.core.security import hash_password, make_access_token

    email = "reader-audit@mx.local"
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if row is None:
            await s.execute(
                text(
                    "INSERT INTO users (email, name, password_hash, role) "
                    "VALUES (:e, :n, :pw, 'reader')"
                ),
                {"e": email, "n": "Reader", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        token = make_access_token(str(row[0]))

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {token}"}
        for path in ("/api/v1/audit", "/api/v1/audit/actions", "/api/v1/audit/csv"):
            r = await ac.get(path, headers=h)
            assert r.status_code == 403, f"{path}: {r.text}"
