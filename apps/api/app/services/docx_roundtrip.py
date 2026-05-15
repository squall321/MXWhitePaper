"""Stateless docx → DocumentJSON → docx round-trip.

Glue between `docx_import.docx_to_document` (with `roundtrip_mode=True`)
and `docx_export.render_docx`. The point: take a Word file from the
user, normalise it through our DocumentJSON pipeline (auto-numbering,
TOC strip, caption rules, etc.), and hand back a fresh Word file —
**without** touching the database, MinIO, or Meilisearch.

Why this isn't just two HTTP calls glued together:
    The import-then-export approach would either (a) round-trip every
    image through MinIO (storage churn, requires real upload credentials
    in test/preview flows) or (b) lose every image (the converter
    fallback). Roundtrip mode threads the original image bytes through
    in memory, so the resulting docx contains the same pictures as the
    source — no persistence side-effects.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from app.services import docx_import
from app.services.docx_export import DocxOptions, render_docx


def roundtrip_docx(
    buf: bytes,
    *,
    slug: str = "roundtrip",
    title: str = "",
    owner_user_id: str = "roundtrip",
    strip_toc: bool = True,
    verify_toc: bool = True,
    aggressive_toc: bool = False,
) -> tuple[bytes, dict[str, Any]]:
    """Convert a docx file through DocumentJSON and back.

    Returns ``(output_bytes, summary)``. The summary is a plain dict so
    the router can serialise it directly into either a JSON envelope or
    response headers.

    Raises ``ValueError`` when the input bytes aren't a valid docx zip
    (the caller maps this to 422).
    """
    result = docx_import.docx_to_document(
        buf,
        slug=slug,
        title=title,
        owner_user_id=owner_user_id,
        image_uploader=None,            # no MinIO; bytes stay in summary
        strip_toc=strip_toc,
        verify_toc=verify_toc,
        aggressive_toc=aggressive_toc,
        roundtrip_mode=True,
    )
    document = result["document"]
    summary = result["summary"]

    captured = summary.captured_images
    resolver = _make_image_resolver(captured) if captured else None

    out_bytes = render_docx(
        document,
        options=DocxOptions(image_resolver=resolver),
    )
    return out_bytes, _summary_to_dict(summary, document)


def _make_image_resolver(captured: dict[str, dict[str, Any]]):
    """Wrap the ``image_id → {bytes, mime}`` map into the function
    shape `docx_export` expects."""
    def _resolver(image_id: str) -> dict[str, Any] | None:
        rec = captured.get(image_id)
        if not rec:
            return None
        return {"bytes": rec["bytes"], "mime": rec.get("mime", "image/png")}
    return _resolver


def _summary_to_dict(summary: docx_import.ImportSummary, doc: dict[str, Any]) -> dict[str, Any]:
    """Flatten ImportSummary into a JSON-safe dict. ``captured_images``
    is dropped (it's large binary data not meant for the caller)."""
    raw = asdict(summary)
    raw.pop("captured_images", None)
    raw["sections"] = _count_sections(doc.get("sections") or [])
    raw["images"] = summary.images
    raw["tables"] = summary.tables
    return raw


def _count_sections(sections: list[dict[str, Any]]) -> int:
    """Count every section node in the tree (top-level + subsections)."""
    total = 0
    stack = list(sections)
    while stack:
        sec = stack.pop()
        total += 1
        subs = sec.get("subsections")
        if isinstance(subs, list):
            stack.extend(subs)
    return total
