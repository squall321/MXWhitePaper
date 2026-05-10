"""Auto-promote inline heading-4 blocks into sub-sections.

When the user inserts a "큰 제목 (H2)" / "중간 제목 (H3)" / "작은 제목 (H4)"
block into a section's body, this module rewrites the document tree so
the heading becomes a real Section node:

  Section(level=1) "개요"
    blocks:
      Paragraph("intro")
      Heading4(level=2, title="배경")     ← inline heading
      Paragraph("body of 배경")
      Paragraph("more")
      Heading4(level=2, title="목표")
      Paragraph("body of 목표")

becomes:

  Section(level=1) "개요"
    blocks: [Paragraph("intro")]
    subsections:
      Section(level=2) "배경"
        blocks: [Paragraph("body of 배경"), Paragraph("more")]
      Section(level=2) "목표"
        blocks: [Paragraph("body of 목표")]

Why automatic? Most users (especially DOCX-imported docs) author with
inline headings — they expect the same outline / numbering / collapse UX
that "real" sections get. Forcing them to fight a separate outline panel
is friction. The promote step is idempotent: a doc that's already tree-
shaped passes through untouched, since there are no `heading-4` blocks
left to move.

Heading level mapping (heading-4.level → target sub-section depth):

  Section level 1 (a top-level chapter):
    H2 → Section level 2
    H3 → Section level 3
    H4 → no room — kept as inline (still rendered as <h4>)

  Section level 2 (a chapter sub-section):
    H2 / H3 → Section level 3
    H4 → no room — inline

  Section level 3 (deepest allowed):
    everything stays inline (no level 4 in the schema)

When the heading-4's target depth would exceed level 3, we keep it as a
plain inline heading so the user's content survives. Otherwise we eat
the heading block and create a new Section whose title carries the
heading's text.

The function mutates `content_json["sections"]` in place and returns
the same dict for chaining.
"""
from __future__ import annotations

from typing import Any

import ulid


def _new_id() -> str:
    return str(ulid.new())


def _heading_target_section_level(
    heading_level: int, section_level: int
) -> int | None:
    """Compute the section level a heading-4 should promote to.

    Heading.level is 2/3/4 (큰/중간/작은 제목). We map to a section-depth
    OFFSET, not an absolute level — H2 always means "one step deeper than
    the enclosing section", regardless of how deep the parent already is.
    Returns None when the heading-4 carries an out-of-range level (we
    only honour 2/3/4).
    """
    if heading_level not in (2, 3, 4):
        return None
    # H2 = depth offset 1, H3 = depth offset 2, H4 = depth offset 3.
    return section_level + (heading_level - 1)


def _promote_one_section(section: dict[str, Any]) -> None:
    """Promote heading-4 blocks inside `section.blocks` into new
    sub-sections appended to `section.subsections`. Recurses into the
    resulting sub-sections so multi-level promotion works in a single pass.
    """
    if not isinstance(section, dict):
        return
    section_level = section.get("level")
    if not isinstance(section_level, int):
        return
    blocks: list[Any] = list(section.get("blocks") or [])
    if not blocks:
        # Still recurse into existing subsections.
        for sub in section.get("subsections") or []:
            _promote_one_section(sub)
        return

    # Walk blocks, splitting on heading-4 markers we *can* promote. We
    # build a stack keyed by section level so a level-1 chapter can host
    # nested level-2 + level-3 sub-sections in a single pass.
    new_blocks: list[Any] = []
    auto_subs: list[dict[str, Any]] = []
    # `open_subs[depth]` is the most recently opened section at that
    # depth. Used to nest a deeper heading inside the right parent.
    open_subs: dict[int, dict[str, Any]] = {}

    def _close_at_or_below(depth: int) -> None:
        for d in list(open_subs.keys()):
            if d >= depth:
                open_subs.pop(d, None)

    def _attach(target_level: int, sub: dict[str, Any]) -> None:
        # Find the deepest open ancestor whose level is < target_level.
        parent: dict[str, Any] | None = None
        for d in sorted(open_subs.keys(), reverse=True):
            if d < target_level:
                parent = open_subs[d]
                break
        if parent is None:
            auto_subs.append(sub)
        else:
            parent.setdefault("subsections", []).append(sub)
        open_subs[target_level] = sub

    def _current_target_blocks() -> list[Any]:
        """Where the next non-heading block should land."""
        if open_subs:
            deepest = open_subs[max(open_subs.keys())]
            return deepest.setdefault("blocks", [])
        return new_blocks

    for blk in blocks:
        if not isinstance(blk, dict):
            _current_target_blocks().append(blk)
            continue
        if blk.get("type") != "heading-4":
            _current_target_blocks().append(blk)
            continue
        heading_level = blk.get("level")
        if not isinstance(heading_level, int):
            heading_level = 4  # default per schema
        target = _heading_target_section_level(heading_level, section_level)
        if target is None:
            # Can't promote (depth exhausted) — keep heading inline.
            _current_target_blocks().append(blk)
            continue
        # Close any open section at or below `target` so the new section
        # becomes a sibling (or child of a shallower open section).
        _close_at_or_below(target)
        new_sub: dict[str, Any] = {
            "id": _new_id(),
            "level": target,
            "title": str(blk.get("title") or ""),
            "blocks": [],
            "subsections": [],
        }
        _attach(target, new_sub)

    # Persist mutations.
    section["blocks"] = new_blocks
    pre_existing_subs = list(section.get("subsections") or [])
    section["subsections"] = pre_existing_subs + auto_subs

    # Recurse into ALL sub-sections (pre-existing + freshly promoted) so
    # multi-level inline headings inside legacy paragraphs surface as
    # nested sections too.
    for sub in section["subsections"]:
        _promote_one_section(sub)


def promote_inline_headings(content_json: dict[str, Any]) -> dict[str, Any]:
    """Walk every section in `content_json` and promote inline heading-4
    blocks into sub-sections. Mutates the dict in place + returns it.
    """
    sections = content_json.get("sections")
    if isinstance(sections, list):
        for sec in sections:
            _promote_one_section(sec)
    return content_json
