"""DocumentJSON v1.0 본문에서 [[slug]] 위키 링크를 추출.

Sprint 3 — links 그래프 채우기에 사용된다.

Grammar:
  [[slug]]
  [[slug|display]]
  [[slug#1.1.1]]
  [[slug#1.1.1|display]]

slug 규칙: 소문자/숫자/하이픈, 100자 이하 (DocumentJSON Slug 와 동일).
anchor 는 점-구분 1~3 세그먼트의 숫자 (section.number).

Walk 대상:
  - Section.title (level 1/2/3 모든 단계)
  - Block.text (paragraph, quote, callout)
  - Block.title (callout — optional)
  - Block.summary (현 schema 에는 없음 — 향후 대비)
  - Block.caption (image, gallery item)
  - Block.items (list — string list)
  - Block.rows / headers (table — 셀 단위)
  - 컨테이너 (columns, tabs, accordion) 내부의 자식 Block 재귀
"""
from __future__ import annotations

import re
from typing import Any

# slug: 소문자/숫자/한글 시작, 1~100자. anchor: 점-구분 1~3 segment 숫자. display: ] 외 자유.
# Hangul 음절 범위 가-힣 도 허용 — 한글 slug 지원 (Polish D).
_WIKI_LINK_RE = re.compile(
    r"\[\[([a-z0-9가-힣][a-z0-9가-힣-]{0,99})"
    r"(?:#([0-9]+(?:\.[0-9]+){0,2}))?"
    r"(?:\|([^\]]+))?\]\]"
)


def _scan_text(
    text: str | None, source_path: str, out: list[dict[str, Any]]
) -> None:
    """문자열 하나에서 모든 위키 링크를 매칭하여 out 에 누적."""
    if not isinstance(text, str) or not text:
        return
    for m in _WIKI_LINK_RE.finditer(text):
        target_slug = m.group(1)
        anchor = m.group(2)
        display = m.group(3)
        # 정규식이 anchor segment 1~3 만 허용하지만 추가 방어
        if anchor and anchor.count(".") > 2:
            continue
        out.append(
            {
                "target_slug": target_slug,
                "anchor": anchor,
                "display": display,
                "source_path": source_path,
            }
        )


def _scan_block(
    block: dict[str, Any], path: str, out: list[dict[str, Any]]
) -> None:
    """단일 Block 내부의 텍스트 필드/자식 Block 을 재귀적으로 스캔."""
    if not isinstance(block, dict):
        return
    btype = block.get("type")
    bid = block.get("id") or "?"
    here = f"{path}/block[{btype}:{bid}]"

    # 텍스트 필드들
    if btype in ("paragraph", "quote", "callout"):
        _scan_text(block.get("text"), here + ".text", out)
    if btype == "callout":
        _scan_text(block.get("title"), here + ".title", out)

    # caption (image, image inside gallery items)
    if btype == "image":
        _scan_text(block.get("caption"), here + ".caption", out)
    if btype == "gallery":
        for i, item in enumerate(block.get("items") or []):
            if isinstance(item, dict):
                _scan_text(
                    item.get("caption"),
                    f"{here}.items[{i}].caption",
                    out,
                )

    # list items (style: bullet/number/check, items: string[])
    if btype == "list":
        for i, item in enumerate(block.get("items") or []):
            _scan_text(item, f"{here}.items[{i}]", out)

    # table headers + rows
    if btype == "table":
        for i, h in enumerate(block.get("headers") or []):
            _scan_text(h, f"{here}.headers[{i}]", out)
        for r, row in enumerate(block.get("rows") or []):
            if isinstance(row, list):
                for c, cell in enumerate(row):
                    _scan_text(cell, f"{here}.rows[{r}][{c}]", out)

    # 컨테이너: columns / tabs / accordion → 자식 Block 재귀
    if btype == "columns":
        for ci, col in enumerate(block.get("columns") or []):
            for bi, child in enumerate(col or []):
                _scan_block(child, f"{here}.columns[{ci}][{bi}]", out)
    if btype == "tabs":
        for ti, tab in enumerate(block.get("tabs") or []):
            if isinstance(tab, dict):
                _scan_text(tab.get("label"), f"{here}.tabs[{ti}].label", out)
                for bi, child in enumerate(tab.get("blocks") or []):
                    _scan_block(child, f"{here}.tabs[{ti}].blocks[{bi}]", out)
    if btype == "accordion":
        for ii, item in enumerate(block.get("items") or []):
            if isinstance(item, dict):
                _scan_text(item.get("label"), f"{here}.items[{ii}].label", out)
                for bi, child in enumerate(item.get("blocks") or []):
                    _scan_block(child, f"{here}.items[{ii}].blocks[{bi}]", out)


def _scan_section(
    section: dict[str, Any], path: str, out: list[dict[str, Any]]
) -> None:
    if not isinstance(section, dict):
        return
    sid = section.get("id") or "?"
    snum = section.get("number") or "?"
    here = f"{path}/section[{snum}:{sid}]"

    _scan_text(section.get("title"), here + ".title", out)

    for bi, block in enumerate(section.get("blocks") or []):
        _scan_block(block, f"{here}.blocks[{bi}]", out)

    for si, sub in enumerate(section.get("subsections") or []):
        _scan_section(sub, f"{here}.subsections[{si}]", out)


def extract_wiki_links(content_json: dict[str, Any]) -> list[dict[str, Any]]:
    """DocumentJSON v1.0 본문에서 모든 위키 링크를 추출.

    Args:
        content_json: DocumentJSON dict (server-validated). sections 키 필수.

    Returns:
        [{target_slug, anchor: str|None, display: str|None, source_path: str}, ...]
        중복(같은 source_path + target_slug + anchor) 제거하지 않음 — DB 측 정책.
    """
    out: list[dict[str, Any]] = []
    if not isinstance(content_json, dict):
        return out

    # summary 도 살핀다 — 위키 링크가 들어갈 수 있다.
    _scan_text(content_json.get("summary"), "summary", out)

    sections = content_json.get("sections") or []
    if isinstance(sections, list):
        for si, section in enumerate(sections):
            _scan_section(section, f"sections[{si}]", out)

    return out
