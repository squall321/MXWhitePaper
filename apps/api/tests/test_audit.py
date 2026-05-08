"""Sprint 6 — write 후 audit_logs 행 검증."""
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
