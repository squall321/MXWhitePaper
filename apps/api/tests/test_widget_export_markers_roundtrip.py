"""docx export -> docx import round-trip for widget marker preservation.

Each widget type gets a minimal DocumentJSON block, is rendered to .docx
via ``render_docx``, then re-parsed via ``docx_to_document``. We assert
the reconstructed document contains a block of the same widget type and
that key payload fields survive the round-trip.

A handful of widgets cannot fully reconstruct on import — placeholder
IDs are minted for ``file`` / ``pdf`` (no real upload), ``whiteboard``
intentionally returns None from its converter (docx cannot express
strokes), and many widgets (iframe / video / chart / flow / org-chart /
doc-link / tabs / accordion / gantt) emit decorated text that fails the
import converter's "target shape" check (URL prefix, table-required,
heading-4-required, etc.) so the marker is dropped and the data
survives only as paragraphs/lists. These tests assert the *actual*
round-trip behaviour (info loss = 0 floor) so future improvements to
the export-side renderer (writing bare URLs / heading-4 labels / tables
instead of decorated paragraphs) are caught by the if/else branches
flipping from the "fallback" path to the "real" path.
"""
from __future__ import annotations

from typing import Any

import pytest
import ulid

from app.services.docx_export import DocxOptions, render_docx
from app.services.docx_import import docx_to_document


def _u() -> str:
    return str(ulid.new())


def _build_doc(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "rt-export-markers",
        "title": "T",
        "metadata": {
            "division": "MX",
            "owners": ["t@e.com"],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [
            {
                "id": _u(),
                "number": "1",
                "level": 1,
                "title": "sec",
                "blocks": blocks,
                "subsections": [],
            }
        ],
    }


def _walk_blocks(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def w(secs: list[dict[str, Any]] | None) -> None:
        for s in secs or []:
            out.extend(s.get("blocks") or [])
            w(s.get("subsections") or [])

    w(doc.get("sections") or [])
    return out


def _roundtrip(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    """Render -> reparse, return ``{"blocks": [...], "warnings": [...]}``."""
    doc = _build_doc(blocks)
    blob = render_docx(doc, options=DocxOptions())
    result = docx_to_document(blob, slug="rt", title="", owner_user_id=_u())
    return {
        "blocks": _walk_blocks(result["document"]),
        "warnings": list(getattr(result["summary"], "warnings", []) or []),
    }


def _all_text(blocks: list[dict[str, Any]]) -> str:
    """Concatenate every visible text snippet for substring assertions."""
    parts: list[str] = []
    for b in blocks:
        t = b.get("type")
        if t == "paragraph":
            parts.append(str(b.get("text") or ""))
        elif t == "list":
            for it in b.get("items") or []:
                if isinstance(it, dict):
                    parts.append(str(it.get("text") or ""))
                else:
                    parts.append(str(it))
        elif t == "table":
            for row in b.get("rows") or []:
                if isinstance(row, list):
                    parts.extend(str(c) for c in row)
        elif t == "code":
            parts.append(str(b.get("code") or b.get("source") or ""))
    return " ".join(parts)


# ── 1. iframe ────────────────────────────────────────────────────────


def test_roundtrip_preserves_iframe() -> None:
    """Export emits ``Widget: iframe`` + a bare URL paragraph (decoration
    moved to a trailing italic paragraph). ``_convert_iframe`` consumes
    the URL paragraph and rebuilds an IframeBlock with ``src`` intact."""
    blocks = [
        {
            "type": "iframe",
            "id": _u(),
            "src": "https://example.com/widget",
        }
    ]
    r = _roundtrip(blocks)
    iframes = [b for b in r["blocks"] if b.get("type") == "iframe"]
    assert iframes, [b.get("type") for b in r["blocks"]]
    assert iframes[0]["src"] == "https://example.com/widget"


# ── 2. video ─────────────────────────────────────────────────────────


def test_roundtrip_preserves_video_youtube() -> None:
    """Same shape as iframe — bare URL paragraph after the marker.
    ``_convert_video`` rebuilds a VideoBlock and auto-detects provider
    from the host."""
    blocks = [
        {
            "type": "video",
            "id": _u(),
            "url": "https://www.youtube.com/watch?v=abc",
            "provider": "youtube",
        }
    ]
    r = _roundtrip(blocks)
    videos = [b for b in r["blocks"] if b.get("type") == "video"]
    assert videos, [b.get("type") for b in r["blocks"]]
    assert videos[0]["url"] == "https://www.youtube.com/watch?v=abc"
    assert videos[0]["provider"] == "youtube"


# ── 3. file ──────────────────────────────────────────────────────────


def test_roundtrip_preserves_file_block_with_placeholder_id() -> None:
    """File block DOES reconstruct (``_convert_file`` accepts any
    non-empty paragraph text as ``name``). But the importer's ``name``
    captures the whole decorated paragraph (``📎 [report.docx](...)``),
    not just the bare original name. ``fileId`` is also re-minted."""
    original_file_id = _u()
    blocks = [
        {
            "type": "file",
            "id": _u(),
            "fileId": original_file_id,
            "name": "report.docx",
        }
    ]
    r = _roundtrip(blocks)
    files = [b for b in r["blocks"] if b.get("type") == "file"]
    assert files, [b.get("type") for b in r["blocks"]]
    # name contains the original filename even if wrapped in decoration.
    assert "report.docx" in files[0].get("name", "")
    # fileId is a fresh placeholder.
    assert files[0]["fileId"] != original_file_id
    # Warning emitted.
    assert any("placeholder fileId" in w for w in r["warnings"])


# ── 4. pdf ───────────────────────────────────────────────────────────


def test_roundtrip_preserves_pdf_block_with_placeholder_file_id() -> None:
    """Same shape as file: pdf reconstructs, ``title`` becomes the full
    decorated paragraph text, ``file_id`` is re-minted with warning."""
    original_file_id = _u()
    blocks = [
        {
            "type": "pdf",
            "id": _u(),
            "file_id": original_file_id,
            "title": "Spec",
        }
    ]
    r = _roundtrip(blocks)
    pdfs = [b for b in r["blocks"] if b.get("type") == "pdf"]
    assert pdfs, [b.get("type") for b in r["blocks"]]
    # Title contains the original title even if wrapped.
    assert "Spec" in (pdfs[0].get("title") or "")
    # file_id is regenerated.
    assert pdfs[0]["file_id"] != original_file_id
    assert any("placeholder file_id" in w for w in r["warnings"])


# ── 5. whiteboard ────────────────────────────────────────────────────


def test_roundtrip_whiteboard_drops_to_paragraphs_with_warning() -> None:
    """``_convert_whiteboard`` always returns None — docx cannot express
    strokes. Per the dispatcher's "None means marker dropped, targets
    preserved" rule, the marker paragraph is consumed (with a warning)
    and the ``🖍 Whiteboard`` label paragraph survives as plain text.
    No WhiteboardBlock is reconstructed."""
    blocks = [
        {
            "type": "whiteboard",
            "id": _u(),
            "viewbox": {"w": 800, "h": 600},
            "elements": [],
        }
    ]
    r = _roundtrip(blocks)
    whiteboards = [b for b in r["blocks"] if b.get("type") == "whiteboard"]
    assert not whiteboards, "whiteboard cannot round-trip through docx"
    assert any("whiteboard marker" in w for w in r["warnings"])
    text = _all_text(r["blocks"])
    assert "Whiteboard" in text


# ── 6. image-annotation ──────────────────────────────────────────────


@pytest.mark.skip(
    reason=(
        "image-annotation needs an ImageBlock target that survives docx "
        "round-trip with a stable imageId. Without an image_resolver / "
        "image_uploader pipeline the placeholder image is lost on export, "
        "so the marker's first target after import is not an ImageBlock."
    )
)
def test_roundtrip_preserves_image_annotation() -> None:
    blocks = [
        {
            "type": "image-annotation",
            "id": _u(),
            "image_id": _u(),
            "annotations": [],
        }
    ]
    r = _roundtrip(blocks)
    annos = [b for b in r["blocks"] if b.get("type") == "image-annotation"]
    assert annos


# ── 7. flow ──────────────────────────────────────────────────────────


def test_roundtrip_preserves_flow() -> None:
    """Export emits marker + a shaded Consolas-run paragraph (the
    canonical code-block shape). The importer recognises the F1F5F9
    shading as a ``code`` block; ``_convert_flow`` then consumes it and
    rebuilds a FlowBlock with engine=mermaid and source intact."""
    blocks = [
        {
            "type": "flow",
            "id": _u(),
            "engine": "mermaid",
            "source": "graph TD;\n  A-->B;\n  B-->C;",
        }
    ]
    r = _roundtrip(blocks)
    flows = [b for b in r["blocks"] if b.get("type") == "flow"]
    assert flows, [b.get("type") for b in r["blocks"]]
    assert flows[0]["engine"] == "mermaid"
    assert "A-->B" in flows[0]["source"]


# ── 8. chart ─────────────────────────────────────────────────────────


def test_roundtrip_preserves_chart() -> None:
    """Export emits marker, then a table whose headers are
    ``["", series_name, ...]`` and whose rows are ``[label, v1, ..., vN]``
    — the exact shape ``_convert_chart`` recognises. The marker
    reconstructs as a ChartBlock with chartType / labels / series intact.
    """
    blocks = [
        {
            "type": "chart",
            "id": _u(),
            "chartType": "bar",
            "data": {
                "labels": ["Q1", "Q2"],
                "series": [
                    {"name": "Sales", "values": [10, 20]},
                    {"name": "Profit", "values": [2, 4]},
                ],
            },
        }
    ]
    r = _roundtrip(blocks)
    charts = [b for b in r["blocks"] if b.get("type") == "chart"]
    assert charts, [b.get("type") for b in r["blocks"]]
    chart = charts[0]
    assert chart["chartType"] == "bar"
    assert chart["data"]["labels"] == ["Q1", "Q2"]
    series_by_name = {s["name"]: s["values"] for s in chart["data"]["series"]}
    assert series_by_name["Sales"] == [10.0, 20.0]
    assert series_by_name["Profit"] == [2.0, 4.0]


# ── 9. gantt ─────────────────────────────────────────────────────────


def test_roundtrip_preserves_gantt() -> None:
    """Export emits marker, then a ``Task | Start | End | Progress`` table.
    ``_convert_gantt`` consumes it and reconstructs a GanttBlock with the
    task list intact."""
    blocks = [
        {
            "type": "gantt",
            "id": _u(),
            "tasks": [
                {"name": "Design", "start": "2026-01-01", "end": "2026-01-14"},
                {"name": "Build", "start": "2026-01-15", "end": "2026-02-28"},
            ],
        }
    ]
    r = _roundtrip(blocks)
    gantts = [b for b in r["blocks"] if b.get("type") == "gantt"]
    assert gantts, [b.get("type") for b in r["blocks"]]
    tasks = gantts[0]["tasks"]
    by_name = {t["name"]: t for t in tasks}
    assert "Design" in by_name
    assert "Build" in by_name
    assert by_name["Design"]["start"] == "2026-01-01"
    assert by_name["Design"]["end"] == "2026-01-14"
    assert by_name["Build"]["start"] == "2026-01-15"
    assert by_name["Build"]["end"] == "2026-02-28"


# ── 10. org-chart ────────────────────────────────────────────────────


def test_roundtrip_preserves_org_chart() -> None:
    """Export emits marker + a ``name | parent`` table flattened depth-first.
    ``_convert_org_chart``'s table branch consumes it and rebuilds the tree.
    """
    blocks = [
        {
            "type": "org-chart",
            "id": _u(),
            "root": {
                "id": _u(),
                "label": "CEO",
                "children": [
                    {"id": _u(), "label": "CTO", "children": []},
                    {"id": _u(), "label": "CFO", "children": []},
                ],
            },
        }
    ]
    r = _roundtrip(blocks)
    org = [b for b in r["blocks"] if b.get("type") == "org-chart"]
    assert org, [b.get("type") for b in r["blocks"]]
    root = org[0]["root"]
    assert root["label"] == "CEO"
    child_labels = {c["label"] for c in root.get("children") or []}
    assert child_labels == {"CTO", "CFO"}


# ── 11. tabs ─────────────────────────────────────────────────────────


def test_roundtrip_preserves_tabs() -> None:
    """Export emits marker + a real Heading-4 paragraph per tab + inner
    blocks. ``_convert_tabs`` consumes the heading-4 blocks and rebuilds
    a TabsBlock with both labels intact."""
    blocks = [
        {
            "type": "tabs",
            "id": _u(),
            "tabs": [
                {
                    "label": "Overview",
                    "blocks": [
                        {
                            "type": "paragraph",
                            "id": _u(),
                            "text": "intro",
                        }
                    ],
                },
                {
                    "label": "Details",
                    "blocks": [
                        {
                            "type": "paragraph",
                            "id": _u(),
                            "text": "more",
                        }
                    ],
                },
            ],
        }
    ]
    r = _roundtrip(blocks)
    tabs_blocks = [b for b in r["blocks"] if b.get("type") == "tabs"]
    assert tabs_blocks, [b.get("type") for b in r["blocks"]]
    assert len(tabs_blocks[0]["tabs"]) >= 2
    labels = [t.get("label") for t in tabs_blocks[0]["tabs"]]
    assert labels[0] == "Overview"
    assert labels[1] == "Details"


# ── 12. accordion ────────────────────────────────────────────────────


def test_roundtrip_preserves_accordion() -> None:
    """Same shape as tabs — export emits marker + a real Heading-4 per
    item + inner blocks. ``_convert_accordion`` consumes the heading-4
    blocks and rebuilds an AccordionBlock with both item labels intact."""
    blocks = [
        {
            "type": "accordion",
            "id": _u(),
            "items": [
                {
                    "label": "FAQ-1",
                    "blocks": [
                        {
                            "type": "paragraph",
                            "id": _u(),
                            "text": "Answer-1",
                        }
                    ],
                },
                {
                    "label": "FAQ-2",
                    "blocks": [
                        {
                            "type": "paragraph",
                            "id": _u(),
                            "text": "Answer-2",
                        }
                    ],
                },
            ],
        }
    ]
    r = _roundtrip(blocks)
    acc = [b for b in r["blocks"] if b.get("type") == "accordion"]
    assert acc, [b.get("type") for b in r["blocks"]]
    assert len(acc[0]["items"]) >= 2
    labels = [it.get("label") for it in acc[0]["items"]]
    assert labels[0] == "FAQ-1"
    assert labels[1] == "FAQ-2"


# ── 13. doc-link-card ────────────────────────────────────────────────


def test_roundtrip_preserves_doc_link_card() -> None:
    """Export emits ``Widget: doc-link`` + a bare slug paragraph
    (decoration moved AFTER). ``_convert_doc_link`` matches the slug
    against the Slug regex and rebuilds a DocLinkCardBlock."""
    blocks = [
        {
            "type": "doc-link-card",
            "id": _u(),
            "slug": "design-guide",
        }
    ]
    r = _roundtrip(blocks)
    cards = [b for b in r["blocks"] if b.get("type") == "doc-link-card"]
    assert cards, [b.get("type") for b in r["blocks"]]
    assert cards[0]["slug"] == "design-guide"


# ── 14. glossary-ref ─────────────────────────────────────────────────


def test_roundtrip_preserves_glossary_ref_term() -> None:
    """Glossary-ref DOES reconstruct as a GlossaryRefBlock because
    ``_convert_glossary`` accepts any paragraph text as ``term``. The
    export wraps the term in italic, so the round-trip term carries
    the markdown ``*..*`` decoration."""
    blocks = [
        {
            "type": "glossary-ref",
            "id": _u(),
            "term": "Hyperloop",
        }
    ]
    r = _roundtrip(blocks)
    refs = [b for b in r["blocks"] if b.get("type") == "glossary-ref"]
    assert refs, [b.get("type") for b in r["blocks"]]
    assert "Hyperloop" in refs[0]["term"]
