# 위키 문서 내용 다루기(순수 함수) — 종류 꼴로 빈 문서 짓기 · 블록 연산 적용 · 블록 글 뽑기 · 자동 절 다시 짓기
"""검증(validate — 적용한 결과를 DocumentJSON 으로 본다)과 반영(apply)이 같은 함수를 쓴다. DB 를 만지지 않는다.

연산 꼴(정규화한 것 — ingest 가 짓는다) — `{op, doc, section?, after?, block_id?, block?, cites[{source_id, sid, loc, quote}], why}`.
`block.insert` 의 블록 id 는 묶음을 지을 때 정해 둔다(검토 화면 · 반영 · 근거가 같은 id 를 본다).
"""
from __future__ import annotations

import copy
from collections.abc import Iterator
from typing import Any

import ulid

from app.wiki.schema import RuleBook


class PageOpError(ValueError):
    """연산이 문서에 맞지 않는다 — 없는 절 · 없는 블록."""


def new_id() -> str:
    return str(ulid.new())


def skeleton(book: RuleBook, *, slug: str, type_key: str, title: str, summary: str, owners: list[str],
             division: str) -> dict[str, Any]:
    """종류 꼴(규칙서 sections)대로 절만 있는 위키 문서. 기밀 등급은 internal — restricted 원천은 들이지 않는다(WK-D37)."""
    return {
        "schema_version": "1.0", "id": new_id(), "slug": slug, "title": title[:200], "summary": summary[:500],
        "metadata": {"division": division, "owners": owners, "confidentiality": "internal"},
        "sections": [{"id": new_id(), "level": 1, "title": spec.title, "blocks": [], "subsections": []}
                     for spec in book.sections(type_key)],
    }


def walk_sections(content: dict[str, Any]) -> Iterator[dict[str, Any]]:
    stack = list(reversed(content.get("sections") or []))
    while stack:
        sec = stack.pop()
        yield sec
        stack.extend(reversed(sec.get("subsections") or []))


def find_section(content: dict[str, Any], title: str) -> dict[str, Any] | None:
    return next((sec for sec in walk_sections(content) if sec.get("title") == title), None)


def find_block(content: dict[str, Any], block_id: str) -> tuple[dict[str, Any], int] | None:
    for sec in walk_sections(content):
        for i, blk in enumerate(sec.get("blocks") or []):
            if blk.get("id") == block_id:
                return sec, i
    return None


def apply_ops(content: dict[str, Any], ops: list[dict[str, Any]]) -> dict[str, Any]:
    """연산을 차례로 적용한 새 내용(원본은 그대로)."""
    out = copy.deepcopy(content)
    for op in ops:
        kind = op["op"]
        if kind == "block.insert":
            sec = find_section(out, op["section"])
            if sec is None:
                raise PageOpError(f"절이 없다: {op['section']}")
            blocks = sec.setdefault("blocks", [])
            at = len(blocks)
            if op.get("after"):
                idx = next((i for i, b in enumerate(blocks) if b.get("id") == op["after"]), None)
                if idx is None:
                    raise PageOpError(f"after 블록이 그 절에 없다: {op['after']}")
                at = idx + 1
            blocks.insert(at, copy.deepcopy(op["block"]))
        elif kind in ("block.update", "block.delete"):
            found = find_block(out, op["block_id"])
            if found is None:
                raise PageOpError(f"블록이 없다: {op['block_id']}")
            sec, i = found
            if kind == "block.update":
                sec["blocks"][i] = {**copy.deepcopy(op["block"]), "id": op["block_id"]}
            else:
                del sec["blocks"][i]
        else:
            raise PageOpError(f"모르는 연산: {kind}")
    return out


def block_text(block: dict[str, Any]) -> str:
    """숫자 · 링크 · 개인정보 검사가 읽는 글 — 문단 · 목록 · 표 · 알림 상자."""
    parts: list[str] = []
    for key in ("title", "text", "caption"):
        if isinstance(block.get(key), str):
            parts.append(block[key])
    parts.extend(str(x) for x in block.get("items") or [])
    parts.extend(str(x) for x in block.get("headers") or [])
    for row in block.get("rows") or []:
        parts.extend(str(x) for x in row)
    return "\n".join(parts)


def map_text(block: dict[str, Any], fn: Any) -> dict[str, Any]:
    """블록의 글 칸마다 fn 을 씌운 새 블록(V9 가림)."""
    out = copy.deepcopy(block)
    for key in ("title", "text", "caption"):
        if isinstance(out.get(key), str):
            out[key] = fn(out[key])
    for key in ("items", "headers"):
        if isinstance(out.get(key), list):
            out[key] = [fn(str(x)) for x in out[key]]
    if isinstance(out.get("rows"), list):
        out["rows"] = [[fn(str(x)) for x in row] for row in out["rows"]]
    return out


def set_auto_list(content: dict[str, Any], title: str, items: list[str], *, empty: str) -> None:
    """자동 절을 다시 짓는다 — 그 절의 블록을 목록 하나(비면 문단 하나)로. 블록 id 는 있던 것을 지킨다."""
    sec = find_section(content, title)
    if sec is None:
        return
    old = (sec.get("blocks") or [None])[0]
    keep = old.get("id") if isinstance(old, dict) and old.get("id") else new_id()
    sec["blocks"] = [{"type": "list", "id": keep, "style": "bullet", "items": items} if items
                     else {"type": "paragraph", "id": keep, "text": empty}]
