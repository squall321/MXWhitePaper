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


def test_stale_child_level_is_auto_corrected() -> None:
    """level=1 의 자식이 level=3 이면 tree position 기반으로 level=2 로 보정.

    Policy 변경: 예전엔 422 였지만 import 된 기존 문서 / 다른 곳에서 paste 한
    콘텐츠에 stale level 이 남아 무관한 edit 도 차단당하는 문제가 컸음
    (cd3750f). 이제 number 와 동일하게 tree 위치가 SSOT.
    """
    content = {
        "sections": [
            _section(1, "부모", [
                _section(3, "stale level"),  # tree 상 level 2 자리
            ]),
        ]
    }
    renumber_sections(content)
    assert content["sections"][0]["level"] == 1
    assert content["sections"][0]["subsections"][0]["level"] == 2
    assert content["sections"][0]["subsections"][0]["number"] == "1.1"


def test_top_level_stale_value_is_auto_corrected_to_1() -> None:
    """최상위 section 의 level 값이 무엇이든 1 로 정정."""
    content = {
        "sections": [
            _section(2, "stale 최상위"),
        ]
    }
    renumber_sections(content)
    assert content["sections"][0]["level"] == 1
    assert content["sections"][0]["number"] == "1"


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


def test_deep_tree_is_renumbered_and_levels_corrected() -> None:
    """깊은 트리도 tree 위치 기반으로 number/level 자동 부여 — 422 없음."""
    content = {
        "sections": [
            _section(1, "a", [
                _section(2, "b", [
                    _section(3, "c", [_section(3, "z")]),  # stale: tree 상 level 4
                ]),
            ]),
        ]
    }
    renumber_sections(content)
    a = content["sections"][0]
    b = a["subsections"][0]
    c = b["subsections"][0]
    z = c["subsections"][0]
    assert (a["level"], a["number"]) == (1, "1")
    assert (b["level"], b["number"]) == (2, "1.1")
    assert (c["level"], c["number"]) == (3, "1.1.1")
    assert (z["level"], z["number"]) == (4, "1.1.1.1")


def test_depth_cap_still_enforced() -> None:
    """MAX_DEPTH 보호장치 — 무한 재귀/악성 입력은 여전히 422."""
    # Build a chain 17 levels deep (> MAX_DEPTH = 16).
    leaf = _section(1, "deep")
    for _ in range(16):
        leaf = _section(1, "wrap", [leaf])
    content = {"sections": [leaf]}
    with pytest.raises(ValidationFailed) as ei:
        renumber_sections(content)
    assert ei.value.http_status == 422
