"""Tests for FormQuestion validation extensions (WIDGET-03 Phase 1).

Covers min/max/minLength/maxLength/pattern enforcement in _validate_answer +
pattern compile-failure graceful skip. These are pure-helper tests — no DB.
"""
from __future__ import annotations

import pytest

from app.routers.forms import (
    FormValidationError,
    _compile_question_pattern,
    validate_answers,
)


def _form(*qs: dict) -> dict:
    return {"type": "form", "id": "01TESTFORMVALIDATION0000FX", "questions": list(qs)}


# ── Numeric min/max ──────────────────────────────────────────────────────


def test_number_below_min_rejected() -> None:
    f = _form({"id": "n", "kind": "number", "label": "나이", "min": 18, "max": 99})
    with pytest.raises(FormValidationError, match="최소"):
        validate_answers(f, {"n": 10})


def test_number_above_max_rejected() -> None:
    f = _form({"id": "n", "kind": "number", "label": "나이", "min": 18, "max": 99})
    with pytest.raises(FormValidationError, match="최대"):
        validate_answers(f, {"n": 200})


def test_number_within_range_passes() -> None:
    f = _form({"id": "n", "kind": "number", "label": "나이", "min": 18, "max": 99})
    out = validate_answers(f, {"n": 30})
    assert out["n"] == 30


# ── Text minLength/maxLength ─────────────────────────────────────────────


def test_text_below_minlength_rejected() -> None:
    f = _form({"id": "t", "kind": "text", "label": "이름", "minLength": 3})
    with pytest.raises(FormValidationError, match="너무 적습니다"):
        validate_answers(f, {"t": "Hi"})


def test_text_above_maxlength_rejected() -> None:
    f = _form({"id": "t", "kind": "text", "label": "이름", "maxLength": 5})
    with pytest.raises(FormValidationError, match="너무 많습니다"):
        validate_answers(f, {"t": "TooLongValue"})


def test_text_within_length_passes() -> None:
    f = _form({"id": "t", "kind": "text", "label": "이름",
               "minLength": 2, "maxLength": 10})
    out = validate_answers(f, {"t": "Alice"})
    assert out["t"] == "Alice"


# ── Pattern ──────────────────────────────────────────────────────────────


def test_text_pattern_match_passes() -> None:
    f = _form({"id": "p", "kind": "text", "label": "전화",
               "pattern": r"^010-\d{4}-\d{4}$"})
    out = validate_answers(f, {"p": "010-1234-5678"})
    assert out["p"] == "010-1234-5678"


def test_text_pattern_no_match_rejected() -> None:
    f = _form({"id": "p", "kind": "text", "label": "전화",
               "pattern": r"^010-\d{4}-\d{4}$"})
    with pytest.raises(FormValidationError, match="형식"):
        validate_answers(f, {"p": "abc"})


def test_text_pattern_compile_failure_silently_skipped() -> None:
    # Unclosed group — re.compile raises. Author error must not block submission.
    bad = "[unclosed"
    assert _compile_question_pattern(bad) is None
    f = _form({"id": "p", "kind": "text", "label": "이름", "pattern": bad})
    out = validate_answers(f, {"p": "Anything"})
    assert out["p"] == "Anything"


def test_pattern_oversize_skipped() -> None:
    # Length cap (200) — even a valid regex over the cap is skipped.
    long_pattern = "a" * 201
    assert _compile_question_pattern(long_pattern) is None


# ── Email also honours pattern/minLength via shared helper ───────────────


def test_email_minlength_applied() -> None:
    f = _form({"id": "e", "kind": "email", "label": "이메일", "minLength": 20})
    with pytest.raises(FormValidationError, match="너무 적습니다"):
        validate_answers(f, {"e": "a@b.co"})
