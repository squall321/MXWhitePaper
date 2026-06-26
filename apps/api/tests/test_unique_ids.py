"""중복 id 거부 — validate_documentjson 의 전역 unique-id 가드 회귀 테스트.

적대적 검증에서 발견된 HIGH 데이터 무결성 결함의 회귀 가드:
중복 id 블록은 get/update/delete_block 이 first-match 만 처리해 둘째 노드를
도달 불가능한 orphan 으로 만든다. write 경로의 validate_documentjson 이
이를 거부해야 한다.
"""
from __future__ import annotations

import ulid
import pytest

from app.core.errors import ValidationFailed
from app.services.document_service import validate_documentjson


def _u() -> str:
    return str(ulid.new())


_OWNER = _u()


def _envelope(blocks: list[dict]) -> dict:
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "unique-ids-fixture",
        "title": "unique-id fixture",
        "metadata": {
            "division": "MX",
            "owners": [_OWNER],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [
            {"id": _u(), "level": 1, "title": "S", "blocks": blocks, "subsections": []}
        ],
    }


def test_duplicate_block_id_rejected() -> None:
    dup = _u()
    payload = _envelope(
        [
            {"type": "paragraph", "id": dup, "text": "first"},
            {"type": "paragraph", "id": dup, "text": "second"},
        ]
    )
    with pytest.raises(ValidationFailed) as ei:
        validate_documentjson(payload)
    assert dup in str(ei.value)


def test_child_id_equal_to_container_id_rejected() -> None:
    cid = _u()
    payload = _envelope(
        [
            {
                "type": "columns",
                "id": cid,
                "columns": [[{"type": "paragraph", "id": cid, "text": "x"}], []],
            }
        ]
    )
    with pytest.raises(ValidationFailed):
        validate_documentjson(payload)


def test_duplicate_child_id_across_columns_rejected() -> None:
    shared = _u()
    payload = _envelope(
        [
            {
                "type": "columns",
                "id": _u(),
                "columns": [
                    [{"type": "paragraph", "id": shared, "text": "a"}],
                    [{"type": "paragraph", "id": shared, "text": "b"}],
                ],
            }
        ]
    )
    with pytest.raises(ValidationFailed):
        validate_documentjson(payload)


def test_unique_ids_pass() -> None:
    payload = _envelope(
        [
            {"type": "paragraph", "id": _u(), "text": "a"},
            {"type": "paragraph", "id": _u(), "text": "b"},
        ]
    )
    out = validate_documentjson(payload)
    assert len(out["sections"][0]["blocks"]) == 2
