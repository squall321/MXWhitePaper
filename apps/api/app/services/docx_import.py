"""Word (.docx) → DocumentJSON v1.0 변환기.

`POST /imports/docx` 가 호출하는 단방향 컨버터. 결과는 즉시 영구화되지 않고
FE 가 받은 후 별도로 `POST /documents` 를 호출해 저장한다.

설계 결정:
  - **stdlib 만 사용해 OOXML zip 을 직접 파싱한다.** python-docx 도 의존성에는
    있으나 (pyproject.toml 참조), OMML/이미지 추출 측면에서 표현력이
    제한적이라 zipfile + xml.etree 로 전부 처리하는 편이 robust 하다.
  - 이미지 업로드는 기존 `upload_service` 의 sha256 dedup + Pillow 처리 +
    MinIO put 로직을 inline 호출 (별도 endpoint 왕복 없음).
  - **표/이미지 caption** 은 BlockMeta.note 에 보관 (스키마 변경 회피). 직전 또는
    직후 `Caption` 스타일 단락에서 추출.
  - **수식**: `<m:oMath>` → 간단 LaTeX. 지원 노드: f(분수), e(상첨자),
    e(하첨자), rad(루트), nary(시그마/적분), r(텍스트), 일반 연산자/심볼.
    인라인 수식은 단락 내 `$…$` 로, 디스플레이 수식은 `math` 블록으로.
    실패 시 `code` 블록(language='omml-xml') 으로 폴백 + 콘솔 경고.
  - **헤딩 스택**: Heading 1/2/3 → 섹션 트리. Heading 4+ → 가장 최근 섹션의
    heading-4 블록.
  - **리스트**: 연속된 `numPr` 단락을 하나의 `list` 블록으로 묶음. Depth 는
    "  " * depth + text 로 인코딩 (ListBlock.items 컨벤션).
  - **하이퍼링크**: 외부 URL → markdown-lite `[label](url)`.
  - **각주**: 본문 끝에 "각주" level-1 섹션으로 별도 모음.
  - **페이지 브레이크**: meta.note='page-break-before' 빈 단락.

지원하지 않는 케이스 (낙후 fallback):
  - SmartArt → 단순 텍스트 (도형/관계 손실)
  - 임베디드 차트 → drawing 안의 raster image (이미지로만 들어감)
  - 복잡한 수식(matrix, function, accent) → code 블록 폴백
  - 단락 내부 escape 가 필요한 _markdown 문자_ — 의도된 single-pass 컨버전.
"""
from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

import ulid

# ── XML 네임스페이스 ─────────────────────────────────────────────────
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"
M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"

NS = {
    "w": W_NS,
    "r": R_NS,
    "a": A_NS,
    "pic": PIC_NS,
    "m": M_NS,
    "wp": WP_NS,
}

EMU_PER_PIXEL = 9525  # standard EMU → CSS px conversion (1 px = 9525 EMU)


def _q(ns_prefix: str, local: str) -> str:
    """`{ns}local` 형식의 ElementTree 매칭 키."""
    return f"{{{NS[ns_prefix]}}}{local}"


# ── Public API ───────────────────────────────────────────────────────
@dataclass
class ImportSummary:
    """FE 에서 사용자에게 보여줄 import 통계."""
    paragraphs: int = 0
    headings: int = 0
    tables: int = 0
    images: int = 0
    equations: int = 0
    lists: int = 0
    code_blocks: int = 0
    footnotes: int = 0
    endnotes: int = 0
    bibliography_entries: int = 0
    warnings: list[str] = field(default_factory=list)


@dataclass
class _ImportContext:
    """파싱 진행 중 공유되는 mutable state."""
    relationships: dict[str, str]
    media: dict[str, bytes]
    image_uploader: Any  # callable(bytes, filename) -> dict | None
    summary: ImportSummary
    footnotes_xml: bytes | None = None
    endnotes_xml: bytes | None = None
    # Maps DOCX footnote/endnote id (str) → 1-based ordinal as displayed in
    # the body. Populated when we walk the body and see <w:footnoteReference>
    # / <w:endnoteReference>. The "각주" / "미주" sections then emit anchor
    # ids `fn-<ordinal>` / `en-<ordinal>` so the body's [N] marks can scroll
    # to them.
    footnote_order: dict[str, int] = field(default_factory=dict)
    endnote_order: dict[str, int] = field(default_factory=dict)


# ── docx zip 핸들링 ──────────────────────────────────────────────────
def _read_zip_member(zf: zipfile.ZipFile, path: str) -> bytes | None:
    try:
        return zf.read(path)
    except KeyError:
        return None


def _parse_relationships(zf: zipfile.ZipFile) -> dict[str, str]:
    """word/_rels/document.xml.rels → {Id: Target}."""
    raw = _read_zip_member(zf, "word/_rels/document.xml.rels")
    if not raw:
        return {}
    rels: dict[str, str] = {}
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return {}
    rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    for rel in root.findall(f"{{{rel_ns}}}Relationship"):
        rid = rel.get("Id")
        target = rel.get("Target")
        if rid and target:
            rels[rid] = target
    return rels


def _collect_media(zf: zipfile.ZipFile) -> dict[str, bytes]:
    """word/media/image*.* 만 dict 로 모은다."""
    media: dict[str, bytes] = {}
    for name in zf.namelist():
        if name.startswith("word/media/"):
            try:
                media[name] = zf.read(name)
            except KeyError:
                pass
    return media


# ── 텍스트/runs 처리 ─────────────────────────────────────────────────
_MD_ESCAPE_RE = re.compile(r"([\\`*_~\[\]()$])")


def _escape_md_lite(s: str) -> str:
    """markdown-lite 충돌 문자 escape (간단 버전)."""
    return _MD_ESCAPE_RE.sub(r"\\\1", s)


def _wrap_format(text: str, *, bold: bool, italic: bool, strike: bool, underline: bool) -> str:
    if not text:
        return ""
    out = text
    # underline 은 markdown-lite 에 없음 — em-strong 조합으로는 표현 안 되므로
    # `__underline__` 컨벤션을 추가로 사용 (FE 에서 추후 처리 가능).
    if underline:
        out = f"__{out}__"
    if strike:
        out = f"~~{out}~~"
    if italic and bold:
        out = f"***{out}***"
    elif bold:
        out = f"**{out}**"
    elif italic:
        out = f"*{out}*"
    return out


def _run_props(run: ET.Element) -> dict[str, bool]:
    rpr = run.find(_q("w", "rPr"))
    if rpr is None:
        return {}
    def _is_on(tag: str) -> bool:
        e = rpr.find(_q("w", tag))
        if e is None:
            return False
        v = e.get(_q("w", "val"))
        return v != "false" and v != "0"
    return {
        "bold": _is_on("b"),
        "italic": _is_on("i"),
        "strike": _is_on("strike"),
        "underline": _is_on("u"),
    }


def _run_text(run: ET.Element) -> str:
    """단일 <w:r> 의 텍스트 + tab/br 보존."""
    parts: list[str] = []
    for child in run:
        tag = child.tag
        if tag == _q("w", "t"):
            parts.append(child.text or "")
        elif tag == _q("w", "tab"):
            parts.append("\t")
        elif tag == _q("w", "br"):
            parts.append("\n")
        elif tag == _q("w", "noBreakHyphen"):
            parts.append("-")
    return "".join(parts)


def _format_run(run: ET.Element, ctx: _ImportContext | None = None) -> str:
    """Render a `<w:r>` to wiki-flavoured markdown.

    Pure-text runs go through ``_run_text``. When the run carries a
    ``<w:footnoteReference>`` or ``<w:endnoteReference>``, we also append
    a ``[N]`` marker so the body keeps the same ordinal the reader sees,
    and (when ``ctx`` is provided) we cache the docx note id → ordinal
    mapping for the notes-section builder. The FE inline parser turns
    bare ``[N]`` tokens into anchor links.
    """
    text = _run_text(run)
    fn_ref = run.find(_q("w", "footnoteReference"))
    en_ref = run.find(_q("w", "endnoteReference"))
    note_marker = ""
    if fn_ref is not None:
        docx_id = fn_ref.get(_q("w", "id"))
        ordinal = _note_ordinal(ctx, "footnote", docx_id)
        if ordinal:
            # `[^N]` is the FE's pandoc-style footnote marker — the inline
            # parser turns it into a clickable superscript that scrolls to
            # the `#fn-N` anchor in the "각주" section.
            note_marker += f"[^{ordinal}]"
    if en_ref is not None:
        docx_id = en_ref.get(_q("w", "id"))
        ordinal = _note_ordinal(ctx, "endnote", docx_id)
        if ordinal:
            # `[^en-N]` keeps endnote markers in their own anchor namespace
            # so footnote/endnote ordinals can both be `1` without colliding.
            # The inline parser strips the `en-` prefix when rendering the
            # display label, but routes the `href` to `#fn-en-N`.
            note_marker += f"[^en-{ordinal}]"
    if not text and not note_marker:
        return ""
    props = _run_props(run)
    formatted = _wrap_format(
        text,
        bold=props.get("bold", False),
        italic=props.get("italic", False),
        strike=props.get("strike", False),
        underline=props.get("underline", False),
    ) if text else ""
    return formatted + note_marker


def _note_ordinal(
    ctx: _ImportContext | None, kind: str, docx_id: str | None
) -> int | None:
    """Resolve a footnote/endnote docx-id to its 1-based display ordinal.

    The order map is populated by ``_build_notes_section``; if the body
    walk runs first we still need *some* ordinal so the marker renders.
    Use the docx id itself as a fallback ordinal — most word documents
    keep ids contiguous so this matches in 99% of cases. The mapping is
    persisted on ``ctx`` so the next reference for the same id stays
    consistent.
    """
    if ctx is None or docx_id is None:
        return None
    order_map = (
        ctx.footnote_order if kind == "footnote" else ctx.endnote_order
    )
    if docx_id in order_map:
        return order_map[docx_id]
    next_ord = (max(order_map.values()) if order_map else 0) + 1
    order_map[docx_id] = next_ord
    return next_ord


# ── OMML → LaTeX (간단 변환) ─────────────────────────────────────────
_OMML_OP_MAP = {
    "≤": r"\leq", "≥": r"\geq", "≠": r"\neq", "±": r"\pm",
    "∞": r"\infty", "·": r"\cdot", "×": r"\times", "÷": r"\div",
    "α": r"\alpha", "β": r"\beta", "γ": r"\gamma", "δ": r"\delta",
    "ε": r"\epsilon", "θ": r"\theta", "λ": r"\lambda", "μ": r"\mu",
    "π": r"\pi", "σ": r"\sigma", "φ": r"\phi", "ω": r"\omega",
    "Δ": r"\Delta", "Σ": r"\Sigma", "Π": r"\Pi", "Ω": r"\Omega",
    "→": r"\rightarrow", "←": r"\leftarrow", "↔": r"\leftrightarrow",
    "∑": r"\sum", "∫": r"\int", "∏": r"\prod", "√": r"\sqrt",
}


def _omml_text_to_latex(s: str) -> str:
    """OMML <m:t> 의 raw 텍스트를 LaTeX 으로 escape."""
    out = s
    for src, repl in _OMML_OP_MAP.items():
        out = out.replace(src, repl + " ")
    return out


def _omml_to_latex(node: ET.Element) -> str:
    """<m:oMath> 또는 그 자식 노드를 LaTeX 문자열로 재귀 변환."""
    tag = node.tag.split("}", 1)[-1]

    # leaf — text element
    if tag == "t":
        return _omml_text_to_latex(node.text or "")

    # run
    if tag == "r":
        return "".join(_omml_to_latex(c) for c in node)

    # fraction
    if tag == "f":
        num = node.find(_q("m", "num"))
        den = node.find(_q("m", "den"))
        n = _omml_children_to_latex(num) if num is not None else ""
        d = _omml_children_to_latex(den) if den is not None else ""
        return f"\\frac{{{n}}}{{{d}}}"

    # superscript / subscript
    if tag in ("sSup", "sSub", "sSubSup"):
        e = node.find(_q("m", "e"))
        sup = node.find(_q("m", "sup"))
        sub = node.find(_q("m", "sub"))
        base = _omml_children_to_latex(e) if e is not None else ""
        out = base
        if sub is not None:
            out += f"_{{{_omml_children_to_latex(sub)}}}"
        if sup is not None:
            out += f"^{{{_omml_children_to_latex(sup)}}}"
        return out

    # radical (square root / nth root)
    if tag == "rad":
        e = node.find(_q("m", "e"))
        deg = node.find(_q("m", "deg"))
        body = _omml_children_to_latex(e) if e is not None else ""
        if deg is not None:
            d = _omml_children_to_latex(deg)
            if d.strip():
                return f"\\sqrt[{d}]{{{body}}}"
        return f"\\sqrt{{{body}}}"

    # n-ary (sum / int / prod) — operator + sub + sup + body
    if tag == "nary":
        nary_pr = node.find(_q("m", "naryPr"))
        op_char = "∑"
        if nary_pr is not None:
            chr_el = nary_pr.find(_q("m", "chr"))
            if chr_el is not None:
                op_char = chr_el.get(_q("m", "val"), "∑")
        op_latex = _OMML_OP_MAP.get(op_char, r"\sum")
        sub = node.find(_q("m", "sub"))
        sup = node.find(_q("m", "sup"))
        e = node.find(_q("m", "e"))
        out = op_latex
        if sub is not None:
            sub_latex = _omml_children_to_latex(sub)
            if sub_latex.strip():
                out += f"_{{{sub_latex}}}"
        if sup is not None:
            sup_latex = _omml_children_to_latex(sup)
            if sup_latex.strip():
                out += f"^{{{sup_latex}}}"
        if e is not None:
            out += " " + _omml_children_to_latex(e)
        return out

    # delimiter (parentheses)
    if tag == "d":
        e = node.find(_q("m", "e"))
        body = _omml_children_to_latex(e) if e is not None else ""
        return f"\\left({body}\\right)"

    # otherwise — recurse children
    return _omml_children_to_latex(node)


def _omml_children_to_latex(node: ET.Element | None) -> str:
    if node is None:
        return ""
    return "".join(_omml_to_latex(c) for c in node)


def _convert_oMath(omath: ET.Element) -> str:
    return _omml_children_to_latex(omath)


# ── 단락/블록 빌더 ───────────────────────────────────────────────────
def _new_id() -> str:
    return str(ulid.new())


def _paragraph_style(p: ET.Element) -> str | None:
    pPr = p.find(_q("w", "pPr"))
    if pPr is None:
        return None
    pStyle = pPr.find(_q("w", "pStyle"))
    if pStyle is None:
        return None
    return pStyle.get(_q("w", "val"))


def _is_caption(p: ET.Element) -> bool:
    style = _paragraph_style(p) or ""
    # Word default style id 는 'Caption' 또는 'caption' 둘 다 본 적 있음.
    return style.lower() == "caption" or style.startswith("Caption")


def _heading_level(p: ET.Element) -> int | None:
    style = _paragraph_style(p)
    if not style:
        return None
    # Heading1, Heading2, … 또는 'heading 1' 등 다양한 변형 대응
    m = re.match(r"^[Hh]eading\s*([1-9])$", style.replace(" ", ""))
    if m:
        return int(m.group(1))
    return None


def _list_info(p: ET.Element) -> tuple[int, str] | None:
    """`(ilvl, numId)` 또는 None. numPr 가 있어야 함."""
    pPr = p.find(_q("w", "pPr"))
    if pPr is None:
        return None
    numPr = pPr.find(_q("w", "numPr"))
    if numPr is None:
        return None
    ilvl_el = numPr.find(_q("w", "ilvl"))
    numId_el = numPr.find(_q("w", "numId"))
    if numId_el is None:
        return None
    ilvl = int(ilvl_el.get(_q("w", "val"), "0")) if ilvl_el is not None else 0
    numId = numId_el.get(_q("w", "val"), "0")
    return ilvl, numId


def _has_page_break(p: ET.Element) -> bool:
    for br in p.iter(_q("w", "br")):
        if br.get(_q("w", "type")) == "page":
            return True
    return False


def _paragraph_text(
    p: ET.Element,
    ctx: _ImportContext,
) -> tuple[str, list[ET.Element]]:
    """단락의 inline 텍스트 (markdown-lite + 인라인 수식 + 하이퍼링크)
    + 그 단락에 포함된 <w:drawing> 리스트 반환."""
    parts: list[str] = []
    drawings: list[ET.Element] = []

    for child in p.iter():
        tag = child.tag

        if tag == _q("w", "hyperlink"):
            # hyperlink 자체를 처리 — 자식 run 들의 결합 텍스트 + r:id → URL
            label_runs: list[str] = []
            for run in child.findall(_q("w", "r")):
                label_runs.append(_format_run(run, ctx))
            label = "".join(label_runs)
            rid = child.get(_q("r", "id"))
            url = ctx.relationships.get(rid or "")
            if url and label:
                parts.append(f"[{label}]({url})")
            else:
                parts.append(label)

        elif tag == _q("m", "oMath"):
            # 인라인 수식 (단락 내부 → $…$)
            try:
                latex = _convert_oMath(child)
                if latex.strip():
                    parts.append(f"${latex}$")
                    ctx.summary.equations += 1
            except Exception as e:
                ctx.summary.warnings.append(f"inline omml conversion failed: {e}")

        elif tag == _q("w", "drawing"):
            drawings.append(child)

    # iter() 가 hyperlink 안 run 들을 다시 방문하므로, 위 방식은 이중 카운트가
    # 가능. 안전하게: 직계 자식만 순회하면서, hyperlink 가 아닌 r/oMath 만 처리.
    # → 위 루프를 폐기하고 직계 순회로 다시 빌드.
    parts.clear()
    drawings.clear()

    def _walk(elem: ET.Element, in_hyperlink: bool = False) -> None:
        for ch in elem:
            ctag = ch.tag
            if ctag == _q("w", "hyperlink"):
                rid = ch.get(_q("r", "id"))
                url = ctx.relationships.get(rid or "")
                # 모든 run 의 텍스트 합치기 (서식 적용)
                inner_parts: list[str] = []
                # hyperlink 는 자식이 run 만 있다고 가정하고 직접 _format_run
                for run in ch.findall(_q("w", "r")):
                    inner_parts.append(_format_run(run, ctx))
                # drawing 도 hyperlink 안에 들어올 수 있음 — 별도 등록
                for d in ch.iter(_q("w", "drawing")):
                    drawings.append(d)
                label = "".join(inner_parts)
                if url and label:
                    parts.append(f"[{label}]({url})")
                else:
                    parts.append(label)
            elif ctag == _q("w", "r"):
                # 직계 run
                parts.append(_format_run(ch, ctx))
                for d in ch.findall(_q("w", "drawing")):
                    drawings.append(d)
                # OMML 이 run 내부 nested 인 경우는 거의 없음. 보수적으로 검사.
            elif ctag == _q("m", "oMath"):
                try:
                    latex = _convert_oMath(ch)
                    if latex.strip():
                        parts.append(f"${latex}$")
                        ctx.summary.equations += 1
                except Exception as e:
                    ctx.summary.warnings.append(
                        f"inline omml conversion failed: {e}"
                    )
            elif ctag == _q("m", "oMathPara"):
                # 디스플레이 수식이 단락 내부 wrapper 로 들어옴 — 처리는 호출자
                # 측에서 (단락이 수식 전용인 경우)
                pass

    _walk(p)
    return "".join(parts), drawings


def _table_cell_text(tc: ET.Element, ctx: _ImportContext) -> str:
    """단일 셀의 모든 단락 텍스트를 \\n 으로 연결."""
    chunks: list[str] = []
    for p in tc.findall(_q("w", "p")):
        text, _drawings = _paragraph_text(p, ctx)
        chunks.append(text)
    return "\n".join(chunks).strip()


# ── 이미지 처리 ──────────────────────────────────────────────────────
def _drawing_image_target(drawing: ET.Element, rels: dict[str, str]) -> str | None:
    """drawing 안의 a:blip r:embed → 미디어 경로(media/imageN.png 등)."""
    for blip in drawing.iter(_q("a", "blip")):
        rid = blip.get(_q("r", "embed")) or blip.get(_q("r", "link"))
        if rid and rid in rels:
            target = rels[rid]
            # rels 의 target 은 'media/image1.png' 형식 (word/ 기준 상대)
            if target.startswith("/"):
                return target.lstrip("/")
            return f"word/{target}" if not target.startswith("word/") else target
    return None


def _drawing_size_px(drawing: ET.Element) -> tuple[int | None, int | None]:
    """wp:extent cx/cy (EMU) → px. 없으면 (None, None)."""
    for ext in drawing.iter(_q("wp", "extent")):
        cx = ext.get("cx")
        cy = ext.get("cy")
        try:
            w = int(int(cx) / EMU_PER_PIXEL) if cx else None
            h = int(int(cy) / EMU_PER_PIXEL) if cy else None
            # 스키마 cap (32 ≤ w/h ≤ 4000)
            def _clamp(v: int | None) -> int | None:
                if v is None:
                    return None
                return max(32, min(4000, v))
            return _clamp(w), _clamp(h)
        except (TypeError, ValueError):
            return None, None
    return None, None


# ── 메인 변환 ────────────────────────────────────────────────────────
def docx_to_document(
    buf: bytes,
    *,
    slug: str,
    title: str,
    owner_user_id: str,
    image_uploader: Any | None = None,
    division: str = "MX",
) -> dict[str, Any]:
    """Word .docx 바이트 → DocumentJSON v1.0 dict.

    Args:
        buf: .docx 파일 바이트 (≤ 30 MB, 호출자가 사이즈 검증)
        slug: 결과 문서의 slug
        title: 결과 문서의 title (override 안되면 첫 헤딩에서 유추)
        owner_user_id: metadata.owners 첫 항목
        image_uploader: callable(bytes, filename) -> dict|None.
            반환은 `{"image_id": str, ...}` 형태. None 이면 이미지가 placeholder
            로만 들어감 (테스트용).
        division: metadata.division (default "MX")

    Returns:
        DocumentJSON v1.0 dict. 호출자가 Pydantic 검증 후 응답.
        meta.import_summary 형태로 통계도 포함 (FE 표시용).
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(buf))
    except zipfile.BadZipFile as e:
        raise ValueError(f"not a valid .docx zip: {e}") from e

    document_xml = _read_zip_member(zf, "word/document.xml")
    if not document_xml:
        raise ValueError("word/document.xml missing — not a valid .docx")

    relationships = _parse_relationships(zf)
    media = _collect_media(zf)
    footnotes_xml = _read_zip_member(zf, "word/footnotes.xml")
    endnotes_xml = _read_zip_member(zf, "word/endnotes.xml")

    summary = ImportSummary()
    ctx = _ImportContext(
        relationships=relationships,
        media=media,
        image_uploader=image_uploader,
        summary=summary,
        footnotes_xml=footnotes_xml,
        endnotes_xml=endnotes_xml,
    )

    try:
        doc_root = ET.fromstring(document_xml)
    except ET.ParseError as e:
        raise ValueError(f"document.xml parse error: {e}") from e

    body = doc_root.find(_q("w", "body"))
    if body is None:
        raise ValueError("document.xml has no <w:body>")

    # 1) 본문 children 을 순회하며 섹션 트리 + 블록 빌드
    sections, derived_title = _build_sections(body, ctx)

    # 2) 각주 섹션 (있을 때만)
    if footnotes_xml:
        fn_section = _build_footnotes_section(footnotes_xml, ctx)
        if fn_section:
            sections.append(fn_section)

    # 2b) 미주 섹션 (있을 때만) — 각주와 동일한 패턴.
    if endnotes_xml:
        en_section = _build_endnotes_section(endnotes_xml, ctx)
        if en_section:
            sections.append(en_section)

    # 2c) References / 참고문헌 / Bibliography 섹션을 식별해서 그 안의
    #     plain paragraphs 를 BibliographyBlock 으로 모은다. heuristics 는
    #     보수적 — 매칭되는 헤더만 변환하고 본문 그대로 유지.
    _convert_references_sections(sections, ctx)

    # 3) 섹션이 비어 있으면 default level-1 wrapper 1개 생성 (DocumentJSON
    #    스키마는 sections 가 비어 있으면 안 되는 건 아니지만, 빈 문서는
    #    UX 가 어색하므로 fallback)
    if not sections:
        sections = [{
            "id": _new_id(),
            "level": 1,
            "number": "1",
            "title": "본문",
            "blocks": [],
            "subsections": [],
        }]

    final_title = title or derived_title or slug

    doc: dict[str, Any] = {
        "schema_version": "1.0",
        "id": _new_id(),
        "slug": slug,
        "title": final_title[:200],
        "metadata": {
            "division": division,
            "owners": [owner_user_id],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": sections,
    }

    return {"document": doc, "summary": summary}


# ── 섹션/블록 빌더 ───────────────────────────────────────────────────
def _new_section(level: int, title: str) -> dict[str, Any]:
    return {
        "id": _new_id(),
        "level": level,
        "title": title[:200] or "(제목 없음)",
        "blocks": [],
        "subsections": [],
    }


def _ensure_section_path(
    sections: list[dict[str, Any]],
    stack: list[dict[str, Any]],
    new_level: int,
    new_title: str,
) -> dict[str, Any]:
    """heading 스택을 갱신하고 새 섹션 dict 를 반환 (현재 활성).

    stack[i] 는 level (i+1) 의 활성 섹션. 없으면 None placeholder 채움.
    """
    # 새로 만들 섹션
    new_sec = _new_section(new_level, new_title)
    if new_level == 1:
        sections.append(new_sec)
        stack.clear()
        stack.append(new_sec)
    elif new_level == 2:
        # level-1 부모가 없으면 자동 생성
        if not stack or stack[0].get("level") != 1:
            parent = _new_section(1, "본문")
            sections.append(parent)
            stack.clear()
            stack.append(parent)
        stack[0]["subsections"].append(new_sec)
        stack[:] = [stack[0], new_sec]
    elif new_level == 3:
        if not stack or stack[0].get("level") != 1:
            parent1 = _new_section(1, "본문")
            sections.append(parent1)
            stack.clear()
            stack.append(parent1)
        if len(stack) < 2 or stack[1].get("level") != 2:
            parent2 = _new_section(2, "")
            stack[0]["subsections"].append(parent2)
            stack[:] = [stack[0], parent2]
        stack[1]["subsections"].append(new_sec)
        stack[:] = [stack[0], stack[1], new_sec]
    return new_sec


def _current_section(
    sections: list[dict[str, Any]], stack: list[dict[str, Any]]
) -> dict[str, Any]:
    """블록을 추가할 현재 활성 섹션. 없으면 default level-1 생성."""
    if not stack:
        sec = _new_section(1, "본문")
        sections.append(sec)
        stack.append(sec)
    return stack[-1]


def _build_sections(
    body: ET.Element,
    ctx: _ImportContext,
) -> tuple[list[dict[str, Any]], str | None]:
    """w:body 의 children 을 한 패스로 훑어 섹션 트리 + 블록 채우기."""
    sections: list[dict[str, Any]] = []
    stack: list[dict[str, Any]] = []
    derived_title: str | None = None

    # 한 번에 직계 children 만 모은다 (sectPr 등 메타는 무시)
    children = [c for c in body if c.tag in (_q("w", "p"), _q("w", "tbl"))]

    # 리스트 그룹 누적 / caption 페어링용
    pending_caption: str | None = None
    list_buffer: list[tuple[int, str]] = []  # (depth, text)
    list_style: str = "bullet"

    def _flush_list() -> None:
        nonlocal list_buffer, list_style
        if not list_buffer:
            return
        sec = _current_section(sections, stack)
        items = ["  " * d + t for d, t in list_buffer]
        sec["blocks"].append({
            "type": "list",
            "id": _new_id(),
            "style": list_style,
            "items": items,
        })
        ctx.summary.lists += 1
        list_buffer = []

    i = 0
    while i < len(children):
        node = children[i]
        tag = node.tag

        # ── 표 ─────────────────────────────────────────────
        if tag == _q("w", "tbl"):
            _flush_list()
            table_block = _build_table_block(node, ctx)
            # caption 직전 단락이 있으면 사용 (pending_caption 우선)
            if pending_caption:
                table_block.setdefault("meta", {})["note"] = pending_caption
                pending_caption = None
            else:
                # 직후 단락이 caption 인지 lookahead
                if i + 1 < len(children) and children[i + 1].tag == _q("w", "p"):
                    nxt = children[i + 1]
                    if _is_caption(nxt):
                        cap_text, _ = _paragraph_text(nxt, ctx)
                        cap_text = cap_text.strip()
                        if cap_text:
                            table_block.setdefault("meta", {})["note"] = cap_text
                        i += 1  # consume caption
            sec = _current_section(sections, stack)
            sec["blocks"].append(table_block)
            ctx.summary.tables += 1
            i += 1
            continue

        # ── 단락 ───────────────────────────────────────────
        # heading 처리 우선
        h_level = _heading_level(node)
        if h_level is not None:
            _flush_list()
            text, _drawings = _paragraph_text(node, ctx)
            text = text.strip() or "(제목 없음)"
            if h_level <= 3:
                _ensure_section_path(sections, stack, h_level, text)
                ctx.summary.headings += 1
                if derived_title is None and h_level == 1:
                    derived_title = text
            else:
                # heading-4+ → block
                level_val: Any = 4 if h_level >= 4 else h_level
                # schema BlockMeta.level 은 2|3|4 만 허용 — heading-4 block 은 4 강제
                sec = _current_section(sections, stack)
                sec["blocks"].append({
                    "type": "heading-4",
                    "id": _new_id(),
                    "title": text[:200],
                    "meta": {"level": int(level_val) if level_val in (2, 3, 4) else 4},
                })
                ctx.summary.headings += 1
            pending_caption = None
            i += 1
            continue

        # caption 단락 — 다음 표/이미지에 붙일 텍스트로 보관
        if _is_caption(node):
            cap_text, _ = _paragraph_text(node, ctx)
            cap_text = cap_text.strip()
            if cap_text:
                pending_caption = cap_text
            i += 1
            continue

        # list 단락
        list_meta = _list_info(node)
        if list_meta is not None:
            depth, _numId = list_meta
            text, _drawings = _paragraph_text(node, ctx)
            text = text.strip()
            if text:
                list_buffer.append((depth, text))
            else:
                _flush_list()
            i += 1
            continue
        else:
            _flush_list()

        # 페이지 브레이크
        if _has_page_break(node):
            sec = _current_section(sections, stack)
            sec["blocks"].append({
                "type": "paragraph",
                "id": _new_id(),
                "text": "",
                "meta": {"note": "page-break-before"},
            })
            ctx.summary.paragraphs += 1
            i += 1
            continue

        # 일반 단락 처리
        text, drawings = _paragraph_text(node, ctx)
        text = text.strip()

        # display 수식 단락 (m:oMathPara) 만 들어 있는 경우 → math 블록
        oMathPara = node.find(_q("m", "oMathPara"))
        if oMathPara is not None and not text and not drawings:
            try:
                latex = _omml_children_to_latex(oMathPara)
                if latex.strip():
                    sec = _current_section(sections, stack)
                    sec["blocks"].append({
                        "type": "math",
                        "id": _new_id(),
                        "expression": latex.strip(),
                        "display": "block",
                    })
                    ctx.summary.equations += 1
                    pending_caption = None
                    i += 1
                    continue
            except Exception as e:
                ctx.summary.warnings.append(f"display omml failed: {e}")
                # fallback to code block
                sec = _current_section(sections, stack)
                sec["blocks"].append({
                    "type": "code",
                    "id": _new_id(),
                    "language": "omml-xml",
                    "code": ET.tostring(oMathPara, encoding="unicode"),
                })
                ctx.summary.code_blocks += 1
                i += 1
                continue

        # 이미지(들) 처리 — 각 drawing 마다 image 블록
        for drawing in drawings:
            target = _drawing_image_target(drawing, ctx.relationships)
            if not target:
                continue
            media_path = target if target.startswith("word/") else f"word/{target}"
            img_bytes = ctx.media.get(media_path)
            if not img_bytes:
                ctx.summary.warnings.append(f"image missing: {media_path}")
                continue
            uploaded: dict[str, Any] | None = None
            if ctx.image_uploader is not None:
                try:
                    uploaded = ctx.image_uploader(img_bytes, media_path.rsplit("/", 1)[-1])
                except Exception as e:
                    ctx.summary.warnings.append(f"image upload failed: {e}")
            w_px, h_px = _drawing_size_px(drawing)
            block: dict[str, Any] = {
                "type": "image",
                "id": _new_id(),
                "imageId": (uploaded or {}).get("image_id") or _new_id(),
            }
            # caption — pending 우선, 없으면 직후 단락 lookahead
            cap = pending_caption
            pending_caption = None
            if not cap and i + 1 < len(children):
                nxt = children[i + 1]
                if nxt.tag == _q("w", "p") and _is_caption(nxt):
                    c, _ = _paragraph_text(nxt, ctx)
                    cap = c.strip() or None
                    if cap is not None:
                        i += 1  # consume caption next iteration
            if cap:
                block["caption"] = cap[:500]
            meta: dict[str, Any] = {}
            if w_px is not None:
                meta["width"] = w_px
            if h_px is not None:
                meta["height"] = h_px
            if meta:
                block["meta"] = meta
            sec = _current_section(sections, stack)
            sec["blocks"].append(block)
            ctx.summary.images += 1

        # 텍스트 단락 (이미지가 없거나, 이미지 외 텍스트가 있는 경우)
        if text:
            sec = _current_section(sections, stack)
            sec["blocks"].append({
                "type": "paragraph",
                "id": _new_id(),
                "text": text,
            })
            ctx.summary.paragraphs += 1
            pending_caption = None
        i += 1

    _flush_list()
    return sections, derived_title


def _build_table_block(tbl: ET.Element, ctx: _ImportContext) -> dict[str, Any]:
    """w:tbl → TableBlock dict.

    Honours cell merges:
        <w:gridSpan w:val="N">      — horizontal span (colSpan)
        <w:vMerge w:val="restart">  — vertical merge anchor (rowSpan starts here)
        <w:vMerge/>                 — continuation cell (covered by the anchor above)

    If any cell carries a merge attribute, we emit a sparse ``cells`` list
    that the FE renderer turns into a real ``<td colspan rowspan>`` grid.
    Plain tables (no merges anywhere) keep the simpler ``headers/rows``
    representation so existing fixtures and editors don't have to think
    about cell sparsity.
    """
    tr_list = tbl.findall(_q("w", "tr"))
    if not tr_list:
        return {
            "type": "table",
            "id": _new_id(),
            "headers": [],
            "rows": [],
        }

    # First pass: pull text + per-tc merge attributes for every row.
    raw_rows: list[list[dict[str, Any]]] = []
    has_merge = False
    for tr in tr_list:
        row_cells: list[dict[str, Any]] = []
        for tc in tr.findall(_q("w", "tc")):
            tc_pr = tc.find(_q("w", "tcPr"))
            grid_span = 1
            v_merge: str | None = None  # None | "restart" | "continue"
            if tc_pr is not None:
                gs = tc_pr.find(_q("w", "gridSpan"))
                if gs is not None:
                    try:
                        grid_span = max(1, int(gs.get(_q("w", "val")) or "1"))
                    except ValueError:
                        grid_span = 1
                vm = tc_pr.find(_q("w", "vMerge"))
                if vm is not None:
                    raw_v = vm.get(_q("w", "val"))
                    v_merge = "restart" if raw_v == "restart" else "continue"
            if grid_span > 1 or v_merge is not None:
                has_merge = True
            row_cells.append({
                "text": _table_cell_text(tc, ctx),
                "gridSpan": grid_span,
                "vMerge": v_merge,
            })
        raw_rows.append(row_cells)

    if not has_merge:
        # Fast path — emit the legacy headers/rows shape.
        flat_rows = [[c["text"] for c in row] for row in raw_rows]
        return {
            "type": "table",
            "id": _new_id(),
            "headers": flat_rows[0],
            "rows": flat_rows[1:],
        }

    # Second pass: lay the cells out on a virtual grid honouring spans.
    # We track which (r, c) slots are already occupied by an earlier anchor
    # so we can find the next free column when emitting a new cell, and we
    # extend an anchor's rowSpan when its row carries a `vMerge="continue"`
    # cell at the same column range.
    occupied: set[tuple[int, int]] = set()
    # anchors keyed by (start_row, start_col). Mutated to extend rowSpan.
    anchors: dict[tuple[int, int], dict[str, Any]] = {}
    # Map (current_row, col) → the anchor key that "owns" this slot via a
    # continuing vMerge so we can extend its rowSpan when we walk the next row.
    open_v_merges: dict[int, tuple[int, int]] = {}

    cells_out: list[dict[str, Any]] = []
    max_cols = 0

    for r_idx, row in enumerate(raw_rows):
        col = 0
        # Skip past any columns already occupied by a multi-row anchor.
        while (r_idx, col) in occupied:
            col += 1
        consumed_v: set[int] = set()
        for cell in row:
            # Skip occupied slots.
            while (r_idx, col) in occupied:
                col += 1
            grid_span = int(cell["gridSpan"])
            v_merge = cell["vMerge"]
            text = cell["text"]
            if v_merge == "continue":
                # Find the anchor whose colSpan covers this column range.
                anchor_key = open_v_merges.get(col)
                if anchor_key is not None:
                    anchor = anchors.get(anchor_key)
                    if anchor is not None:
                        anchor["rowSpan"] = anchor.get("rowSpan", 1) + 1
                # Mark the slots this continuation occupies so subsequent
                # cells in this row skip them, and the anchor extends below.
                for cc in range(col, col + grid_span):
                    occupied.add((r_idx, cc))
                    consumed_v.add(cc)
                col += grid_span
                continue

            anchor_key = (r_idx, col)
            entry: dict[str, Any] = {
                "r": r_idx,
                "c": col,
                "text": text,
            }
            if grid_span > 1:
                entry["colSpan"] = grid_span
            anchors[anchor_key] = entry
            cells_out.append(entry)
            for cc in range(col, col + grid_span):
                occupied.add((r_idx, cc))
            if v_merge == "restart":
                # This cell will gain rowSpan as continuations show up below.
                for cc in range(col, col + grid_span):
                    open_v_merges[cc] = anchor_key
                    consumed_v.add(cc)
            col += grid_span
        # Any column whose vMerge wasn't continued in this row closes its merge.
        for c_open in list(open_v_merges.keys()):
            if c_open not in consumed_v:
                open_v_merges.pop(c_open, None)
        max_cols = max(max_cols, col)

    # First-row cells become headers — mark them so the renderer uses <th>.
    for entry in cells_out:
        if entry["r"] == 0:
            entry["header"] = True

    # rowSpan == 1 entries don't need to carry the field (default).
    for entry in cells_out:
        if entry.get("rowSpan") == 1:
            del entry["rowSpan"]
        if entry.get("colSpan") == 1:
            del entry["colSpan"]

    # We still emit the legacy headers/rows arrays for back-compat clients
    # (and so the search index keeps the textual content in a flat shape).
    # The FE prefers `cells` when present.
    flat_rows = [[c["text"] for c in row] for row in raw_rows]
    headers = flat_rows[0] if flat_rows else []
    rows = flat_rows[1:]

    return {
        "type": "table",
        "id": _new_id(),
        "headers": headers,
        "rows": rows,
        "cells": cells_out,
    }


# ── References → BibliographyBlock heuristic ─────────────────────────
_REFERENCES_TITLE_RE = re.compile(
    r"^\s*(references|bibliography|works cited|literature cited|"
    r"참고\s*문헌|참고자료|인용\s*문헌)\s*$",
    re.IGNORECASE,
)


def _convert_references_sections(
    sections: list[dict[str, Any]],
    ctx: _ImportContext,
) -> None:
    """Walk every section + subsection. When a heading title matches one of
    the well-known reference list labels, replace the section's plain
    paragraph blocks with a single ``BibliographyBlock`` whose entries
    mirror the original paragraph text. Mutates ``sections`` in place.

    Each entry's ``key`` is auto-generated from the leading citation
    marker if one is present (e.g. ``[Smith2020]`` / ``[3]`` / ``Smith,
    J. 2020``). When the importer can't extract a key, the entry simply
    has no key and inline ``[[cite:KEY]]`` references won't anchor — the
    user can fix that up in the editor.
    """

    def _walk(secs: list[dict[str, Any]]) -> None:
        for sec in secs:
            title = (sec.get("title") or "").strip()
            if title and _REFERENCES_TITLE_RE.match(title):
                _materialise_bibliography(sec, ctx)
            children = sec.get("subsections") or []
            if isinstance(children, list):
                _walk(children)

    _walk(sections)


def _materialise_bibliography(
    section: dict[str, Any],
    ctx: _ImportContext,
) -> None:
    """Replace a section's paragraph blocks with a single
    ``BibliographyBlock`` whose entries mirror the original text. Keeps
    non-paragraph blocks (tables, images embedded in references) as-is —
    only collapses the *list* of references."""
    blocks = section.get("blocks") or []
    if not isinstance(blocks, list) or not blocks:
        return
    para_texts: list[str] = []
    keepers: list[dict[str, Any]] = []
    for blk in blocks:
        if isinstance(blk, dict) and blk.get("type") == "paragraph":
            text = (blk.get("text") or "").strip()
            if text:
                para_texts.append(text)
        elif isinstance(blk, dict):
            keepers.append(blk)
    if not para_texts:
        return
    entries: list[dict[str, Any]] = []
    for text in para_texts:
        entry: dict[str, Any] = {"text": text}
        key = _guess_citation_key(text)
        if key:
            entry["key"] = key
        url = _extract_first_url(text)
        if url:
            entry["url"] = url
        entries.append(entry)
        ctx.summary.bibliography_entries += 1
    biblio: dict[str, Any] = {
        "type": "bibliography",
        "id": _new_id(),
        "entries": entries,
    }
    section["blocks"] = keepers + [biblio]


_CITE_KEY_BRACKET_RE = re.compile(r"^\[([A-Za-z][A-Za-z0-9_-]{2,40})\]")
_CITE_KEY_NUMBER_RE = re.compile(r"^\[(\d{1,4})\]")
_CITE_AUTHOR_YEAR_RE = re.compile(
    r"^([A-Z][A-Za-z'-]+)(?:[ ,]+(?:[A-Z]\.\s*)+)?[ ,]+\(?(\d{4})\)?",
)
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


def _guess_citation_key(text: str) -> str | None:
    """Derive a citation key from a reference paragraph.

    Examples that map to a key:
      - "[Smith2020] J. Smith ..."  → "Smith2020"
      - "[3] J. Smith ..."           → no alphabetic key, return None (the
                                        FE displays the index either way)
      - "Smith, J. (2020). ..."      → "Smith2020"

    The goal is best-effort: missing key just means inline
    ``[[cite:KEY]]`` won't anchor. Users can fill it in the editor.
    """
    m = _CITE_KEY_BRACKET_RE.match(text)
    if m:
        return m.group(1)
    n = _CITE_AUTHOR_YEAR_RE.match(text)
    if n:
        return f"{n.group(1)}{n.group(2)}"
    return None


def _extract_first_url(text: str) -> str | None:
    m = _URL_RE.search(text)
    if not m:
        return None
    url = m.group(0)
    # Trim trailing punctuation that often glues to a URL in prose.
    while url and url[-1] in ".,;:)":
        url = url[:-1]
    return url or None


def _build_footnotes_section(
    footnotes_xml: bytes, ctx: _ImportContext
) -> dict[str, Any] | None:
    """word/footnotes.xml → "각주" level-1 section.

    Each rendered entry is a paragraph that begins with `[N]` so the
    body's footnote markers (also `[N]`) read naturally. The paragraph's
    block id encodes the ordinal (`fn-N`) when possible — the FE inline
    parser uses that to turn body `[N]` marks into clickable anchor links
    that scroll to the entry.
    """
    return _build_notes_section(
        footnotes_xml, ctx, kind="footnote", title="각주",
    )


def _build_endnotes_section(
    endnotes_xml: bytes, ctx: _ImportContext
) -> dict[str, Any] | None:
    """word/endnotes.xml → "미주" level-1 section. Same shape as footnotes."""
    return _build_notes_section(
        endnotes_xml, ctx, kind="endnote", title="미주",
    )


def _build_notes_section(
    raw: bytes,
    ctx: _ImportContext,
    *,
    kind: str,
    title: str,
) -> dict[str, Any] | None:
    """Shared implementation for footnote/endnote walk.

    DOCX serialises both with the same shape (`<w:footnote>` /
    `<w:endnote>` element wrapping `<w:p>` paragraphs); only the element
    name differs. `kind` selects the right element name + drives the
    summary counter and the anchor ULID prefix used by the FE link parser.
    """
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None
    el_name = "footnote" if kind == "footnote" else "endnote"
    order_map = ctx.footnote_order if kind == "footnote" else ctx.endnote_order
    blocks: list[dict[str, Any]] = []
    idx = 0
    for fn in root.findall(_q("w", el_name)):
        fn_type = fn.get(_q("w", "type"))
        # separator/continuationSeparator/continuationNotice 는 본문 노트가 아님.
        if fn_type in ("separator", "continuationSeparator", "continuationNotice"):
            continue
        idx += 1
        chunks: list[str] = []
        for p in fn.findall(_q("w", "p")):
            text, _ = _paragraph_text(p, ctx)
            text = text.strip()
            if text:
                chunks.append(text)
        if not chunks:
            continue
        joined = "\n".join(chunks)
        # Stable ULID — also remember the docx side's id → ordinal mapping
        # so that the body walker can compute the same `[N]` ordinals when
        # it encounters <w:footnoteReference>.
        block_id = _new_id()
        docx_id = fn.get(_q("w", "id"))
        if docx_id is not None:
            order_map[str(docx_id)] = idx
        # Pandoc-style footnote/endnote definition: the FE's
        # `parseFootnoteDefinition` matches `[^TAG]: …`, hides the literal
        # paragraph from the read view, and emits a `<li id="fn-TAG">` in
        # the section-bottom note list. Body markers (`[^N]` / `[^en-N]`)
        # use the same TAG and therefore land at the right anchor.
        tag = f"en-{idx}" if kind == "endnote" else str(idx)
        blocks.append({
            "type": "paragraph",
            "id": block_id,
            "text": f"[^{tag}]: {joined}",
        })
        if kind == "footnote":
            ctx.summary.footnotes += 1
        else:
            ctx.summary.endnotes += 1
    if not blocks:
        return None
    return {
        "id": _new_id(),
        "level": 1,
        "title": title,
        "blocks": blocks,
        "subsections": [],
    }


# ── 검증 헬퍼 (라우터에서 사용) ──────────────────────────────────────
ZIP_MAGIC_PK = b"PK\x03\x04"
ZIP_MAGIC_EMPTY = b"PK\x05\x06"
ZIP_MAGIC_SPANNED = b"PK\x07\x08"


def is_docx_zip_magic(buf: bytes) -> bool:
    """첫 4 바이트로 zip 여부 판정."""
    if len(buf) < 4:
        return False
    head = buf[:4]
    return head in (ZIP_MAGIC_PK, ZIP_MAGIC_EMPTY, ZIP_MAGIC_SPANNED)


def is_docx_content(buf: bytes) -> bool:
    """zip 안에 word/document.xml 가 있는지까지 검사 (zip 이지만 docx 가
    아닌 경우를 거른다)."""
    if not is_docx_zip_magic(buf):
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(buf)) as zf:
            return "word/document.xml" in zf.namelist()
    except zipfile.BadZipFile:
        return False


# ── 미니 .docx 생성기 (테스트 픽스처용) ──────────────────────────────
def build_minimal_docx(
    *,
    paragraphs: Iterable[tuple[str, str | None]] = (),
    headings: Iterable[tuple[int, str]] = (),
    table: list[list[str]] | None = None,
    include_image: bytes | None = None,
    include_equation: bool = False,
) -> bytes:
    """테스트용으로 최소한의 .docx 구조를 in-memory 생성.

    paragraphs: [(text, style_id|None), ...]
    headings: [(level, text), ...]
    table: [[h1, h2], [c1, c2], ...] 첫 행이 header
    include_image: PNG 바이트 — 들어가면 단락 끝에 drawing 추가
    include_equation: True 면 단락 1개에 oMathPara 포함

    구조는 zipfile 로 직접 작성. python-docx 미설치 환경에서도 동작.
    """
    body_parts: list[str] = []

    for level, text in headings:
        body_parts.append(
            f'<w:p><w:pPr><w:pStyle w:val="Heading{level}"/></w:pPr>'
            f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
        )

    for text, style in paragraphs:
        ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        body_parts.append(
            f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
        )

    if table:
        rows_xml = []
        for row in table:
            cells_xml = "".join(
                f'<w:tc><w:p><w:r><w:t xml:space="preserve">{c}</w:t></w:r></w:p></w:tc>'
                for c in row
            )
            rows_xml.append(f"<w:tr>{cells_xml}</w:tr>")
        body_parts.append(f"<w:tbl>{''.join(rows_xml)}</w:tbl>")

    if include_image is not None:
        body_parts.append(
            '<w:p><w:r><w:drawing>'
            '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">'
            '<wp:extent cx="1905000" cy="1905000"/>'
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:blipFill><a:blip r:embed="rId100" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>'
            '</pic:blipFill>'
            '</pic:pic></a:graphicData></a:graphic></wp:inline>'
            '</w:drawing></w:r></w:p>'
        )

    if include_equation:
        body_parts.append(
            '<w:p><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">'
            '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num>'
            '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>'
            '</m:oMathPara></w:p>'
        )

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<w:body>{"".join(body_parts)}</w:body></w:document>'
    )

    rels_parts = [
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>',
    ]
    if include_image is not None:
        rels_parts.append(
            '<Relationship Id="rId100" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            'Target="media/image1.png"/>'
        )
    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{"".join(rels_parts)}</Relationships>'
    )

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )

    package_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/>'
        '</Relationships>'
    )

    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", package_rels)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/_rels/document.xml.rels", rels_xml)
        if include_image is not None:
            zf.writestr("word/media/image1.png", include_image)
    return out.getvalue()
