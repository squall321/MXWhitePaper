"""Tests for forms router (embedded form/survey block)."""
from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.routers.forms import _aggregate, validate_answers

SEED_SLUG = "form-survey-sample"
FORM_BLOCK_ID = "01J9X1Y2Z3A4B5C6D7E8F9GFF1"


@pytest.fixture
async def _clean_responses() -> AsyncIterator[None]:
    """Clear responses for this form block before each integration test."""
    from sqlalchemy import text

    from app.core.db import engine as get_engine
    eng = get_engine()
    async with eng.begin() as conn:
        await conn.execute(
            text("DELETE FROM form_responses WHERE block_id = :b"),
            {"b": FORM_BLOCK_ID},
        )
    yield None


# ── Pure helpers (no DB) ──────────────────────────────────────────────────


def _form() -> dict:
    return {
        "type": "form",
        "id": FORM_BLOCK_ID,
        "questions": [
            {"id": "q1", "kind": "text", "label": "이름", "required": True},
            {"id": "q2", "kind": "email", "label": "이메일"},
            {"id": "q3", "kind": "select", "label": "팀", "options": ["A", "B"]},
            {"id": "q4", "kind": "rating-5", "label": "만족도"},
            {"id": "q5", "kind": "number", "label": "나이"},
        ],
    }


def test_validate_answers_required() -> None:
    with pytest.raises(Exception) as ei:
        validate_answers(_form(), {})
    assert "required" in str(ei.value).lower() or "이름" in str(ei.value)


def test_validate_answers_email_format() -> None:
    with pytest.raises(Exception):
        validate_answers(_form(), {"q1": "Hong", "q2": "not-an-email"})


def test_validate_answers_select_options() -> None:
    with pytest.raises(Exception):
        validate_answers(_form(), {"q1": "Hong", "q3": "Z"})


def test_validate_answers_rating_range() -> None:
    with pytest.raises(Exception):
        validate_answers(_form(), {"q1": "Hong", "q4": 9})


def test_validate_answers_number_string_coerced() -> None:
    out = validate_answers(_form(), {"q1": "Hong", "q5": "42"})
    assert out["q5"] == 42.0


def test_validate_answers_unknown_id_rejected() -> None:
    with pytest.raises(Exception):
        validate_answers(_form(), {"q1": "Hong", "q-bogus": "x"})


def test_aggregate_select_counts() -> None:
    form = _form()
    rows = [
        {"answers": {"q3": "A"}},
        {"answers": {"q3": "A"}},
        {"answers": {"q3": "B"}},
    ]
    summary = _aggregate(form, rows)
    by_id = {q["question_id"]: q for q in summary}
    assert by_id["q3"]["counts"] == [
        {"option": "A", "count": 2},
        {"option": "B", "count": 1},
    ]


def test_aggregate_number_min_max_avg() -> None:
    form = _form()
    rows = [
        {"answers": {"q5": 10}},
        {"answers": {"q5": 20}},
        {"answers": {"q5": 30}},
    ]
    summary = _aggregate(form, rows)
    n = next(q for q in summary if q["question_id"] == "q5")
    assert n["min"] == 10 and n["max"] == 30 and n["avg"] == 20


# ── BE integration tests ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_submit_then_list_responses(_clean_responses) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            f"/api/v1/forms/{SEED_SLUG}/{FORM_BLOCK_ID}/responses",
            json={
                "answers": {
                    "q-name": "테스터",
                    "q-email": "tester@example.com",
                    "q-team": "MX 1팀",
                    "q-rating": 4,
                }
            },
        )
        assert r1.status_code == 201, r1.text
        rid = r1.json()["data"]["id"]
        assert rid

        # GET responses
        r2 = await ac.get(
            f"/api/v1/forms/{SEED_SLUG}/{FORM_BLOCK_ID}/responses"
        )
        assert r2.status_code == 200, r2.text
        items = r2.json()["data"]["items"]
        assert any(it["id"] == rid for it in items)


@pytest.mark.asyncio
async def test_submit_validation_email_rejected(_clean_responses) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/v1/forms/{SEED_SLUG}/{FORM_BLOCK_ID}/responses",
            json={
                "answers": {
                    "q-name": "X",
                    "q-email": "not-an-email",
                    "q-team": "MX 1팀",
                    "q-rating": 5,
                }
            },
        )
        assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_aggregate_endpoint(_clean_responses) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            f"/api/v1/forms/{SEED_SLUG}/{FORM_BLOCK_ID}/aggregate"
        )
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert "questions" in data
        assert isinstance(data["questions"], list)


@pytest.mark.asyncio
async def test_multi_response_blocked_when_disabled(_clean_responses) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # First response (may already exist; ignore status)
        await ac.post(
            f"/api/v1/forms/{SEED_SLUG}/{FORM_BLOCK_ID}/responses",
            json={
                "answers": {
                    "q-name": "Once",
                    "q-email": "once@example.com",
                    "q-team": "MX 1팀",
                    "q-rating": 3,
                }
            },
        )
        # Second response from same user → 409
        r = await ac.post(
            f"/api/v1/forms/{SEED_SLUG}/{FORM_BLOCK_ID}/responses",
            json={
                "answers": {
                    "q-name": "Again",
                    "q-email": "again@example.com",
                    "q-team": "MX 1팀",
                    "q-rating": 5,
                }
            },
        )
        assert r.status_code == 409, r.text


@pytest.mark.asyncio
async def test_submit_unknown_form_block_404() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/v1/forms/{SEED_SLUG}/01ZZZZZZZZZZZZZZZZZZZZZZZZ/responses",
            json={"answers": {}},
        )
        assert r.status_code == 404
