"""Block-permission scrubbing across ALL response paths (cycle 12 R3).

Cycle 12 R2 added scrub to GET /documents/:slug. R3 extends scrub to:
  - PATCH /documents/:slug/sections/:id
  - PUT /documents/:slug
  - GET /documents/:slug/versions/:n
  - GET /share/:token (always at 'reader' tier)
  - export services (markdown/html/pptx/docx/pdf via requester_role kwarg)

The pure-helper scrub is exercised by `test_block_permissions.py`; this file
focuses on response-path wiring. We use a non-admin reader JWT to trigger the
scrub (dev fallback always returns admin).
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token
from app.main import app
from app.services.markdown_export import render_markdown

SLUG = "onboarding-guide"
_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = (
        Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
    )
SAMPLE_PATH = _SAMPLES / "02-onboarding-guide.json"

REDACTED_TEXT = "[권한이 부족한 블록]"


async def _ensure_reader_token() -> str:
    email = "reader-perm-paths@mx.local"
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
                {"e": email, "n": "Reader Perm", "pw": hash_password("test1234!")},
            )
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        uid = str(row[0])
    return make_access_token(uid)


def _load_sample_with_admin_block() -> dict[str, Any]:
    """Load onboarding-guide sample and inject one paragraph block with
    `meta.permission='admin'` into the first section's blocks."""
    sample = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    secs = sample["sections"]
    blocks = secs[0].setdefault("blocks", [])
    # Use a deterministic-looking ULID — uniqueness scope is just this doc.
    blocks.append({
        "type": "paragraph",
        "id": "01PERMADMNB000000000000000",
        "text": "secret-admin-only-text",
        "meta": {"permission": "admin"},
    })
    return sample


async def _put_sample(ac: AsyncClient, sample: dict[str, Any]) -> str:
    r0 = await ac.get(f"/api/v1/documents/{SLUG}")
    assert r0.status_code == 200, r0.text
    etag0 = r0.headers["etag"]
    r1 = await ac.put(
        f"/api/v1/documents/{SLUG}", json=sample, headers={"If-Match": etag0}
    )
    assert r1.status_code == 200, r1.text
    r2 = await ac.get(f"/api/v1/documents/{SLUG}")
    assert r2.status_code == 200
    return r2.headers["etag"]


def _bearer(t: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {t}"}


def _walk_blocks(content: dict[str, Any]):
    for sec in content.get("sections") or []:
        for blk in sec.get("blocks") or []:
            yield blk
        for sub in sec.get("subsections") or []:
            for blk in sub.get("blocks") or []:
                yield blk


def _find_admin_block(content: dict[str, Any]) -> dict[str, Any] | None:
    for blk in _walk_blocks(content):
        if blk.get("id") == "01PERMADMNB000000000000000":
            return blk
    return None


# ── PATCH section response is scrubbed ────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_section_response_scrubs_for_reader() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        sample = _load_sample_with_admin_block()
        etag = await _put_sample(ac, sample)
        # need editor+ to PATCH; reader gets 403. So first as admin (default
        # dev fallback) make the PATCH; the response shape is what we check.
        # But we want to confirm scrub happens for non-admin caller — emulate
        # by reading via a separate role-aware path.
        section_id = sample["sections"][0]["id"]
        # For PATCH we need editor+. Create a perm-test editor.
        async with session_scope() as s:
            ed_email = "editor-perm-paths@mx.local"
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": ed_email}
            )).first()
            if row is None:
                await s.execute(
                    text(
                        "INSERT INTO users (email, name, password_hash, role) "
                        "VALUES (:e, :n, :pw, 'editor')"
                    ),
                    {
                        "e": ed_email,
                        "n": "Editor Perm",
                        "pw": hash_password("test1234!"),
                    },
                )
                row = (await s.execute(
                    text("SELECT id FROM users WHERE email = :e"),
                    {"e": ed_email},
                )).first()
            ed_uid = str(row[0])
        ed_token = make_access_token(ed_uid)

        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/sections/{section_id}",
            json={"title": sample["sections"][0]["title"]},
            headers={"If-Match": etag, **_bearer(ed_token)},
        )
        assert r.status_code == 200, r.text
        section = r.json()["data"]["section"]
        # editor < admin → admin-permission block must be redacted in response
        admin_blk = next(
            (b for b in section["blocks"]
             if b.get("id") == "01PERMADMNB000000000000000"),
            None,
        )
        assert admin_blk is not None
        assert admin_blk["text"] == REDACTED_TEXT
        assert admin_blk["meta"]["permission"] == "admin"


# ── PUT response itself is the meta-only shape; check GET after PUT ───────
# (PUT response intentionally omits content; the scrub-on-write contract is
# enforced via subsequent reads. Test that GET after PUT scrubs.)


@pytest.mark.asyncio
async def test_get_after_put_scrubs_for_reader() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        sample = _load_sample_with_admin_block()
        await _put_sample(ac, sample)
        token = await _ensure_reader_token()
        r = await ac.get(f"/api/v1/documents/{SLUG}", headers=_bearer(token))
        assert r.status_code == 200, r.text
        content = r.json()["data"]["content"]
        admin_blk = _find_admin_block(content)
        assert admin_blk is not None
        assert admin_blk["text"] == REDACTED_TEXT


# ── GET versions/:n response is scrubbed ──────────────────────────────────


@pytest.mark.asyncio
async def test_get_version_n_response_scrubs_for_reader() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        sample = _load_sample_with_admin_block()
        await _put_sample(ac, sample)
        # find the latest version number
        rv = await ac.get(f"/api/v1/documents/{SLUG}/versions")
        assert rv.status_code == 200
        items = rv.json()["data"]
        assert items, "expected at least one version row"
        n = items[0]["version"]

        token = await _ensure_reader_token()
        r = await ac.get(
            f"/api/v1/documents/{SLUG}/versions/{n}", headers=_bearer(token)
        )
        assert r.status_code == 200, r.text
        content = r.json()["data"]["content"]
        admin_blk = _find_admin_block(content)
        assert admin_blk is not None
        assert admin_blk["text"] == REDACTED_TEXT
        assert admin_blk["meta"]["permission"] == "admin"


# ── GET share/:token always scrubs at 'reader' tier ───────────────────────


@pytest.mark.asyncio
async def test_share_link_always_scrubs_at_reader_tier() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        sample = _load_sample_with_admin_block()
        await _put_sample(ac, sample)
        # Wipe existing share-links then create a fresh one (admin creator).
        async with session_scope() as s:
            await s.execute(
                text(
                    "DELETE FROM share_links WHERE document_id = "
                    "(SELECT id FROM documents WHERE slug = :s)"
                ),
                {"s": SLUG},
            )
            await s.commit()

        cr = await ac.post(f"/api/v1/documents/{SLUG}/share", json={})
        assert cr.status_code == 201, cr.text
        token = cr.json()["data"]["token"]

        r = await ac.get(f"/api/v1/share/{token}")
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        admin_blk = _find_admin_block(body["document"])
        assert admin_blk is not None
        assert admin_blk["text"] == REDACTED_TEXT
        # row.content also scrubbed (FE renders from row.content)
        admin_blk2 = _find_admin_block(body["row"]["content"])
        assert admin_blk2 is not None
        assert admin_blk2["text"] == REDACTED_TEXT


# ── markdown export with reader role redacts ──────────────────────────────


def test_markdown_export_with_reader_role_redacts() -> None:
    sample = _load_sample_with_admin_block()
    out = render_markdown(sample, requester_role="reader")
    # The original admin text must NOT leak; the redaction marker MUST appear.
    assert "secret-admin-only-text" not in out
    assert REDACTED_TEXT in out


# ── markdown export with admin role does NOT redact ───────────────────────


def test_markdown_export_with_admin_role_preserves_content() -> None:
    sample = _load_sample_with_admin_block()
    out = render_markdown(sample, requester_role="admin")
    assert "secret-admin-only-text" in out
    assert REDACTED_TEXT not in out


# ── markdown export with no requester_role (default) does NOT redact ──────
# Backups call render_markdown without requester_role — they should retain
# the full content (admin-only access policy applies to backups themselves).


def test_markdown_export_without_role_does_not_redact() -> None:
    sample = _load_sample_with_admin_block()
    out = render_markdown(sample)  # no requester_role kwarg
    assert "secret-admin-only-text" in out
    assert REDACTED_TEXT not in out


# ── Caller's input is not mutated by scrub-on-render ──────────────────────


def test_render_markdown_does_not_mutate_input() -> None:
    sample = _load_sample_with_admin_block()
    snapshot = copy.deepcopy(sample)
    _ = render_markdown(sample, requester_role="reader")
    assert sample == snapshot
