"""Sprint K2 — POST /documents/:slug/versions/:n/restore.

Coverage:
  - happy path: edit a doc, then restore v1 → head content equals v1's snapshot
  - 404 on unknown version
  - 403 when caller is reader (require_editor gating)

Auth model: section_patch tests rely on the dev fallback (admin). Here we
exercise the same fallback for happy/404, plus an explicit reader-user token
for the auth case (mirrors test_admin_dashboard.py).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app

SLUG = "month-end-closing"
ROOT_SECTION_ID = "01J9X1Y2Z3A4B5C6D7E8F9G0S1"

_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
SAMPLE_PATH = _SAMPLES / "01-month-end-closing.json"


async def _reset_to_sample(ac: AsyncClient) -> tuple[dict, str]:
    """Restore the seed doc to a known clean state, return (data, etag)."""
    sample = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    r0 = await ac.get(f"/api/v1/documents/{SLUG}")
    assert r0.status_code == 200, r0.text
    etag0 = r0.headers["etag"]
    r1 = await ac.put(
        f"/api/v1/documents/{SLUG}",
        json=sample,
        headers={"If-Match": etag0},
    )
    assert r1.status_code == 200, r1.text
    r2 = await ac.get(f"/api/v1/documents/{SLUG}")
    return r2.json()["data"], r2.headers["etag"]


async def _ensure_reader_token() -> str:
    email = "reader-version-restore@mx.local"
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
                {"e": email, "n": "Reader VR", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return make_access_token(uid)


@pytest.mark.asyncio
async def test_restore_happy_path() -> None:
    """v1 본문으로 head 를 덮어쓴다 — change_log 가 'restore-from-v1' 이고
    head 의 buffer 가 새 버전 (n+1) 으로 bump 된다."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        data0, etag0 = await _reset_to_sample(ac)
        v0 = data0["version"]

        # edit head — bumps version to v0+1
        r1 = await ac.patch(
            f"/api/v1/documents/{SLUG}/sections/{ROOT_SECTION_ID}",
            json={"title": "변경된 개요"},
            headers={"If-Match": etag0},
        )
        assert r1.status_code == 200, r1.text
        v1 = r1.json()["data"]["version"]
        assert v1 == v0 + 1

        # restore v0 — head should now match v0 content, version bumped again
        r2 = await ac.post(
            f"/api/v1/documents/{SLUG}/versions/{v0}/restore",
        )
        assert r2.status_code == 200, r2.text
        body = r2.json()
        assert body["error"] is None
        assert body["data"]["restored_from"] == v0
        assert body["data"]["version"] == v1 + 1
        assert "etag" in body["meta"]
        assert body["meta"]["change_log"] == f"restore-from-v{v0}"

        # head content reverts to original title
        r3 = await ac.get(f"/api/v1/documents/{SLUG}")
        assert r3.status_code == 200
        sec0 = r3.json()["data"]["content"]["sections"][0]
        # the sample's section[0] title is "개요" — same as the v1 baseline
        assert sec0["title"] == "개요"


@pytest.mark.asyncio
async def test_restore_404_on_unknown_version() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _reset_to_sample(ac)
        r = await ac.post(f"/api/v1/documents/{SLUG}/versions/99999/restore")
        assert r.status_code == 404, r.text
        assert r.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_restore_forbidden_for_reader() -> None:
    """reader 는 require_editor 를 통과하지 못해 403."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _reset_to_sample(ac)
        token = await _ensure_reader_token()
        r = await ac.post(
            f"/api/v1/documents/{SLUG}/versions/1/restore",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 403, r.text
        assert r.json()["error"]["code"] == "FORBIDDEN"
