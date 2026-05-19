"""B2 — schema tests for widget-integrity-pass-2.

Covers:
  - M2 iframe XOR: src+html both / neither / src only / html only.
  - M4 video: autoplay/controls/loop fields accepted; legacy docs without
    them still validate (backwards compat).
  - M5 annotation: callout requires `label` (was `text` in pass-1 schema);
    BE-side legacy `text`→`label` normaliser is B1's responsibility, this
    file only asserts the schema contract.
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
    """Minimal DocumentJSON v1.0 envelope around one section's blocks."""
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "widget-integrity-pass-2-fixture",
        "title": "B2 pass-2 fixture",
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


# ── M2 iframe XOR ──────────────────────────────────────────────────────


def test_iframe_with_both_src_and_html_rejected() -> None:
    """`src` and `html` are mutually exclusive — must not coexist."""
    blocks = [
        {
            "type": "iframe",
            "id": _u(),
            "src": "https://example.com/widget",
            "html": "<p>inline</p>",
        }
    ]
    with pytest.raises(ValidationFailed):
        validate_documentjson(_envelope(blocks))


def test_iframe_with_neither_src_nor_html_rejected() -> None:
    """At least one of `src` / `html` is required."""
    blocks = [{"type": "iframe", "id": _u(), "title": "empty"}]
    with pytest.raises(ValidationFailed):
        validate_documentjson(_envelope(blocks))


def test_iframe_with_src_only_validates() -> None:
    blocks = [
        {
            "type": "iframe",
            "id": _u(),
            "src": "https://example.com/widget",
            "title": "src-only",
        }
    ]
    cleaned = validate_documentjson(_envelope(blocks))
    iframe = cleaned["sections"][0]["blocks"][0]
    assert iframe["src"] == "https://example.com/widget"
    assert iframe.get("html") is None


def test_iframe_with_html_only_validates() -> None:
    blocks = [
        {
            "type": "iframe",
            "id": _u(),
            "html": "<p>self-contained</p>",
            "title": "html-only",
        }
    ]
    cleaned = validate_documentjson(_envelope(blocks))
    iframe = cleaned["sections"][0]["blocks"][0]
    assert iframe["html"] == "<p>self-contained</p>"
    assert iframe.get("src") is None


# ── M4 video options ───────────────────────────────────────────────────


def test_video_with_autoplay_controls_loop_validates() -> None:
    """video block accepts the new playback options."""
    blocks = [
        {
            "type": "video",
            "id": _u(),
            "url": "https://example.com/intro.mp4",
            "title": "intro",
            "autoplay": True,
            "controls": False,
            "loop": True,
        }
    ]
    cleaned = validate_documentjson(_envelope(blocks))
    video = cleaned["sections"][0]["blocks"][0]
    assert video["autoplay"] is True
    assert video["controls"] is False
    assert video["loop"] is True


def test_video_without_playback_options_still_validates() -> None:
    """Legacy video blocks (no playback options) keep validating."""
    blocks = [
        {
            "type": "video",
            "id": _u(),
            "url": "https://example.com/legacy.mp4",
        }
    ]
    cleaned = validate_documentjson(_envelope(blocks))
    video = cleaned["sections"][0]["blocks"][0]
    # Defaults applied (or fields omitted) — either is fine; the contract is
    # "no error" and, when present, defaults match the schema.
    assert video.get("autoplay", False) is False
    assert video.get("controls", True) is True
    assert video.get("loop", False) is False


# ── M5 annotation label unification ────────────────────────────────────


def test_image_annotation_callout_uses_label_field() -> None:
    """callout annotation requires `label` (renamed from `text` in pass-2)."""
    image_ulid = _u()
    blocks = [
        {
            "type": "image-annotation",
            "id": _u(),
            "imageId": image_ulid,
            "annotations": [
                {
                    "kind": "callout",
                    "id": "a1",
                    "x": 10.0,
                    "y": 20.0,
                    "label": "Look here",
                    "color": "#ff0000",
                },
                {
                    "kind": "arrow",
                    "id": "a2",
                    "from": {"x": 0.0, "y": 0.0},
                    "to": {"x": 1.0, "y": 1.0},
                    "color": "#000",
                    "label": "arrow-with-label",
                },
                {
                    "kind": "rect",
                    "id": "a3",
                    "x": 0.0,
                    "y": 0.0,
                    "w": 10.0,
                    "h": 10.0,
                    "color": "#0f0",
                    "label": "rect-with-label",
                },
            ],
        }
    ]
    cleaned = validate_documentjson(_envelope(blocks))
    ann_block = cleaned["sections"][0]["blocks"][0]
    kinds = {a["kind"]: a for a in ann_block["annotations"]}
    assert kinds["callout"]["label"] == "Look here"
    # Pre-pass-2 callout `text` key must not appear post-validation.
    assert "text" not in kinds["callout"]
    assert kinds["arrow"]["label"] == "arrow-with-label"
    assert kinds["rect"]["label"] == "rect-with-label"
