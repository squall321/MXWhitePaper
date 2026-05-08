"""section_numbering 단위 테스트."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.errors import ValidationFailed
from app.services.section_numbering import renumber_sections

# seed sample 위치: container 내부와 host 양쪽 지원
_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"


def _section(level: int, title: str, subsections: list | None = None) -> dict:
    return {
        "id": "01J9X1Y2Z3A4B5C6D7E8F9G0S1",
        "level": level,
        "title": title,
        "blocks": [],
        "subsections": subsections or [],
    }


def test_renumber_assigns_dotted_numbers() -> None:
    content = {
        "sections": [
            _section(1, "첫 섹션", [
                _section(2, "1-1", [
                    _section(3, "1-1-1"),
                ]),
                _section(2, "1-2"),
            ]),
            _section(1, "두번째 섹션"),
        ]
    }
    renumber_sections(content)
    s1 = content["sections"][0]
    assert s1["number"] == "1"
    assert s1["subsections"][0]["number"] == "1.1"
    assert s1["subsections"][0]["subsections"][0]["number"] == "1.1.1"
    assert s1["subsections"][1]["number"] == "1.2"
    assert content["sections"][1]["number"] == "2"


def test_invalid_level_raises_422() -> None:
    """level=1 의 자식이 level=3 이면 422 발생."""
    content = {
        "sections": [
            _section(1, "잘못된", [
                _section(3, "level 점프"),  # level 2 가 와야 함
            ]),
        ]
    }
    with pytest.raises(ValidationFailed) as ei:
        renumber_sections(content)
    assert ei.value.http_status == 422
    assert "level" in ei.value.message.lower()


def test_top_level_must_be_level_1() -> None:
    content = {
        "sections": [
            _section(2, "잘못된 최상위"),
        ]
    }
    with pytest.raises(ValidationFailed) as ei:
        renumber_sections(content)
    assert ei.value.http_status == 422


def test_seed_month_end_closing_renumbers_to_1_1_1_1_1_1() -> None:
    """seed 의 01-month-end-closing.json 을 재번호 → 1, 1.1, 1.1.1 정확히 부여."""
    sample = json.loads(
        (_SAMPLES / "01-month-end-closing.json").read_text(encoding="utf-8")
    )
    renumber_sections(sample)
    s1 = sample["sections"][0]
    assert s1["number"] == "1"
    s11 = s1["subsections"][0]
    assert s11["number"] == "1.1"
    s111 = s11["subsections"][0]
    assert s111["number"] == "1.1.1"


def test_level3_with_subsections_raises_422() -> None:
    content = {
        "sections": [
            _section(1, "a", [
                _section(2, "b", [
                    _section(3, "c", [_section(3, "z")]),  # level 3 의 자식 금지
                ]),
            ]),
        ]
    }
    with pytest.raises(ValidationFailed) as ei:
        renumber_sections(content)
    assert ei.value.http_status == 422
