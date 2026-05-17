"""Detect and verify a manually-authored Table of Contents in a Word doc.

The existing converter (`docx_import.docx_to_document`) walks the OOXML
body once and emits sections / blocks. This module plugs into that walk
with two responsibilities:

  1. **Detect** runs of paragraphs (or `<w:sdt>` blocks) that are a TOC,
     pull the chapter titles + optional page hints out of them.
  2. **Verify** the collected titles against the document's actual
     heading tree (after the walk completes), returning `missing` and
     `extra` lists so the caller can attach warnings and decide whether
     to strip the TOC from the resulting DocumentJSON.

Detection is layered (priority order matches the plan doc §5.1):

    A. Word "real" TOC — `<w:sdt>` whose `<w:docPartObj>/w:gallery val="Table of Contents"`.
    B. TOC-styled paragraphs — `<w:pStyle val="TOC1|TOC2|...">` or 한국어 `목차1..`.
    C. Field-based TOC — `<w:fldChar fldCharType="begin">` followed by
       `<w:instrText>` containing a `TOC ` field instruction.
    D. (opt-in) Heuristic — heading text matches 목차/차례/Contents/...
       AND the run of paragraphs immediately after looks like dotted-
       leader entries with trailing page numbers.

Method D is gated behind `aggressive=True` because false positives can
silently drop body content.

Outputs:
    `TocEntry`s with `title`, optional `page_hint`, and a `source`
    discriminant so warnings can say which heuristic matched.
    `TocCheck` with `missing` (TOC says it exists, body doesn't),
    `extra` (body has heading not in TOC), and warning strings ready
    to push into `ImportSummary.warnings`.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _q(local: str) -> str:
    return f"{{{W_NS}}}{local}"


# ── Data ─────────────────────────────────────────────────────────────


@dataclass
class TocEntry:
    title: str
    page_hint: str | None = None
    level: int | None = None
    source: str = "unknown"  # one of: A, B, C, D


@dataclass
class TocDetection:
    """Set of paragraph element ids (Python `id()` values) that belong
    to a detected TOC, plus the entries themselves and which heuristic
    fired. Walked-during-import code uses `skip_elem_ids` to drop the
    TOC paragraphs without emitting blocks for them."""
    entries: list[TocEntry] = field(default_factory=list)
    skip_elem_ids: set[int] = field(default_factory=set)
    methods_fired: set[str] = field(default_factory=set)

    @property
    def found(self) -> bool:
        return bool(self.entries) or bool(self.skip_elem_ids)

    @property
    def weak(self) -> bool:
        """True iff only the heuristic D fired — the result is more
        likely to have false positives."""
        return self.methods_fired == {"D"}


@dataclass
class TocCheck:
    toc_entries: int
    body_headings: int
    missing: list[str] = field(default_factory=list)  # in TOC, not in body
    extra: list[str] = field(default_factory=list)    # in body, not in TOC


# ── Style names treated as TOC ───────────────────────────────────────
_TOC_STYLE_RE = re.compile(
    r"^(?:toc[1-9]|목차[1-9])$",
    re.IGNORECASE,
)

# Body of an `<w:instrText>` that's a TOC field instruction (cheap match).
_TOC_FIELD_RE = re.compile(r"^\s*TOC(\s|$)", re.IGNORECASE | re.MULTILINE)

# Heading-D trigger words.
_TOC_HEADING_TITLE_RE = re.compile(
    r"^\s*(?:목\s*차|차\s*례|목\s*록|Contents|Table\s+of\s+Contents)\s*$",
    re.IGNORECASE,
)

# A run of dotted leaders before a page number. The leader can be a
# series of `.`, `…`, or a Word `<w:tab>` rendered with leader dots.
_LEADER_PAGE_RE = re.compile(
    r"(?:\.{2,}|…+|\s{2,})\s*(\d{1,4})\s*$"
)


# ── Paragraph helpers ────────────────────────────────────────────────


def _paragraph_style_id(p: ET.Element) -> str | None:
    pPr = p.find(_q("pPr"))
    if pPr is None:
        return None
    pStyle = pPr.find(_q("pStyle"))
    if pStyle is None:
        return None
    return pStyle.get(_q("val"))


def _paragraph_plain_text(p: ET.Element) -> str:
    """Concatenate every `<w:t>` text inside the paragraph. Cheap and
    style-blind — used by heuristics."""
    parts: list[str] = []
    for t in p.iter(_q("t")):
        if t.text:
            parts.append(t.text)
        # treat tabs as a single space so leader patterns still match
    for _tab in p.iter(_q("tab")):
        # leader dots between tabs are common — keep a sentinel
        # so the page-number regex can fire.
        parts.append("\t")
    return "".join(parts)


def _split_title_and_page(text: str) -> tuple[str, str | None]:
    """If the paragraph reads like `'챕터 명 .... 12'`, peel off the
    page number and return (title, page_hint). Otherwise (text, None)."""
    if not text:
        return text, None
    m = _LEADER_PAGE_RE.search(text)
    if m:
        page = m.group(1)
        head = text[: m.start()].rstrip()
        # Strip trailing leader noise that didn't match the page regex.
        head = re.sub(r"[.\s\t…]+$", "", head)
        if head:
            return head, page
    # Tab-separated `title<TAB>page` (no leader dots).
    if "\t" in text:
        head, _, tail = text.rpartition("\t")
        tail_stripped = tail.strip()
        if tail_stripped.isdigit() and head.strip():
            return head.strip(), tail_stripped
    return text.strip(), None


# ── Method A: Word real TOC (`<w:sdt>`) ──────────────────────────────


def _is_toc_sdt(sdt: ET.Element) -> bool:
    """A `<w:sdt>` is the canonical TOC container iff its
    `<w:sdtPr>/<w:docPartObj>/<w:docPartGallery val="Table of Contents"/>`."""
    pr = sdt.find(_q("sdtPr"))
    if pr is None:
        return False
    dpo = pr.find(_q("docPartObj"))
    if dpo is None:
        return False
    gallery = dpo.find(_q("docPartGallery"))
    if gallery is None:
        return False
    val = (gallery.get(_q("val")) or "").lower()
    return "table of contents" in val or val == "목차"


def _collect_from_sdt(sdt: ET.Element, det: TocDetection) -> None:
    content = sdt.find(_q("sdtContent"))
    paragraphs = (content if content is not None else sdt).findall(_q("p"))
    for p in paragraphs:
        det.skip_elem_ids.add(id(p))
        text = _paragraph_plain_text(p).strip()
        if not text:
            continue
        title, page = _split_title_and_page(text)
        if not title:
            continue
        level = _toc_level_from_style(_paragraph_style_id(p))
        det.entries.append(
            TocEntry(title=title, page_hint=page, level=level, source="A")
        )
    if paragraphs:
        det.methods_fired.add("A")


# ── Method B: TOC-styled paragraphs ──────────────────────────────────


def _toc_level_from_style(style_id: str | None) -> int | None:
    if not style_id:
        return None
    m = re.match(r"^(?:toc|목차)([1-9])$", style_id, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


def _is_toc_styled(p: ET.Element) -> bool:
    style = _paragraph_style_id(p)
    if not style:
        return False
    return bool(_TOC_STYLE_RE.match(style))


# ── Method C: field-based TOC ────────────────────────────────────────


def _is_toc_field_begin(p: ET.Element) -> bool:
    """The paragraph contains a `<w:fldChar fldCharType="begin">` followed
    by an `<w:instrText>` with `TOC ` text. We accept either order since
    DOCX serialisers vary."""
    has_begin = False
    has_instr = False
    for fc in p.iter(_q("fldChar")):
        if fc.get(_q("fldCharType")) == "begin":
            has_begin = True
            break
    for it in p.iter(_q("instrText")):
        if it.text and _TOC_FIELD_RE.search(it.text):
            has_instr = True
            break
    return has_begin and has_instr


def _is_toc_field_end(p: ET.Element) -> bool:
    for fc in p.iter(_q("fldChar")):
        if fc.get(_q("fldCharType")) == "end":
            return True
    return False


# ── Method D: heuristic, heading + dotted-leader entries ─────────────


def _looks_like_toc_heading(p: ET.Element) -> bool:
    text = _paragraph_plain_text(p).strip()
    if not text or len(text) > 30:
        return False
    return bool(_TOC_HEADING_TITLE_RE.match(text))


def _looks_like_toc_entry_text(text: str) -> bool:
    """Plain-text shape of one TOC line: short-ish, ends with a page
    number after dotted leader / tab. We're stricter than `_split_title_and_page`
    here because false positives ripple downstream."""
    text = text.strip()
    if not text or len(text) > 200:
        return False
    title, page = _split_title_and_page(text)
    if not page or not title:
        return False
    # Body text rarely ends with "...... 23" — title that's clearly a
    # full sentence is filtered by the trailing-punct check.
    if re.search(r"[.!?]\s*$", title):
        return False
    return True


# ── Main entry ───────────────────────────────────────────────────────


def detect_toc(
    body: ET.Element,
    *,
    aggressive: bool = False,
) -> TocDetection:
    """Scan a `<w:body>` once and pull every TOC we can find.

    Three "real" methods (A/B/C) always run. Heuristic D (`aggressive`)
    is opt-in because a heading literally named "목차" followed by
    short numbered paragraphs in body content is a plausible false
    positive."""
    det = TocDetection()

    # --- direct children walk -----------------------------------------
    children = list(body)

    # A) <w:sdt> blocks
    for sdt in body.iter(_q("sdt")):
        if _is_toc_sdt(sdt):
            _collect_from_sdt(sdt, det)
            # Mark the parent paragraph(s) too if the sdt is nested
            # inside a `<w:p>` (some serialisers wrap each TOC line in
            # its own paragraph then put the sdt around the whole run).
            for p in sdt.iter(_q("p")):
                det.skip_elem_ids.add(id(p))

    # B/C) sweep paragraphs in document order
    in_field = False
    for elem in children:
        if elem.tag != _q("p"):
            in_field = False
            continue
        p = elem

        # C) field-based: enter when we see begin+instrText with TOC,
        # exit at the matching end. Everything in between is the TOC.
        if not in_field and _is_toc_field_begin(p):
            in_field = True
            det.skip_elem_ids.add(id(p))
            det.methods_fired.add("C")
            continue
        if in_field:
            det.skip_elem_ids.add(id(p))
            text = _paragraph_plain_text(p).strip()
            if text:
                title, page = _split_title_and_page(text)
                if title:
                    det.entries.append(
                        TocEntry(title=title, page_hint=page, source="C")
                    )
            if _is_toc_field_end(p):
                in_field = False
            continue

        # B) TOC-styled paragraphs (contiguous run)
        if _is_toc_styled(p):
            det.skip_elem_ids.add(id(p))
            text = _paragraph_plain_text(p).strip()
            if text:
                title, page = _split_title_and_page(text)
                if title:
                    det.entries.append(
                        TocEntry(
                            title=title,
                            page_hint=page,
                            level=_toc_level_from_style(_paragraph_style_id(p)),
                            source="B",
                        )
                    )
                    det.methods_fired.add("B")

    # D) heuristic — run last, only when opted in.
    if aggressive:
        _detect_heuristic_d(children, det)

    return det


def _detect_heuristic_d(children: list[ET.Element], det: TocDetection) -> None:
    """Find a "목차"/"Contents" heading followed by a run of dotted-
    leader entries. Conservative: requires ≥ 2 consecutive paragraph-
    lines that look like TOC entries to confirm.
    """
    p_tag = _q("p")
    n = len(children)
    i = 0
    while i < n:
        p = children[i]
        if p.tag != p_tag or id(p) in det.skip_elem_ids:
            i += 1
            continue
        if not _looks_like_toc_heading(p):
            i += 1
            continue
        # Scan forward for a run of TOC-entry-looking paragraphs.
        run_start = i + 1
        run: list[ET.Element] = []
        j = run_start
        while j < n:
            nxt = children[j]
            if nxt.tag != p_tag:
                break
            if id(nxt) in det.skip_elem_ids:
                break
            text = _paragraph_plain_text(nxt).strip()
            if not text:
                # blank paragraph — allow as separator but don't include
                j += 1
                continue
            if not _looks_like_toc_entry_text(text):
                break
            run.append(nxt)
            j += 1
        if len(run) >= 2:
            det.skip_elem_ids.add(id(p))  # the heading itself
            for entry_p in run:
                det.skip_elem_ids.add(id(entry_p))
                text = _paragraph_plain_text(entry_p).strip()
                title, page = _split_title_and_page(text)
                if title:
                    det.entries.append(
                        TocEntry(title=title, page_hint=page, source="D")
                    )
            det.methods_fired.add("D")
            i = j
            continue
        i += 1


# ── Verify against the resulting DocumentJSON ────────────────────────


def _collect_section_titles(sections: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    stack: list[dict[str, Any]] = list(sections)
    while stack:
        sec = stack.pop()
        title = (sec.get("title") or "").strip()
        if title:
            out.append(title)
        subs = sec.get("subsections") or []
        if isinstance(subs, list):
            stack.extend(subs)
        # also pull headings-4 emitted as blocks (deep numbered headings)
        for blk in (sec.get("blocks") or []):
            if isinstance(blk, dict) and blk.get("type") == "heading-4":
                t = (blk.get("title") or "").strip()
                if t:
                    out.append(t)
    return out


def _normalize(s: str) -> str:
    """Strip leading numbering + whitespace for fuzzy matching."""
    # Drop "1.2 ", "Chapter 1: ", "제 1 장 " (re-uses docx_import patterns
    # would be ideal but we keep this module dependency-free).
    s = re.sub(r"^\s*\d+(?:\.\d+)*[.)\:]?\s+", "", s)
    s = re.sub(r"^\s*(?:Chapter|Section|Part|Article|Appendix)\s+\d+(?:\.\d+)*[.)\:]?\s+", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^\s*(?:제\s*)?\d+\s*[장편절][.)\:]?\s+", "", s)
    s = re.sub(r"\s+", "", s)
    return s.lower()


def verify_toc(
    toc_entries: list[TocEntry],
    sections: list[dict[str, Any]],
) -> TocCheck:
    headings = _collect_section_titles(sections)
    body_norm = {_normalize(h) for h in headings}
    toc_norm = {_normalize(e.title) for e in toc_entries}
    missing = [e.title for e in toc_entries if _normalize(e.title) and _normalize(e.title) not in body_norm]
    extra = [h for h in headings if _normalize(h) and _normalize(h) not in toc_norm]
    return TocCheck(
        toc_entries=len(toc_entries),
        body_headings=len(headings),
        missing=missing,
        extra=extra,
    )


def format_warnings(check: TocCheck) -> list[str]:
    """Render TocCheck.missing into ImportSummary-compatible warning
    strings. `extra` is informational and *not* surfaced as a warning —
    a doc legitimately may have headings not listed in a partial TOC."""
    out: list[str] = []
    for title in check.missing:
        out.append(f"toc entry not found in body: {title!r}")
    return out
