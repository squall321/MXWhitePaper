"""Generate the three example .docx files shipped with the toolkit.

These are built from DocumentJSON fixtures rendered through the *real*
docx_export pipeline (same code the server uses), so they mirror exactly
what an LLM should aim to produce.

Run from the toolkit folder:

    python examples/build_examples.py

The script writes to `examples/*.docx`. CI re-builds them on every push so
they stay in sync with the production renderer.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent.parent  # llm-docx-toolkit/examples → repo root
API_SRC = REPO / "apps" / "api" / "app" / "services"

# Make the production docx_export importable from a clean process (no FastAPI
# app context required). We add the api/app folder so `app.services.*` style
# imports work end-to-end.
sys.path.insert(0, str(REPO / "apps" / "api"))


def _u() -> str:
    import ulid
    return str(ulid.new())


def _doc(slug: str, title: str, blocks: list[dict]) -> dict:
    return {
        "schema_version": "1.0",
        "id": _u(),
        "slug": slug,
        "title": title,
        "metadata": {
            "division": "MX",
            "owners": ["llm@example.com"],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [{
            "id": _u(),
            "number": "1",
            "level": 1,
            "title": "본문",
            "blocks": blocks,
            "subsections": [],
        }],
    }


def good_example() -> dict:
    """Every widget shaped exactly the way the import rules describe."""
    return _doc("good-example", "올바른 예시 — 모든 위젯이 인식되는 형태", [
        {"type": "paragraph", "id": _u(), "text": "이 문서는 룰을 따라 작성된 예시다."},
        {"type": "callout", "id": _u(), "variant": "warn", "text": "주의: 백업 후 진행"},
        {
            "type": "kpi-cards", "id": _u(),
            "items": [
                {"label": "매출", "value": "100억", "delta": "+10%", "trend": "up"},
                {"label": "MAU", "value": "5만"},
            ],
        },
        {
            "type": "chart", "id": _u(), "chartType": "bar",
            "data": {
                "labels": ["Q1", "Q2", "Q3", "Q4"],
                "series": [
                    {"name": "Revenue", "values": [100, 150, 200, 250]},
                    {"name": "Profit",  "values": [20,  30,  45,  60]},
                ],
            },
        },
        {
            "type": "gantt", "id": _u(),
            "tasks": [
                {"name": "설계", "start": "2026-01-01", "end": "2026-01-15", "progress": 100},
                {"name": "개발", "start": "2026-01-16", "end": "2026-03-31", "progress": 50},
            ],
        },
        {"type": "flow", "id": _u(), "engine": "mermaid", "source": "graph TD\nA-->B\nB-->C"},
        {
            "type": "org-chart", "id": _u(),
            "root": {
                "id": _u(), "label": "CEO",
                "children": [
                    {"id": _u(), "label": "CTO", "children": [{"id": _u(), "label": "Dev"}]},
                    {"id": _u(), "label": "CFO"},
                ],
            },
        },
        {"type": "iframe", "id": _u(), "src": "https://example.com/widget"},
        {"type": "video", "id": _u(), "url": "https://youtube.com/watch?v=abc", "provider": "youtube"},
        {"type": "file", "id": _u(), "fileId": _u(), "name": "report.pdf"},
        {"type": "pdf", "id": _u(), "file_id": _u(), "title": "Spec v1"},
        {"type": "doc-link-card", "id": _u(), "slug": "month-end-closing"},
        {"type": "glossary-ref", "id": _u(), "term": "ULID"},
        {
            "type": "tabs", "id": _u(),
            "tabs": [
                {"label": "개요", "blocks": [{"type": "paragraph", "id": _u(), "text": "개요 내용"}]},
                {"label": "상세", "blocks": [{"type": "paragraph", "id": _u(), "text": "상세 내용"}]},
            ],
        },
        {
            "type": "accordion", "id": _u(),
            "items": [
                {"label": "Q1", "blocks": [{"type": "paragraph", "id": _u(), "text": "A1"}]},
                {"label": "Q2", "blocks": [{"type": "paragraph", "id": _u(), "text": "A2"}]},
            ],
        },
        {
            "type": "columns", "id": _u(),
            "columns": [
                [{"type": "paragraph", "id": _u(), "text": "왼쪽 단"}],
                [{"type": "paragraph", "id": _u(), "text": "오른쪽 단"}],
            ],
        },
    ])


def all_widgets_example() -> dict:
    """Like good-example but adds gallery + image-annotation + whiteboard
    so all 18 widget types appear."""
    blocks = good_example()["sections"][0]["blocks"]
    blocks.extend([
        {
            "type": "gallery", "id": _u(), "layout": "grid",
            "items": [{"imageId": _u()}, {"imageId": _u()}, {"imageId": _u()}],
        },
        {
            "type": "image-annotation", "id": _u(),
            "image_id": _u(), "annotations": [],
        },
        {
            "type": "whiteboard", "id": _u(),
            "viewbox": {"w": 1000, "h": 600}, "elements": [],
        },
    ])
    return _doc("all-widgets", "18 위젯 데모", blocks)


def bad_example() -> dict:
    """Edge-case round-trip demo — *not* a schema-failing docx.

    Both blocks would lose information if an external LLM produced them
    without hidden widget markers: callout would become a plain colored
    box that autodetect can't recognize, and the kpi-cards would degrade
    to a generic 2x2 table. They round-trip cleanly here only because
    docx_export emits the markers.

    Name kept as 'bad-example' for backward compatibility with CI smoke
    tests, README, and existing release bundles in the wild. The
    validator correctly returns schema-valid (exit 0) on this file —
    the 'bad' label refers to the *marker-less external form*, not the
    rendered docx.
    """
    return _doc("bad-example", "흔한 실수 모음 (autodetect 가 잡거나 못 잡는 패턴)", [
        # callout 처럼 보이지만 색만 있고 신호 없음 → autodetect 가 못 잡음.
        {"type": "callout", "id": _u(), "variant": "info", "text": "그냥 색 박스"},
        # kpi-cards 의 헤더가 잘못된 이름 — 룰 위반은 아니지만 외부 LLM 작성
        # docx 였다면 일반 table 로 떨어짐. 본 example 은 정상 동작 (marker 가
        # round-trip 보장하므로) 이지만 비교용으로 둠.
        {
            "type": "kpi-cards", "id": _u(),
            "items": [{"label": "지표", "value": "값"}],
        },
    ])


def main() -> int:
    # Import the real renderer with a stubbed settings module.
    from app.services import docx_export  # type: ignore[import-not-found]

    examples = {
        "good-example.docx": good_example(),
        "all-widgets.docx": all_widgets_example(),
        "bad-example.docx": bad_example(),
    }
    for name, doc in examples.items():
        out = HERE / name
        blob = docx_export.render_docx(doc)
        out.write_bytes(blob)
        print(f"  {name:<24} {len(blob):>8} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
