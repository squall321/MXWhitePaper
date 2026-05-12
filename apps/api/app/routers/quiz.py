"""Quiz 라우터 — 문서 내 임베디드 quiz 블록 응시(attempt) 처리.

  - POST /api/v1/quiz/{slug}/{block_id}/attempts        (reader+) → 응시 + 채점
  - GET  /api/v1/quiz/{slug}/{block_id}/attempts        (editor+) → 응시 목록
  - GET  /api/v1/quiz/{slug}/{block_id}/leaderboard     (reader+) → 상위 10
  - GET  /api/v1/quiz/me/{slug}/{block_id}              (reader+) → 본인 응시

Form 블록과 달리 quiz 블록은 정답 키(`correct`) 가 본문에 들어 있어 서버에서
정규화하여 0~100 점수로 환산한다.  `max_attempts` 가 0 이면 무제한, 그 외
값에 도달하면 새 시도는 409 Conflict 로 거부된다.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor
from app.core.db import get_db
from app.core.errors import APIError, Conflict, NotFound, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1/quiz", tags=["quiz"])


@router.get("/definitions")
async def list_quiz_definitions(
    s: AsyncSession = Depends(get_db),
) -> dict:
    rows = (await s.execute(text(
        "SELECT id, title, description, passing_score, max_attempts "
        "FROM quiz_definitions ORDER BY id"
    ))).mappings().all()
    return envelope(
        data=[dict(r) for r in rows],
        meta={"total": len(rows), "source": "quiz_definitions"},
    )


@router.get("/definitions/{quiz_id:path}")
async def get_quiz_definition(
    quiz_id: str,
    s: AsyncSession = Depends(get_db),
) -> dict:
    row = (await s.execute(
        text("SELECT id, title, description, passing_score, max_attempts "
             "FROM quiz_definitions WHERE id = :id"),
        {"id": quiz_id},
    )).mappings().first()
    if not row:
        raise NotFound(f"quiz definition not found: {quiz_id}")
    qs = (await s.execute(
        text("SELECT question_id, kind, label, options, correct, explanation, points "
             "FROM quiz_questions WHERE quiz_id = :id ORDER BY sort_order"),
        {"id": quiz_id},
    )).mappings().all()
    return envelope(
        data={
            **dict(row),
            "questions": [
                {
                    "id": q["question_id"], "kind": q["kind"], "label": q["label"],
                    "options": q["options"], "correct": q["correct"],
                    "explanation": q["explanation"], "points": q["points"],
                }
                for q in qs
            ],
        },
        meta={"source": "quiz_definitions"},
    )


class QuizValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


class AttemptIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    duration_seconds: int = Field(default=0, ge=0)


# ── Doc/block lookup helpers (mirror forms.py shape) ─────────────────────


def _iter_blocks(sections: list[dict[str, Any]]) -> Any:
    for sec in sections or []:
        for blk in sec.get("blocks", []) or []:
            yield from _expand_block(blk)
        for sub in sec.get("subsections", []) or []:
            yield from _iter_blocks([sub])


def _expand_block(blk: dict[str, Any]) -> Any:
    yield blk
    t = blk.get("type")
    if t == "columns":
        for col in blk.get("columns", []) or []:
            for b in col or []:
                yield from _expand_block(b)
    elif t in ("tabs", "accordion"):
        items_key = "tabs" if t == "tabs" else "items"
        for entry in blk.get(items_key, []) or []:
            for b in entry.get("blocks", []) or []:
                yield from _expand_block(b)


def _find_quiz_block(doc_content: dict[str, Any], block_id: str) -> dict[str, Any] | None:
    for blk in _iter_blocks(doc_content.get("sections", []) or []):
        if blk.get("type") == "quiz" and blk.get("id") == block_id:
            return blk
    return None


# ── Scoring (pure helper — exposed for unit tests) ───────────────────────


def _is_question_correct(question: dict[str, Any], answer: Any) -> bool:
    """True if `answer` matches the `correct` key for the question."""
    kind = question.get("kind")
    correct = question.get("correct")

    if kind == "single-choice":
        return isinstance(answer, str) and answer == correct
    if kind == "true-false":
        if isinstance(answer, bool):
            return answer == correct
        # Tolerate "true"/"false" strings — common from form encoders.
        if isinstance(answer, str):
            lo = answer.strip().lower()
            if lo in ("true", "false"):
                return (lo == "true") == bool(correct)
        return False
    if kind == "short-text":
        if not isinstance(answer, str) or not isinstance(correct, str):
            return False
        return answer.strip().casefold() == correct.strip().casefold()
    if kind == "multi-choice":
        if not isinstance(answer, list) or not isinstance(correct, list):
            return False
        return set(map(str, answer)) == set(map(str, correct))
    return False


def score_attempt(quiz: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """Score `answers` against the `quiz.questions` array.

    Returns ``{score, passed, breakdown, explanations, total_points,
    earned_points}``.  ``score`` is 0..100 percent of available points; when
    every question has 0 points (degenerate) we fall back to question count
    to avoid div-by-zero.
    """
    if not isinstance(answers, dict):
        raise QuizValidationError("answers must be an object")

    questions = quiz.get("questions") or []
    by_id = {q["id"]: q for q in questions}
    unknown = set(answers.keys()) - set(by_id.keys())
    if unknown:
        raise QuizValidationError(f"unknown question id(s): {sorted(unknown)}")

    breakdown: list[dict[str, Any]] = []
    explanations: dict[str, str] = {}
    total = 0
    earned = 0
    for q in questions:
        qid = q["id"]
        pts = int(q.get("points", 1) or 0)
        ans = answers.get(qid)
        ok = _is_question_correct(q, ans)
        total += pts
        if ok:
            earned += pts
        breakdown.append({"question_id": qid, "correct": ok, "points": pts})
        if q.get("explanation"):
            explanations[qid] = str(q["explanation"])

    if total == 0:
        # All-zero-points quiz — fall back to question count parity.
        n = len(questions) or 1
        right = sum(1 for b in breakdown if b["correct"])
        score = round(100 * right / n)
    else:
        score = round(100 * earned / total)

    passing = int(quiz.get("passing_score", 70) or 0)
    passed = score >= passing
    return {
        "score": score,
        "passed": passed,
        "breakdown": breakdown,
        "explanations": explanations,
        "total_points": total,
        "earned_points": earned,
    }


async def _resolve_doc_and_quiz(
    s: AsyncSession, slug: str, block_id: str
) -> tuple[str, dict[str, Any]]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc or doc.get("status") == "archived":
        raise NotFound(f"document '{slug}' not found")
    quiz = _find_quiz_block(doc.get("content_json") or {}, block_id)
    if not quiz:
        raise NotFound(f"quiz block '{block_id}' not found in document")
    return str(doc["id"]), quiz


# ── Endpoints ────────────────────────────────────────────────────────────


@router.post(
    "/{slug}/{block_id}/attempts",
    status_code=201,
    summary="퀴즈 응시 + 자동 채점 (reader+)",
)
async def submit_attempt(
    body: AttemptIn,
    slug: str = Path(..., min_length=1),
    block_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    doc_id, quiz = await _resolve_doc_and_quiz(s, slug, block_id)

    # max_attempts 0 = unlimited; >0 = hard cap per (user, block).
    max_attempts = int(quiz.get("max_attempts", 0) or 0)
    if max_attempts > 0:
        used = (await s.execute(
            text(
                """
                SELECT COUNT(*) FROM quiz_attempts
                WHERE document_id = CAST(:d AS uuid)
                  AND block_id = :b
                  AND user_id = CAST(:u AS uuid)
                """
            ),
            {"d": doc_id, "b": block_id, "u": user["id"]},
        )).scalar() or 0
        if int(used) >= max_attempts:
            raise Conflict("max attempts exceeded")

    result = score_attempt(quiz, body.answers)

    row = (await s.execute(
        text(
            """
            INSERT INTO quiz_attempts
              (user_id, document_id, block_id, answers, score, passed,
               duration_seconds)
            VALUES
              (CAST(:u AS uuid), CAST(:d AS uuid), :b, CAST(:a AS jsonb),
               :s, :p, :ds)
            RETURNING id, submitted_at
            """
        ),
        {
            "u": user["id"],
            "d": doc_id,
            "b": block_id,
            "a": json.dumps(body.answers, ensure_ascii=False),
            "s": int(result["score"]),
            "p": bool(result["passed"]),
            "ds": int(body.duration_seconds),
        },
    )).first()
    new_id = str(row[0])

    await document_repo.insert_audit(
        s, user_id=user["id"], action="quiz.submit",
        target=f"quiz/{slug}/{block_id}/{new_id}",
        payload={
            "document_id": doc_id,
            "block_id": block_id,
            "score": int(result["score"]),
            "passed": bool(result["passed"]),
        },
    )
    await s.commit()

    show_answers = bool(quiz.get("show_answers_after", True))
    return envelope(data={
        "id": new_id,
        "score": int(result["score"]),
        "passed": bool(result["passed"]),
        "breakdown": result["breakdown"],
        "explanations": result["explanations"] if show_answers else {},
        "total_points": int(result["total_points"]),
        "earned_points": int(result["earned_points"]),
        "submitted_at": row[1].isoformat() if row[1] else None,
    })


@router.get(
    "/{slug}/{block_id}/attempts",
    summary="퀴즈 응시 기록 (editor+)",
)
async def list_attempts(
    slug: str,
    block_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    _ = user
    doc_id, _quiz = await _resolve_doc_and_quiz(s, slug, block_id)
    rows = (await s.execute(
        text(
            """
            SELECT a.id, a.user_id, a.answers, a.score, a.passed,
                   a.duration_seconds, a.submitted_at, u.name, u.email
            FROM quiz_attempts a
            LEFT JOIN users u ON u.id = a.user_id
            WHERE a.document_id = CAST(:d AS uuid) AND a.block_id = :b
            ORDER BY a.submitted_at DESC
            """
        ),
        {"d": doc_id, "b": block_id},
    )).all()

    items = []
    for r in rows:
        ans = r[2]
        if isinstance(ans, str):
            try:
                ans = json.loads(ans)
            except json.JSONDecodeError:
                ans = {}
        items.append({
            "id": str(r[0]),
            "user_id": str(r[1]) if r[1] else None,
            "answers": ans,
            "score": int(r[3]),
            "passed": bool(r[4]),
            "duration_seconds": int(r[5]),
            "submitted_at": r[6].isoformat() if r[6] else None,
            "submitter_name": r[7],
            "submitter_email": r[8],
        })

    return envelope(
        data={"items": items},
        meta={"count": len(items)},
    )


@router.get(
    "/{slug}/{block_id}/leaderboard",
    summary="퀴즈 리더보드 (reader+, 상위 10)",
)
async def leaderboard(
    slug: str,
    block_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    doc_id, _quiz = await _resolve_doc_and_quiz(s, slug, block_id)
    role = (user.get("role") or "").lower()
    is_admin = role == "admin"

    # Best score per user; tie-break by fastest duration_seconds.
    rows = (await s.execute(
        text(
            """
            SELECT DISTINCT ON (a.user_id)
                   a.user_id, a.score, a.duration_seconds, a.submitted_at,
                   u.name, u.email
            FROM quiz_attempts a
            LEFT JOIN users u ON u.id = a.user_id
            WHERE a.document_id = CAST(:d AS uuid) AND a.block_id = :b
              AND a.user_id IS NOT NULL
            ORDER BY a.user_id, a.score DESC, a.duration_seconds ASC
            """
        ),
        {"d": doc_id, "b": block_id},
    )).all()

    ranked = sorted(
        [
            {
                "user_id": str(r[0]),
                "score": int(r[1]),
                "duration_seconds": int(r[2]),
                "submitted_at": r[3].isoformat() if r[3] else None,
                "name": r[4],
                "email": r[5],
            }
            for r in rows
        ],
        key=lambda x: (-x["score"], x["duration_seconds"]),
    )[:10]

    items = []
    for i, r in enumerate(ranked, start=1):
        is_self = r["user_id"] == str(user["id"])
        # Anonymise non-admin viewers' peers; keep their own row identified.
        if is_admin or is_self:
            display = r["name"] or r["email"] or "익명"
        else:
            display = f"응시자 {i}"
        items.append({
            "rank": i,
            "score": r["score"],
            "duration_seconds": r["duration_seconds"],
            "submitted_at": r["submitted_at"],
            "display_name": display,
            "is_self": is_self,
        })

    return envelope(data={"items": items}, meta={"count": len(items)})


# Note: the `/me/...` endpoint sits under the same `quiz` prefix to keep
# the slug+block coupling in the path. Mirrors the `/me/reminders` shape.
@router.get(
    "/me/{slug}/{block_id}",
    summary="내 응시 기록 (reader+)",
)
async def my_attempts(
    slug: str,
    block_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    doc_id, quiz = await _resolve_doc_and_quiz(s, slug, block_id)
    rows = (await s.execute(
        text(
            """
            SELECT id, score, passed, duration_seconds, submitted_at
            FROM quiz_attempts
            WHERE document_id = CAST(:d AS uuid)
              AND block_id = :b
              AND user_id = CAST(:u AS uuid)
            ORDER BY submitted_at DESC
            """
        ),
        {"d": doc_id, "b": block_id, "u": user["id"]},
    )).all()

    items = [
        {
            "id": str(r[0]),
            "score": int(r[1]),
            "passed": bool(r[2]),
            "duration_seconds": int(r[3]),
            "submitted_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]
    max_attempts = int(quiz.get("max_attempts", 0) or 0)
    remaining = (
        None if max_attempts == 0 else max(0, max_attempts - len(items))
    )
    return envelope(
        data={"items": items},
        meta={
            "count": len(items),
            "max_attempts": max_attempts,
            "remaining": remaining,
        },
    )
