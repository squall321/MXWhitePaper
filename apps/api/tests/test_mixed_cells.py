"""Mixed-content table cells — paragraph + image + list inside a TableBlock cell.

Covers the schema-level one-of contract (text OR blocks) plus all four
renderers (markdown / html / docx / pptx) and the docx-import path that
turns ``<w:drawing>`` inside ``<w:tc>`` into a Cell.blocks list.

PowerPoint files cannot store images inside table cells (a python-pptx +
.pptx format limitation), so there is no pptx-import variant.
"""
from __future__ import annotations

import io
from typing import Any

import ulid

from app.services.docx_export import DocxOptions, render_docx
from app.services.docx_import import docx_to_document
from app.services.html_renderer import RenderOptions, render_namuwiki_html
from app.services.markdown_export import render_markdown
from app.services.pptx_export import PptxOptions, render_pptx


def _u() -> str:
    return str(ulid.new())


_OWNER = _u()
_IMG_ID = _u()


def _png_bytes(size: int = 4) -> bytes:
    from PIL import Image as _PILImage

    img = _PILImage.new("RGB", (size, size), (255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


_PNG = _png_bytes()


def _resolver(image_id: str) -> dict[str, Any] | None:
    if image_id == _IMG_ID:
        return {"bytes": _PNG, "mime": "image/png"}
    return None


def _mixed_doc() -> dict[str, Any]:
    """2x2 table: header row plus one mixed cell (image + paragraph + list)
    and a plain text cell. Forces the sparse `cells` shape."""
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": "mix-cells",
        "title": "Mixed cells",
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
                "title": "본문",
                "blocks": [
                    {
                        "type": "table",
                        "id": _u(),
                        "headers": [],
                        "rows": [],
                        "cells": [
                            {"r": 0, "c": 0, "header": True, "text": "제품"},
                            {"r": 0, "c": 1, "header": True, "text": "특징"},
                            {
                                "r": 1,
                                "c": 0,
                                "blocks": [
                                    {
                                        "type": "image",
                                        "id": _u(),
                                        "imageId": _IMG_ID,
                                    },
                                    {
                                        "type": "paragraph",
                                        "id": _u(),
                                        "text": "MX 1",
                                    },
                                    {
                                        "type": "list",
                                        "id": _u(),
                                        "style": "bullet",
                                        "items": ["a", "b"],
                                    },
                                ],
                            },
                            {"r": 1, "c": 1, "text": "텍스트만"},
                        ],
                    }
                ],
                "subsections": [],
            }
        ],
    }


def test_markdown_export_renders_mixed_cells() -> None:
    md = render_markdown(_mixed_doc())
    # Header preserved; mixed cell text + image marker + list items flattened.
    assert "제품" in md and "특징" in md
    assert "MX 1" in md
    # bullet items in same cell flatten as comma-joined.
    assert "a" in md and "b" in md
    # image marker uses the imageId.
    assert _IMG_ID in md


def test_html_export_renders_mixed_cells() -> None:
    html = render_namuwiki_html(_mixed_doc(), options=RenderOptions())
    assert "<th" in html and "제품" in html
    # paragraph block inside cell becomes <p>...</p>.
    assert "<p>MX 1</p>" in html
    # image becomes <img> tag with data-image-id.
    assert _IMG_ID in html and "<img" in html
    # list becomes <ul>...<li>a</li><li>b</li>...
    assert "<ul>" in html and "<li>a</li>" in html


def test_docx_export_embeds_picture_in_cell() -> None:
    blob = render_docx(_mixed_doc(), options=DocxOptions(image_resolver=_resolver))
    # docx 는 zip — word/media/ 안에 picture 가 들어가야 한다.
    import zipfile

    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        media = [n for n in zf.namelist() if n.startswith("word/media/")]
    assert media, "expected at least one media file in the docx"


def test_pptx_export_handles_mixed_cells_textually() -> None:
    """python-pptx 셀은 이미지 미지원 → 이미지는 [image: <label>] 텍스트로 폴백."""
    blob = render_pptx(_mixed_doc(), options=PptxOptions(image_resolver=_resolver))
    import zipfile

    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        assert "ppt/presentation.xml" in zf.namelist()
        # The [image: ...] marker must show up in some slide XML so the
        # textual fallback behavior described in the design stays pinned.
        slide_payloads = [
            zf.read(n).decode("utf-8", "replace")
            for n in zf.namelist()
            if n.startswith("ppt/slides/slide") and n.endswith(".xml")
        ]
        assert any("[image:" in p for p in slide_payloads), (
            "expected pptx textual fallback marker for cell-embedded image"
        )


def test_docx_import_emits_cell_blocks_for_image_in_cell() -> None:
    """docx_export → docx_import 라운드트립: 셀 안 이미지가 blocks 로 회수."""
    blob = render_docx(_mixed_doc(), options=DocxOptions(image_resolver=_resolver))
    result = docx_to_document(
        blob,
        slug="mix-imported",
        title="",
        owner_user_id=_OWNER,
    )
    doc = result["document"]
    # Walk every section recursively to find the table block.
    def _walk(secs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for s in secs or []:
            for b in s.get("blocks") or []:
                out.append(b)
            out.extend(_walk(s.get("subsections") or []))
        return out

    tables = [b for b in _walk(doc.get("sections") or []) if b.get("type") == "table"]
    assert tables, "table block missing after round-trip"
    table = tables[0]
    cells = table.get("cells") or []
    # The image cell should now carry a `blocks` array (not just text).
    mixed = [c for c in cells if isinstance(c.get("blocks"), list) and c["blocks"]]
    assert mixed, f"no mixed-content cell after import; got cells={cells!r}"
    # And the blocks should include at least one image.
    block_types = {b.get("type") for b in mixed[0]["blocks"]}
    assert "image" in block_types, block_types


def test_schema_normalises_text_when_blocks_present() -> None:
    """The service-layer normaliser strips `text` when `blocks` is set,
    keeping the one-of contract observable downstream."""
    from app.services.document_service import validate_documentjson

    raw = _mixed_doc()
    cleaned = validate_documentjson(raw)
    cells = cleaned["sections"][0]["blocks"][0]["cells"]
    mixed = [c for c in cells if c.get("blocks")]
    assert mixed
    # `text` should be absent (or None) on cells that use blocks.
    for c in mixed:
        assert not c.get("text"), c
