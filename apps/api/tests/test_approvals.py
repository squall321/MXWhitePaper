"""Approvals router — reviewer CRUD, decisions, status transitions, notifications.

Each test starts by wiping the seed document's reviewer rows + (when needed)
the document's status so transition tests are independent.
"""
from __future__ import annotations

from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import get_db
from app.main import app

SEED_SLUG = "month-end-closing"
EDITOR_EMAIL = "approval-editor@mx.local"
READER_EMAIL = "approval-reader@mx.local"


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def _new_session():
    gen = get_db()
    s = await anext(gen)
    return s, gen


async def _close_session(gen) -> None:
    try:
        await anext(gen)
    except StopAsyncIteration:
        pass


async def _ensure_user(email: str, role: str) -> str:
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                """
                INSERT INTO users (email, name, role, password_hash, is_active)
                VALUES (:e, :n, :r, 'placeholder', TRUE)
                ON CONFLICT (email) DO UPDATE
                  SET role = EXCLUDED.role, is_active = TRUE
                """
            ),
            {"e": email, "n": email.split("@")[0], "r": role},
        )
        await s.commit()
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        assert row is not None  # just upserted above
        return str(row[0])
    finally:
        await _close_session(gen)


async def _reset_doc_state() -> dict[str, Any]:
    """Clear reviewers + reset doc status to 'draft' so tests start clean."""
    s, gen = await _new_session()
    try:
        row = (await s.execute(
            text("SELECT id, owner_id FROM documents WHERE slug = :s"),
            {"s": SEED_SLUG},
        )).first()
        assert row is not None, f"seed document {SEED_SLUG!r} missing"
        doc_id = str(row[0])
        owner_id = str(row[1])
        await s.execute(
            text("DELETE FROM document_reviewers WHERE document_id = CAST(:d AS uuid)"),
            {"d": doc_id},
        )
        await s.execute(
            text("UPDATE documents SET status='draft' WHERE id = CAST(:d AS uuid)"),
            {"d": doc_id},
        )
        await s.execute(
            text(
                "DELETE FROM notifications "
                "WHERE kind IN ('review_request','review_decision')"
            ),
        )
        await s.commit()
        return {"id": doc_id, "owner_id": owner_id}
    finally:
        await _close_session(gen)


@pytest.fixture(autouse=True)
async def _restore_seed_doc():
    """Other test files (e.g. test_documents) expect the seed doc back at
    `status='published'` with no reviewers attached. Reset on teardown."""
    yield
    s, gen = await _new_session()
    try:
        await s.execute(
            text(
                """
                DELETE FROM document_reviewers
                WHERE document_id = (SELECT id FROM documents WHERE slug = :s)
                """
            ),
            {"s": SEED_SLUG},
        )
        await s.execute(
            text("UPDATE documents SET status='published' WHERE slug = :s"),
            {"s": SEED_SLUG},
        )
        await s.execute(
            text(
                "DELETE FROM notifications "
                "WHERE kind IN ('review_request','review_decision')"
            ),
        )
        await s.commit()
    finally:
        await _close_session(gen)


def _bearer(jwt: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {jwt}"}


@pytest.mark.asyncio
async def test_add_list_remove_reviewer() -> None:
    await _reset_doc_state()
    reviewer_id = await _ensure_user(READER_EMAIL, "reader")

    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )
        assert r.status_code == 201, r.text
        data = r.json()["data"]
        assert reviewer_id in data["added"]
        assert any(it["reviewer_user_id"] == reviewer_id for it in data["items"])
        assert all(it["status"] == "pending" for it in data["items"])

        # Idempotent — second call should skip.
        r2 = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )
        assert r2.status_code == 201
        assert reviewer_id in r2.json()["data"]["skipped"]

        rl = await ac.get(f"/api/v1/documents/{SEED_SLUG}/reviewers")
        assert rl.status_code == 200
        items = rl.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["reviewer_user_id"] == reviewer_id

        rd = await ac.delete(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}"
        )
        assert rd.status_code == 204
        rl2 = await ac.get(f"/api/v1/documents/{SEED_SLUG}/reviewers")
        assert rl2.json()["data"]["items"] == []


@pytest.mark.asyncio
async def test_reviewer_decision_approve_reject_changes() -> None:
    await _reset_doc_state()
    reviewer_id = await _ensure_user(READER_EMAIL, "reader")

    from app.core.security import make_access_token

    reviewer_jwt = make_access_token(reviewer_id)

    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )

        # approve
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "approved", "comment": "LGTM"},
            headers=_bearer(reviewer_jwt),
        )
        assert r.status_code == 200, r.text
        items = r.json()["data"]["items"]
        assert items[0]["status"] == "approved"
        assert items[0]["comment"] == "LGTM"

        # reject
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "rejected"},
            headers=_bearer(reviewer_jwt),
        )
        assert r.status_code == 200
        assert r.json()["data"]["items"][0]["status"] == "rejected"

        # changes_requested
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "changes_requested", "comment": "차트 보완 필요"},
            headers=_bearer(reviewer_jwt),
        )
        assert r.status_code == 200
        assert r.json()["data"]["items"][0]["status"] == "changes_requested"

        # invalid status → 422
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "WRONG"},
            headers=_bearer(reviewer_jwt),
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_decision_by_other_user_returns_403() -> None:
    await _reset_doc_state()
    reviewer_id = await _ensure_user(READER_EMAIL, "reader")
    other_id = await _ensure_user(EDITOR_EMAIL, "editor")
    from app.core.security import make_access_token

    other_jwt = make_access_token(other_id)
    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "approved"},
            headers=_bearer(other_jwt),
        )
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_transition_draft_to_in_review() -> None:
    await _reset_doc_state()
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "in_review"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["status"] == "in_review"


@pytest.mark.asyncio
async def test_transition_in_review_to_approved_blocked_when_not_unanimous() -> None:
    await _reset_doc_state()
    reviewer_id = await _ensure_user(READER_EMAIL, "reader")
    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "in_review"},
        )
        # No reviewer has approved yet.
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "approved"},
        )
        assert r.status_code == 422
        assert "all reviewers must approve" in r.json()["error"]["message"]


@pytest.mark.asyncio
async def test_transition_in_review_to_approved_works_after_unanimous() -> None:
    await _reset_doc_state()
    reviewer_id = await _ensure_user(READER_EMAIL, "reader")
    from app.core.security import make_access_token

    reviewer_jwt = make_access_token(reviewer_id)

    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "in_review"},
        )
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "approved"},
            headers=_bearer(reviewer_jwt),
        )
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "approved"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["status"] == "approved"


@pytest.mark.asyncio
async def test_transition_approved_to_published() -> None:
    await _reset_doc_state()
    reviewer_id = await _ensure_user(READER_EMAIL, "reader")
    from app.core.security import make_access_token

    reviewer_jwt = make_access_token(reviewer_id)
    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "in_review"},
        )
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "approved"},
            headers=_bearer(reviewer_jwt),
        )
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "approved"},
        )
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "published"},
        )
        assert r.status_code == 200
        assert r.json()["data"]["status"] == "published"


@pytest.mark.asyncio
async def test_illegal_transition_returns_422() -> None:
    await _reset_doc_state()
    async with await _client() as ac:
        # archived → published is illegal (must go via draft first).
        # Set the doc to archived first.
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "archived"},
        )
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "published"},
        )
        assert r.status_code == 422
        details = r.json()["error"]["details"]
        assert details["from"] == "archived"
        assert details["to"] == "published"


@pytest.mark.asyncio
async def test_draft_to_published_direct_is_allowed() -> None:
    """The "바로 게시" shortcut — imported / internal-wiki docs skip review."""
    await _reset_doc_state()
    async with await _client() as ac:
        r = await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/transition",
            json={"status": "published"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["status"] == "published"


@pytest.mark.asyncio
async def test_reviewer_added_creates_notification() -> None:
    state = await _reset_doc_state()
    reviewer_id = await _ensure_user(READER_EMAIL, "reader")
    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )

    s, gen = await _new_session()
    try:
        rows = (await s.execute(
            text(
                """
                SELECT kind FROM notifications
                WHERE user_id = CAST(:u AS uuid) AND kind = 'review_request'
                """
            ),
            {"u": reviewer_id},
        )).all()
        assert len(rows) == 1
    finally:
        await _close_session(gen)

    # And a decision should notify the doc author.
    from app.core.security import make_access_token

    reviewer_jwt = make_access_token(reviewer_id)
    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "approved"},
            headers=_bearer(reviewer_jwt),
        )

    s, gen = await _new_session()
    try:
        rows = (await s.execute(
            text(
                """
                SELECT kind FROM notifications
                WHERE user_id = CAST(:u AS uuid) AND kind = 'review_decision'
                """
            ),
            {"u": state["owner_id"]},
        )).all()
        assert len(rows) >= 1
    finally:
        await _close_session(gen)


@pytest.mark.asyncio
async def test_my_reviews_lists_only_active() -> None:
    await _reset_doc_state()
    reviewer_id = await _ensure_user(READER_EMAIL, "reader")
    from app.core.security import make_access_token

    reviewer_jwt = make_access_token(reviewer_id)
    async with await _client() as ac:
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers",
            json={"user_ids": [reviewer_id]},
        )

        r = await ac.get("/api/v1/me/reviews", headers=_bearer(reviewer_jwt))
        assert r.status_code == 200
        items = r.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["slug"] == SEED_SLUG
        assert items[0]["review_status"] == "pending"

        # After approving, it disappears.
        await ac.post(
            f"/api/v1/documents/{SEED_SLUG}/reviewers/{reviewer_id}/decision",
            json={"status": "approved"},
            headers=_bearer(reviewer_jwt),
        )
        r2 = await ac.get("/api/v1/me/reviews", headers=_bearer(reviewer_jwt))
        assert r2.json()["data"]["items"] == []
