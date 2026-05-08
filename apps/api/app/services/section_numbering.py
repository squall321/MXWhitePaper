"""섹션 번호 재계산 + level 검증.

DocumentJSON v1.0 의 sections 트리는 level 1~3 을 갖는다.
이 모듈은:
  - level 일관성을 검증한다 (자식 level == 부모 level + 1).
  - 1, 1.1, 1.1.1 과 같이 트리 위치 기반으로 number 를 재계산해 부여한다.

번호 매기기는 POST/PUT 시 항상 호출된다 — 클라이언트가 보낸 number 는 무시된다.
"""
from __future__ import annotations

from typing import Any

from app.core.errors import ValidationFailed


def _validate_and_renumber(
    sections: list[dict[str, Any]],
    expected_level: int,
    parent_prefix: str,
) -> None:
    for idx, section in enumerate(sections, start=1):
        # level 가 없거나 잘못된 경우 거부
        actual_level = section.get("level")
        if actual_level != expected_level:
            raise ValidationFailed(
                f"Section level mismatch: expected level={expected_level}, "
                f"got level={actual_level} (title={section.get('title')!r})",
                details={
                    "expected_level": expected_level,
                    "got_level": actual_level,
                    "title": section.get("title"),
                },
            )

        # number 재계산: 1, 1.1, 1.1.1
        number = f"{parent_prefix}{idx}" if not parent_prefix else f"{parent_prefix}.{idx}"
        section["number"] = number

        subsections = section.get("subsections") or []
        if expected_level >= 3:
            # level 3 자식은 없어야 함 (스키마상 max_length=0)
            if subsections:
                raise ValidationFailed(
                    "Level-3 sections cannot contain subsections",
                    details={"title": section.get("title"), "level": 3},
                )
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
