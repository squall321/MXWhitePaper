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
    warnings: list[str] = field(default_factory=list)


@dataclass
class _ImportContext:
    """파싱 진행 중 공유되는 mutable state."""
    relationships: dict[str, str]
    media: dict[str, bytes]
    image_uploader: Any  # callable(bytes, filename) -> dict | None
    summary: ImportSummary
    footnotes_xml: bytes | None = None


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


def _format_run(run: ET.Element) -> str:
    text = _run_text(run)
    if not text:
        return ""
    props = _run_props(run)
    return _wrap_format(
        text,
        bold=props.get("bold", False),
        italic=props.get("italic", False),
        strike=props.get("strike", False),
        underline=props.get("underline", False),
    )


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
                label_runs.append(_format_run(run))
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
                    inner_parts.append(_format_run(run))
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
                parts.append(_format_run(ch))
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

    summary = ImportSummary()
    ctx = _ImportContext(
        relationships=relationships,
        media=media,
        image_uploader=image_uploader,
        summary=summary,
        footnotes_xml=footnotes_xml,
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
    """w:tbl → TableBlock dict."""
    rows_raw: list[list[str]] = []
    for tr in tbl.findall(_q("w", "tr")):
        row = [_table_cell_text(tc, ctx) for tc in tr.findall(_q("w", "tc"))]
        rows_raw.append(row)
    if not rows_raw:
        return {
            "type": "table",
            "id": _new_id(),
            "headers": [],
            "rows": [],
        }
    headers = rows_raw[0]
    rows = rows_raw[1:]
    return {
        "type": "table",
        "id": _new_id(),
        "headers": headers,
        "rows": rows,
    }


def _build_footnotes_section(
    footnotes_xml: bytes, ctx: _ImportContext
) -> dict[str, Any] | None:
    """word/footnotes.xml → 각주 level-1 section. 없거나 빈 footnote 만 있으면 None."""
    try:
        root = ET.fromstring(footnotes_xml)
    except ET.ParseError:
        return None
    blocks: list[dict[str, Any]] = []
    idx = 0
    for fn in root.findall(_q("w", "footnote")):
        fn_type = fn.get(_q("w", "type"))
        # separator/continuationSeparator/continuationNotice 제외
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
        blocks.append({
            "type": "paragraph",
            "id": _new_id(),
            "text": f"[{idx}] {joined}",
        })
        ctx.summary.footnotes += 1
    if not blocks:
        return None
    return {
        "id": _new_id(),
        "level": 1,
        "title": "각주",
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
