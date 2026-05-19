"""B2 — schema + imageId tests for widget-integrity-pass-1.

Covers:
  1. SpreadsheetBlock with options.stripe validates.
  2. SpreadsheetBlock without options still validates (backwards compat).
  3. ImageBlock and ImageAnnotationBlock validate with `imageId` (camel-case).
  4. Legacy `image_id` (snake-case) on image-annotation gets normalised to
     `imageId` by `_normalise_image_annotation_ids` so old rows still load.
"""
from __future__ import annotations

import ulid

from app.services.document_service import (
    _normalise_image_annotation_ids,
    _normalise_image_annotation_labels,
    validate_documentjson,
)


def _u() -> str:
    return str(ulid.new())


_OWNER = _u()


def _envelope(blocks: list[dict]) -> dict:
    """Minimal DocumentJSON v1.0 envelope around a single section's blocks."""
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "widget-integrity-pass-1-fixture",
        "title": "B2 fixture",
        "metadata": {
            "division": "MX",
            "owners": [_OWNER],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [
            {
                "id": _u(),
                "level": 1,
                "title": "S",
                "blocks": blocks,
                "subsections": [],
            }
        ],
    }


def test_spreadsheet_with_options_stripe_validates() -> None:
    """SpreadsheetBlock accepts options.stripe (zebra toggle)."""
    blocks = [
        {
            "type": "spreadsheet",
            "id": _u(),
            "cols": 3,
            "rows": 2,
            "cells": {"A1": "x"},
            "options": {"stripe": False},
        }
    ]
    cleaned = validate_documentjson(_envelope(blocks))
    spreadsheet = cleaned["sections"][0]["blocks"][0]
    assert spreadsheet["options"] == {"stripe": False}


def test_spreadsheet_without_options_still_validates() -> None:
    """Legacy spreadsheets without an options object remain valid."""
    blocks = [
        {
            "type": "spreadsheet",
            "id": _u(),
            "cols": 2,
            "rows": 2,
            "cells": {"A1": "1", "B1": "2"},
        }
    ]
    cleaned = validate_documentjson(_envelope(blocks))
    spreadsheet = cleaned["sections"][0]["blocks"][0]
    # Either omitted entirely or normalised to None — both are fine; the
    # contract is "no error".
    assert "options" not in spreadsheet or spreadsheet.get("options") in (None, {})


def test_image_blocks_validate_with_image_id_camelcase() -> None:
    """ImageBlock and ImageAnnotationBlock require `imageId` (camel-case)."""
    image_ulid = _u()
    blocks = [
        {
            "type": "image",
            "id": _u(),
            "imageId": image_ulid,
            "caption": "plain image",
        },
        {
            "type": "image-annotation",
            "id": _u(),
            "imageId": image_ulid,
            "annotations": [],
        },
    ]
    cleaned = validate_documentjson(_envelope(blocks))
    img = cleaned["sections"][0]["blocks"][0]
    ann = cleaned["sections"][0]["blocks"][1]
    assert img["imageId"] == image_ulid
    assert ann["imageId"] == image_ulid
    # Snake-case key must not leak through after normalisation.
    assert "image_id" not in ann


def test_legacy_image_id_normalises_to_imageid() -> None:
    """`_normalise_image_annotation_ids` rewrites legacy snake-case key.

    Old rows persisted before the camel-case migration still carry
    `image_id` on image-annotation blocks; the normaliser rewrites them in
    place so pydantic validation (which has `extra='forbid'`) accepts them.
    """
    image_ulid = _u()
    payload = _envelope(
        [
            {
                "type": "image-annotation",
                "id": _u(),
                "image_id": image_ulid,  # legacy snake-case
                "annotations": [],
            }
        ]
    )

    # Direct helper test — should mutate in place.
    _normalise_image_annotation_ids(payload)
    ann = payload["sections"][0]["blocks"][0]
    assert ann["imageId"] == image_ulid
    assert "image_id" not in ann

    # End-to-end through validate_documentjson — same fixture, fresh payload,
    # should validate without raising.
    payload2 = _envelope(
        [
            {
                "type": "image-annotation",
                "id": _u(),
                "image_id": image_ulid,
                "annotations": [],
            }
        ]
    )
    cleaned = validate_documentjson(payload2)
    ann2 = cleaned["sections"][0]["blocks"][0]
    assert ann2["imageId"] == image_ulid


# ── pass-2 M5: callout annotation `text` → `label` normalisation ────


def test_legacy_callout_text_normalises_to_label() -> None:
    """pass-2 M5 — callout-kind annotations carried their string under
    ``text`` before the arrow / rect / callout label unification. The
    `_normalise_image_annotation_labels` helper rewrites legacy `text` →
    `label` in place so pydantic's `extra='forbid'` accepts old rows.
    """
    image_ulid = _u()
    payload = _envelope(
        [
            {
                "type": "image-annotation",
                "id": _u(),
                "imageId": image_ulid,
                "annotations": [
                    {
                        "kind": "callout",
                        "id": "a1",
                        "x": 0.5,
                        "y": 0.5,
                        "color": "#ff0000",
                        "text": "주의 — 발열 부위",  # legacy key
                    }
                ],
            }
        ]
    )

    # Direct helper — should rewrite text → label in place.
    _normalise_image_annotation_labels(payload)
    ann = payload["sections"][0]["blocks"][0]["annotations"][0]
    assert ann["label"] == "주의 — 발열 부위"
    assert "text" not in ann

    # End-to-end through validate_documentjson — fresh fixture, should
    # validate without raising.
    payload2 = _envelope(
        [
            {
                "type": "image-annotation",
                "id": _u(),
                "imageId": image_ulid,
                "annotations": [
                    {
                        "kind": "callout",
                        "id": "a1",
                        "x": 0.5,
                        "y": 0.5,
                        "color": "#ff0000",
                        "text": "legacy text",
                    }
                ],
            }
        ]
    )
    cleaned = validate_documentjson(payload2)
    cleaned_ann = (
        cleaned["sections"][0]["blocks"][0]["annotations"][0]
    )
    assert cleaned_ann["label"] == "legacy text"


def test_arrow_rect_annotations_unchanged_by_label_normaliser() -> None:
    """The label normaliser only touches `kind == "callout"` — arrow and
    rect already canonicalised on `label` so they must pass through.
    """
    image_ulid = _u()
    payload = _envelope(
        [
            {
                "type": "image-annotation",
                "id": _u(),
                "imageId": image_ulid,
                "annotations": [
                    {
                        "kind": "arrow",
                        "id": "a1",
                        "from": {"x": 0.1, "y": 0.1},
                        "to":   {"x": 0.9, "y": 0.9},
                        "color": "#000000",
                        "label": "arrow label",
                    },
                    {
                        "kind": "rect",
                        "id": "a2",
                        "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3,
                        "color": "#0000ff",
                        "label": "rect label",
                    },
                ],
            }
        ]
    )
    _normalise_image_annotation_labels(payload)
    anns = payload["sections"][0]["blocks"][0]["annotations"]
    assert anns[0]["label"] == "arrow label"
    assert anns[1]["label"] == "rect label"
