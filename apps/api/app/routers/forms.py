"""Forms 라우터 — 문서 내 임베디드 form/survey 블록 응답 처리.

  - POST /api/v1/forms/{slug}/{block_id}/responses   (reader+) → 응답 제출
  - GET  /api/v1/forms/{slug}/{block_id}/responses   (editor+) → 응답 목록 (페이지네이션)
  - GET  /api/v1/forms/{slug}/{block_id}/aggregate   (editor+) → 질문별 집계

응답 검증은 form 블록의 `questions` 정의를 따른다. allow_multiple_responses=false
이고 동일 user_id 가 이미 제출한 경우 409 Conflict.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor
from app.core.db import get_db
from app.core.errors import APIError, Conflict, NotFound, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1/forms", tags=["forms"])


@router.get("/definitions")
async def list_form_definitions(
    s: AsyncSession = Depends(get_db),
) -> dict:
    """Catalog of canonical form definitions (seeded from sample blocks
    into the form_definitions table)."""
    rows = (await s.execute(text(
        "SELECT id, title, description, submit_label, thanks_text, max_attempts "
        "FROM form_definitions ORDER BY id"
    ))).mappings().all()
    out = []
    for r in rows:
        out.append({
            "id": r["id"], "title": r["title"], "description": r["description"],
            "submit_label": r["submit_label"], "thanks_text": r["thanks_text"],
            "max_attempts": r["max_attempts"],
        })
    return envelope(data=out, meta={"total": len(out), "source": "form_definitions"})


@router.get("/definitions/{form_id:path}")
async def get_form_definition(
    form_id: str,
    s: AsyncSession = Depends(get_db),
) -> dict:
    """Single form definition + its fields."""
    row = (await s.execute(
        text("SELECT id, title, description, submit_label, thanks_text, max_attempts "
             "FROM form_definitions WHERE id = :id"),
        {"id": form_id},
    )).mappings().first()
    if not row:
        raise NotFound(f"form definition not found: {form_id}")
    fields = (await s.execute(
        text("SELECT question_id, kind, label, required, placeholder, options "
             "FROM form_fields WHERE form_id = :id ORDER BY sort_order"),
        {"id": form_id},
    )).mappings().all()
    return envelope(
        data={
            **{k: row[k] for k in row.keys()},
            "questions": [
                {
                    "id": f["question_id"], "kind": f["kind"], "label": f["label"],
                    "required": bool(f["required"]), "placeholder": f["placeholder"],
                    "options": f["options"],  # asyncpg returns parsed JSON for JSONB
                }
                for f in fields
            ],
        },
        meta={"source": "form_definitions"},
    )

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class FormValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


class ResponseIn(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)


def _iter_blocks(sections: list[dict[str, Any]]) -> Any:
    """모든 section/subsection 의 blocks 를 평탄화. columns/tabs/accordion 컨테이너도 재귀."""
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


def _find_form_block(doc_content: dict[str, Any], block_id: str) -> dict[str, Any] | None:
    sections = doc_content.get("sections", []) or []
    for blk in _iter_blocks(sections):
        if blk.get("type") == "form" and blk.get("id") == block_id:
            return blk
    return None


def _validate_answer(question: dict[str, Any], value: Any) -> Any:
    """질문 정의에 따른 답변 검증 + 정규화. 위반 시 FormValidationError."""
    kind = question["kind"]
    qid = question["id"]
    label = question.get("label", qid)
    is_required = bool(question.get("required", False))

    # 빈 답변 처리
    is_empty = (
        value is None
        or (isinstance(value, str) and value.strip() == "")
        or (isinstance(value, list) and len(value) == 0)
    )
    if is_empty:
        if is_required:
            raise FormValidationError(f"'{label}' is required")
        return None

    if kind in ("text", "long-text"):
        if not isinstance(value, str):
            raise FormValidationError(f"'{label}' must be a string")
        max_len = 5000 if kind == "long-text" else 500
        if len(value) > max_len:
            raise FormValidationError(f"'{label}' exceeds {max_len} chars")
        return value
    if kind == "email":
        if not isinstance(value, str) or not EMAIL_RE.match(value):
            raise FormValidationError(f"'{label}' is not a valid email")
        return value
    if kind == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            # 문자열 숫자도 허용
            if isinstance(value, str):
                try:
                    return float(value)
                except ValueError as e:
                    raise FormValidationError(f"'{label}' is not a number") from e
            raise FormValidationError(f"'{label}' is not a number")
        return value
    if kind == "select":
        opts = question.get("options") or []
        if not isinstance(value, str) or value not in opts:
            raise FormValidationError(
                f"'{label}' must be one of provided options"
            )
        return value
    if kind == "multi-select":
        opts = question.get("options") or []
        if not isinstance(value, list):
            raise FormValidationError(f"'{label}' must be a list")
        for v in value:
            if v not in opts:
                raise FormValidationError(
                    f"'{label}' contains an unknown option"
                )
        return value
    if kind == "checkbox":
        if not isinstance(value, bool):
            raise FormValidationError(f"'{label}' must be a boolean")
        return value
    if kind == "rating-5":
        if not isinstance(value, (int, float, str)) or isinstance(value, bool):
            raise FormValidationError(f"'{label}' must be an integer 1..5")
        try:
            n = int(value)
        except (TypeError, ValueError) as e:
            raise FormValidationError(f"'{label}' must be an integer 1..5") from e
        if not (1 <= n <= 5):
            raise FormValidationError(f"'{label}' must be between 1 and 5")
        return n
    if kind == "date":
        if not isinstance(value, str) or not ISO_DATE_RE.match(value):
            raise FormValidationError(f"'{label}' must be YYYY-MM-DD")
        try:
            datetime.strptime(value, "%Y-%m-%d")
        except ValueError as e:
            raise FormValidationError(f"'{label}' is not a valid date") from e
        return value
    raise FormValidationError(f"unknown question kind '{kind}'")


def validate_answers(form_block: dict[str, Any], answers: dict[str, Any]) -> dict[str, Any]:
    """모든 질문에 대해 검증. 결과는 정규화된 answers."""
    if not isinstance(answers, dict):
        raise FormValidationError("answers must be an object")
    questions = form_block.get("questions") or []
    by_id = {q["id"]: q for q in questions}
    out: dict[str, Any] = {}
    for q in questions:
        v = answers.get(q["id"])
        normalized = _validate_answer(q, v)
        if normalized is not None:
            out[q["id"]] = normalized
    # 정의되지 않은 키는 무시 (데이터 보존을 원할 경우 추가 가능 — 현재는 drop)
    unknown = set(answers.keys()) - set(by_id.keys())
    if unknown:
        # 알 수 없는 질문 ID 는 거부
        raise FormValidationError(
            f"unknown question id(s): {sorted(unknown)}"
        )
    return out


async def _resolve_doc_and_form(
    s: AsyncSession, slug: str, block_id: str
) -> tuple[str, dict[str, Any]]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc or doc.get("status") == "archived":
        raise NotFound(f"document '{slug}' not found")
    form = _find_form_block(doc.get("content_json") or {}, block_id)
    if not form:
        raise NotFound(f"form block '{block_id}' not found in document")
    return str(doc["id"]), form


@router.post(
    "/{slug}/{block_id}/responses",
    status_code=201,
    summary="폼 응답 제출 (reader+)",
)
async def submit_response(
    body: ResponseIn,
    slug: str = Path(..., min_length=1),
    block_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    doc_id, form = await _resolve_doc_and_form(s, slug, block_id)
    normalized = validate_answers(form, body.answers)

    allow_multi = bool(form.get("allow_multiple_responses", False))
    if not allow_multi:
        existing = (await s.execute(
            text("""
                SELECT 1 FROM form_responses
                WHERE document_id = CAST(:d AS uuid)
                  AND block_id = :b
                  AND user_id = CAST(:u AS uuid)
                LIMIT 1
            """),
            {"d": doc_id, "b": block_id, "u": user["id"]},
        )).first()
        if existing:
            raise Conflict("already submitted")

    row = (await s.execute(
        text("""
            INSERT INTO form_responses
              (document_id, block_id, user_id, answers)
            VALUES
              (CAST(:d AS uuid), :b, CAST(:u AS uuid), CAST(:a AS jsonb))
            RETURNING id, submitted_at
        """),
        {
            "d": doc_id, "b": block_id, "u": user["id"],
            "a": json.dumps(normalized, ensure_ascii=False),
        },
    )).first()
    assert row is not None  # INSERT...RETURNING always emits one row
    new_id = str(row[0])

    await document_repo.insert_audit(
        s, user_id=user["id"], action="form.submit",
        target=f"forms/{slug}/{block_id}/{new_id}",
        payload={"document_id": doc_id, "block_id": block_id},
    )
    await s.commit()

    return envelope(data={
        "id": new_id,
        "document_id": doc_id,
        "block_id": block_id,
        "answers": normalized,
        "submitted_at": row[1].isoformat() if row[1] else None,
    })


@router.get(
    "/{slug}/{block_id}/responses",
    summary="폼 응답 목록 (editor+, 페이지네이션)",
)
async def list_responses(
    slug: str,
    block_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    _ = user
    doc_id, _form = await _resolve_doc_and_form(s, slug, block_id)
    rows = (await s.execute(
        text("""
            SELECT r.id, r.user_id, r.answers, r.submitted_at,
                   u.name, u.email
            FROM form_responses r
            LEFT JOIN users u ON u.id = r.user_id
            WHERE r.document_id = CAST(:d AS uuid) AND r.block_id = :b
            ORDER BY r.submitted_at DESC
            LIMIT :lim OFFSET :off
        """),
        {"d": doc_id, "b": block_id, "lim": limit, "off": offset},
    )).all()
    total = (await s.execute(
        text("""
            SELECT COUNT(*) FROM form_responses
            WHERE document_id = CAST(:d AS uuid) AND block_id = :b
        """),
        {"d": doc_id, "b": block_id},
    )).scalar() or 0

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
            "submitted_at": r[3].isoformat() if r[3] else None,
            "submitter_name": r[4],
            "submitter_email": r[5],
        })

    return envelope(
        data={"items": items},
        meta={"count": len(items), "total": int(total),
              "limit": limit, "offset": offset},
    )


def _aggregate(form: dict[str, Any], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    questions = form.get("questions") or []
    out: list[dict[str, Any]] = []
    for q in questions:
        qid = q["id"]
        kind = q["kind"]
        values = [
            r["answers"].get(qid)
            for r in rows
            if isinstance(r.get("answers"), dict) and r["answers"].get(qid) is not None
        ]
        entry: dict[str, Any] = {
            "question_id": qid,
            "label": q.get("label"),
            "kind": kind,
            "response_count": len(values),
        }
        if kind in ("select", "rating-5"):
            counts = Counter(values)
            entry["counts"] = [
                {"option": str(k), "count": v}
                for k, v in counts.most_common()
            ]
        elif kind == "multi-select":
            counts: Counter = Counter()
            for v in values:
                if isinstance(v, list):
                    counts.update(v)
            entry["counts"] = [
                {"option": str(k), "count": v}
                for k, v in counts.most_common()
            ]
        elif kind in ("text", "long-text"):
            samples = []
            for v in values[:5]:
                if isinstance(v, str):
                    samples.append(v[:120])
            entry["samples"] = samples
        elif kind == "number":
            nums = [float(v) for v in values if isinstance(v, (int, float))]
            if nums:
                entry["min"] = min(nums)
                entry["max"] = max(nums)
                entry["avg"] = sum(nums) / len(nums)
            else:
                entry["min"] = entry["max"] = entry["avg"] = None
        elif kind == "date":
            # ISO 주(year-Wnn) 단위 히스토그램
            buckets: Counter = Counter()
            for v in values:
                if isinstance(v, str) and ISO_DATE_RE.match(v):
                    try:
                        d = datetime.strptime(v, "%Y-%m-%d")
                    except ValueError:
                        continue
                    iso_year, iso_week, _ = d.isocalendar()
                    buckets[f"{iso_year}-W{iso_week:02d}"] += 1
            entry["weeks"] = [
                {"week": k, "count": v}
                for k, v in sorted(buckets.items())
            ]
        elif kind == "checkbox":
            true_count = sum(1 for v in values if v is True)
            entry["true_count"] = true_count
            entry["false_count"] = len(values) - true_count
        elif kind == "email":
            entry["unique_count"] = len({v for v in values if isinstance(v, str)})
        out.append(entry)
    return out


@router.get(
    "/{slug}/{block_id}/aggregate",
    summary="폼 응답 집계 (editor+)",
)
async def aggregate(
    slug: str,
    block_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    _ = user
    doc_id, form = await _resolve_doc_and_form(s, slug, block_id)
    rows = (await s.execute(
        text("""
            SELECT answers FROM form_responses
            WHERE document_id = CAST(:d AS uuid) AND block_id = :b
        """),
        {"d": doc_id, "b": block_id},
    )).all()
    parsed: list[dict[str, Any]] = []
    for r in rows:
        ans = r[0]
        if isinstance(ans, str):
            try:
                ans = json.loads(ans)
            except json.JSONDecodeError:
                ans = {}
        parsed.append({"answers": ans if isinstance(ans, dict) else {}})

    summary = _aggregate(form, parsed)
    return envelope(
        data={"questions": summary},
        meta={"total_responses": len(parsed)},
    )
