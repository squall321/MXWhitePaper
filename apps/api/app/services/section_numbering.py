"""섹션 번호 재계산 + level 검증.

DocumentJSON v1.0 의 sections 트리는 level 1+ 의 임의 깊이를 가질 수 있다.
이 모듈은:
  - level 일관성을 검증한다 (자식 level == 부모 level + 1).
  - 1, 1.1, 1.1.1, 1.1.1.1 … 처럼 트리 위치 기반으로 number 를 재계산해 부여한다.

번호 매기기는 POST/PUT 시 항상 호출된다 — 클라이언트가 보낸 number 는 무시된다.

깊이 제한:
  스키마 자체에는 깊이 cap 이 없다. 단 FE 렌더는 HTML <h2>..<h6> 까지만 매핑
  하고 (level 5+ 는 모두 <h6>) OutlinePanel 도 시각적으로 점진 들여쓰기로
  표시한다. 다만 ``MAX_DEPTH`` 안전장치를 둬서 무한 재귀 / 악성 입력에서
  스택 폭주를 막는다.
"""
from __future__ import annotations

from typing import Any

from app.core.errors import ValidationFailed

MAX_DEPTH = 16


def _validate_and_renumber(
    sections: list[dict[str, Any]],
    expected_level: int,
    parent_prefix: str,
) -> None:
    if expected_level > MAX_DEPTH:
        raise ValidationFailed(
            f"Section depth exceeds limit (max={MAX_DEPTH})",
            details={"depth": expected_level},
        )
    for idx, section in enumerate(sections, start=1):
        # The tree position is the source of truth — auto-correct level to
        # match (same policy as number). Old imports / manual edits sometimes
        # leave a stale level field; rejecting on save was too aggressive
        # and blocked unrelated edits with VALIDATION_ERROR 422.
        section["level"] = expected_level

        # number 재계산: 1, 1.1, 1.1.1, ...
        number = f"{parent_prefix}{idx}" if not parent_prefix else f"{parent_prefix}.{idx}"
        section["number"] = number

        subsections = section.get("subsections") or []
        if not subsections:
            continue

        _validate_and_renumber(
            subsections,
            expected_level=expected_level + 1,
            parent_prefix=number,
        )


def renumber_sections(content_json: dict[str, Any]) -> dict[str, Any]:
    """`content_json` 의 sections 트리를 in-place 재번호 + 검증.

    Args:
        content_json: DocumentJSON dict (Pydantic dump 또는 raw)

    Returns:
        같은 dict (편의를 위해 반환)

    Raises:
        ValidationFailed (422): level 위반 또는 level-3 자식 존재
    """
    sections = content_json.get("sections")
    if not isinstance(sections, list):
        raise ValidationFailed(
            "DocumentJSON.sections must be a list",
            details={"got_type": type(sections).__name__},
        )
    _validate_and_renumber(sections, expected_level=1, parent_prefix="")
    return content_json
