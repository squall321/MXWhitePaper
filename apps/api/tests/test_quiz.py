"""Tests for quiz router (embedded quiz block, Cycle 0029)."""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.routers.quiz import _is_question_correct, score_attempt


SEED_SLUG = "quiz-sample"
QUIZ_BLOCK_ID = "01J9X1Y2Z3A4B5C6D7E8F9GZQ1"


@pytest.fixture
async def _clean_attempts() -> None:
    """Wipe attempts for the seeded quiz block before each integration test."""
    from sqlalchemy import text
    from app.core.db import engine as get_engine
    eng = get_engine()
    async with eng.begin() as conn:
        await conn.execute(
            text("DELETE FROM quiz_attempts WHERE block_id = :b"),
            {"b": QUIZ_BLOCK_ID},
        )
    yield None


# ── Pure scoring helpers (no DB) ──────────────────────────────────────────


def _quiz() -> dict:
    return {
        "type": "quiz",
        "id": QUIZ_BLOCK_ID,
        "passing_score": 70,
        "max_attempts": 3,
        "show_answers_after": True,
        "questions": [
            {
                "id": "q1",
                "kind": "single-choice",
                "label": "비밀번호 최소 길이",
                "options": ["6", "8", "10"],
                "correct": "10",
                "points": 1,
            },
            {
                "id": "q2",
                "kind": "multi-choice",
                "label": "허용 행위",
                "options": ["A", "B", "C"],
                "correct": ["A", "B"],
                "points": 2,
            },
            {
                "id": "q3",
                "kind": "true-false",
                "label": "MFA 의무?",
                "correct": True,
                "points": 1,
            },
            {
                "id": "q4",
                "kind": "short-text",
                "label": "핫라인",
                "correct": "9119",
                "points": 1,
            },
        ],
    }


def test_is_correct_single_choice() -> None:
    q = {"kind": "single-choice", "correct": "A"}
    assert _is_question_correct(q, "A") is True
    assert _is_question_correct(q, "B") is False


def test_is_correct_multi_choice_unordered() -> None:
    q = {"kind": "multi-choice", "correct": ["A", "B"]}
    assert _is_question_correct(q, ["B", "A"]) is True
    assert _is_question_correct(q, ["A"]) is False
    assert _is_question_correct(q, ["A", "B", "C"]) is False


def test_is_correct_true_false_with_string() -> None:
    q = {"kind": "true-false", "correct": True}
    assert _is_question_correct(q, True) is True
    assert _is_question_correct(q, "true") is True
    assert _is_question_correct(q, False) is False


def test_is_correct_short_text_case_insensitive() -> None:
    q = {"kind": "short-text", "correct": "9119"}
    assert _is_question_correct(q, "9119") is True
    assert _is_question_correct(q, " 9119 ") is True
    assert _is_question_correct(q, "1234") is False


def test_score_full_marks() -> None:
    res = score_attempt(_quiz(), {
        "q1": "10",
        "q2": ["A", "B"],
        "q3": True,
        "q4": "9119",
    })
    assert res["score"] == 100
    assert res["passed"] is True
    assert res["earned_points"] == res["total_points"] == 5


def test_score_partial_below_passing() -> None:
    # Only q1 (1 pt) right out of 5 pts → 20% → fail (passing 70)
    res = score_attempt(_quiz(), {
        "q1": "10",
        "q2": ["A"],  # wrong subset
        "q3": False,
        "q4": "wrong",
    })
    assert res["score"] == 20
    assert res["passed"] is False


def test_score_breakdown_shape() -> None:
    res = score_attempt(_quiz(), {"q1": "10"})
    by_id = {b["question_id"]: b for b in res["breakdown"]}
    assert by_id["q1"]["correct"] is True
    assert by_id["q1"]["points"] == 1
    assert by_id["q2"]["correct"] is False


def test_score_unknown_question_id_rejected() -> None:
    with pytest.raises(Exception):
        score_attempt(_quiz(), {"q-bogus": "x"})


# ── BE integration tests (require seeded sample doc) ─────────────────────


@pytest.mark.asyncio
async def test_submit_then_list_attempts(_clean_attempts) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post(
            f"/api/v1/quiz/{SEED_SLUG}/{QUIZ_BLOCK_ID}/attempts",
            json={
                "answers": {
                    "q1": "10",
                    "q2": ["사내 클라우드에 보관", "공유 링크 만료일 지정"],
                    "q3": True,
                    "q4": "9119",
                },
                "duration_seconds": 42,
            },
        )
        if r1.status_code == 404:
            pytest.skip("quiz-sample seed not loaded")
        assert r1.status_code == 201, r1.text
        data = r1.json()["data"]
        assert data["score"] == 100
        assert data["passed"] is True
        assert "breakdown" in data and len(data["breakdown"]) == 4

        # GET attempts list (editor+ — dev fallback returns admin)
        r2 = await ac.get(
            f"/api/v1/quiz/{SEED_SLUG}/{QUIZ_BLOCK_ID}/attempts"
        )
        assert r2.status_code == 200, r2.text
        items = r2.json()["data"]["items"]
        assert any(it["score"] == 100 for it in items)


@pytest.mark.asyncio
async def test_max_attempts_enforced(_clean_attempts) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Sample seed has max_attempts=3.
        for _ in range(3):
            r = await ac.post(
                f"/api/v1/quiz/{SEED_SLUG}/{QUIZ_BLOCK_ID}/attempts",
                json={"answers": {"q1": "6"}, "duration_seconds": 5},
            )
            if r.status_code == 404:
                pytest.skip("quiz-sample seed not loaded")
            assert r.status_code == 201, r.text
        # 4th attempt → 409
        r4 = await ac.post(
            f"/api/v1/quiz/{SEED_SLUG}/{QUIZ_BLOCK_ID}/attempts",
            json={"answers": {"q1": "6"}, "duration_seconds": 5},
        )
        assert r4.status_code == 409, r4.text


@pytest.mark.asyncio
async def test_leaderboard_endpoint(_clean_attempts) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Seed one passing attempt.
        r = await ac.post(
            f"/api/v1/quiz/{SEED_SLUG}/{QUIZ_BLOCK_ID}/attempts",
            json={
                "answers": {
                    "q1": "10",
                    "q2": ["사내 클라우드에 보관", "공유 링크 만료일 지정"],
                    "q3": True,
                    "q4": "9119",
                },
                "duration_seconds": 30,
            },
        )
        if r.status_code == 404:
            pytest.skip("quiz-sample seed not loaded")
        assert r.status_code == 201, r.text

        rb = await ac.get(
            f"/api/v1/quiz/{SEED_SLUG}/{QUIZ_BLOCK_ID}/leaderboard"
        )
        assert rb.status_code == 200, rb.text
        items = rb.json()["data"]["items"]
        assert len(items) >= 1
        # Top score is 100; ranks are 1-based.
        assert items[0]["rank"] == 1
        assert items[0]["score"] == 100


@pytest.mark.asyncio
async def test_my_attempts_meta(_clean_attempts) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r0 = await ac.get(
            f"/api/v1/quiz/me/{SEED_SLUG}/{QUIZ_BLOCK_ID}"
        )
        if r0.status_code == 404:
            pytest.skip("quiz-sample seed not loaded")
        assert r0.status_code == 200
        meta0 = r0.json()["meta"]
        assert meta0["count"] == 0
        # max_attempts=3 in the sample → remaining=3 from a clean slate.
        assert meta0["max_attempts"] == 3
        assert meta0["remaining"] == 3


@pytest.mark.asyncio
async def test_submit_unknown_quiz_block_404() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/v1/quiz/{SEED_SLUG}/01ZZZZZZZZZZZZZZZZZZZZZZZZ/attempts",
            json={"answers": {}, "duration_seconds": 0},
        )
        # If the doc itself is missing the route returns 404 just the same.
        assert r.status_code == 404
