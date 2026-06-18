"""PDF → DocumentJSON v1.0 (PyMuPDF / fitz).

docx/pptx/xlsx import 와 같은 계약: ``{document, summary}`` 반환. PDF 는
구조 정보(섹션/표/스타일)가 약하므로 휴리스틱에 의존한다 — 본문 폰트
크기를 추정해 그보다 큰 텍스트를 heading 으로, ``page.find_tables()`` 로
표를, dotted-prefix("2.1 Foo") 단락을 섹션으로 승격한다. 정확도는 원본
PDF 의 구조 품질에 비례하며, 한계는 ``summary.warnings`` 에 기록한다.

이미지는 기본적으로 placeholder ImageBlock + warning 으로 둔다 (docx 의
이미지 소실 fallback 과 동일) — 실제 MinIO 업로드는 라우터가 image_uploader
를 주입할 때만. 본문 walk 후 docx/pptx/xlsx 와 동일하게 widget post-pass
를 태운다.
"""
from __future__ import annotations

import re
from typing import Any, Callable

import ulid

from .docx_import import ImportSummary

# heading 판정: 본문 추정 폰트 대비 이 배수 이상이면 heading 후보.
_HEADING_FONT_RATIO = 1.15
# dotted-prefix 섹션 승격용 ("2.1 Foo", "3.2.1 Bar"). docx 의 동일 개념.
_DOTTED_RE = re.compile(r"^\s*(\d+(?:\.\d+){0,5})\.?\s+\S")
# heading 으로 보기엔 너무 긴 텍스트 (실제로는 본문 한 줄) 컷.
_HEADING_MAX_LEN = 120


def _new_id() -> str:
    return str(ulid.new())


def is_pdf_magic(buf: bytes) -> bool:
    """``%PDF-`` 시작 바이트 확인 (선두 1KB 안 — 일부 PDF 는 BOM/공백 선행)."""
    head = buf[:1024]
    return b"%PDF-" in head


def _settings_default_division() -> str:
    from app.core.config import get_settings

    return get_settings().import_default_division


def _settings_default_confidentiality() -> str:
    from app.core.config import get_settings

    return get_settings().import_default_confidentiality


def _dotted_depth(text: str) -> int:
    """"2.1 Foo" → 2, "3.2.1 Bar" → 3. 매치 안 되면 0."""
    m = _DOTTED_RE.match(text)
    if not m:
        return 0
    return m.group(1).count(".") + 1


def _para_block(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "id": _new_id(), "text": text}


def _heading_block(text: str, level: int) -> dict[str, Any]:
    # DocumentJSON 의 섹션 트리는 sections[] 로 표현 — 본문 중 heading 은
    # 섹션 경계로 쓰고, 섹션 title 로 surface 한다 (별도 heading 블록 대신).
    return {"id": _new_id(), "level": max(1, min(level, 6)), "title": text[:200], "blocks": []}


def _estimate_body_size(doc: Any) -> float:
    """문서 전체 span 폰트 크기의 최빈값 근사 → 본문 크기. 가장 흔한 크기를
    본문으로 본다 (히스토그램 최댓값)."""
    from collections import Counter

    counter: Counter[float] = Counter()
    for page in doc:
        d = page.get_text("dict")
        for block in d.get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    size = round(float(span.get("size", 0)), 1)
                    text = span.get("text", "").strip()
                    if size > 0 and text:
                        counter[size] += len(text)
    if not counter:
        return 11.0
    return counter.most_common(1)[0][0]


def extract_pdf_image(doc: Any, xref: int) -> tuple[bytes, str] | None:
    """PDF 의 xref 이미지를 *원본 임베드 바이트* 로 추출 → (bytes, ext).

    ``doc.extract_image`` 은 PDF 에 저장된 그대로의 바이트를 돌려주므로
    결정적이다 (Pixmap 래스터화는 colorspace/alpha 에 따라 바이트가 달라져
    sha 가 흔들린다). 라우터의 사전 업로드와 본 변환이 **동일 helper** 를 써야
    같은 sha 로 매핑되므로 단일 진입점으로 둔다. 실패/빈 결과는 None.
    """
    try:
        info = doc.extract_image(xref)
    except Exception:  # noqa: BLE001
        return None
    data = info.get("image") if isinstance(info, dict) else None
    ext = (info.get("ext") if isinstance(info, dict) else None) or "png"
    if not data:
        return None
    return data, ext


def _table_block_from_fitz(tbl: Any) -> dict[str, Any] | None:
    """fitz find_tables() 의 한 표 → TableBlock. 빈 표는 None."""
    try:
        data = tbl.extract()
    except Exception:  # noqa: BLE001
        return None
    rows = [[("" if c is None else str(c)).strip() for c in row] for row in (data or [])]
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return None
    return {
        "type": "table",
        "id": _new_id(),
        "headers": rows[0],
        "rows": rows[1:],
    }


def pdf_to_document(
    buf: bytes,
    *,
    slug: str,
    title: str = "",
    owner_user_id: str | None = None,
    image_uploader: Callable[[bytes, str], dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    """Top-level entry point — .pdf 바이트를 DocumentJSON 으로."""
    if not is_pdf_magic(buf):
        raise ValueError("not a valid PDF (missing %PDF- signature)")

    import fitz  # PyMuPDF

    try:
        doc = fitz.open(stream=buf, filetype="pdf")
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"PDF 를 열 수 없습니다: {e}") from e

    summary = ImportSummary()
    body_size = _estimate_body_size(doc)
    heading_threshold = body_size * _HEADING_FONT_RATIO

    sections: list[dict[str, Any]] = []
    # 첫 섹션 (heading 전 본문 수용)
    current = {"id": _new_id(), "level": 1, "title": title.strip() or "본문", "blocks": []}
    sections.append(current)
    n_images = 0

    for page in doc:
        # 1) 표 먼저 추출 (find_tables) — 표 영역 텍스트가 문단으로 중복되는
        #    것은 PDF 특성상 일부 발생 가능 (휴리스틱 한계로 warning).
        try:
            tables = page.find_tables()
            table_list = list(getattr(tables, "tables", []) or [])
        except Exception:  # noqa: BLE001
            table_list = []
        for tbl in table_list:
            tb = _table_block_from_fitz(tbl)
            if tb is not None:
                current["blocks"].append(tb)
                summary.tables += 1

        # 2) 텍스트 블록 → heading / paragraph
        d = page.get_text("dict")
        for block in d.get("blocks", []):
            lines = block.get("lines", [])
            if not lines:
                continue
            # 블록의 라인들을 하나의 문단 텍스트로 병합 + 최대 폰트 크기 추적
            parts: list[str] = []
            max_size = 0.0
            for line in lines:
                spans = line.get("spans", [])
                line_text = "".join(s.get("text", "") for s in spans).strip()
                if line_text:
                    parts.append(line_text)
                for s in spans:
                    max_size = max(max_size, float(s.get("size", 0)))
            text = " ".join(parts).strip()
            if not text:
                continue

            depth = _dotted_depth(text)
            is_heading = (
                (max_size >= heading_threshold and len(text) <= _HEADING_MAX_LEN)
                or depth > 0
            )
            if is_heading:
                level = depth if depth > 0 else 1
                current = _heading_block(text, level)
                sections.append(current)
                summary.headings += 1
            else:
                current["blocks"].append(_para_block(text))
                summary.paragraphs += 1

        # 3) 이미지 — image_uploader 가 sha 로 실제 image_id 를 돌려주면 연결,
        #    아니면 (소실/미구성) placeholder + warning.
        try:
            imgs = page.get_images(full=True)
        except Exception:  # noqa: BLE001
            imgs = []
        n_placeholder = 0
        for img in imgs:
            n_images += 1
            xref = img[0]
            image_id: str | None = None
            if image_uploader is not None:
                extracted = extract_pdf_image(doc, xref)
                if extracted is not None:
                    data, ext = extracted
                    res = image_uploader(data, f"pdf-{xref}.{ext}")
                    if res:
                        image_id = res.get("image_id")
            if image_id is None:
                n_placeholder += 1
            block = {
                "type": "image",
                "id": _new_id(),
                "imageId": image_id or _new_id(),
                "alt": "",
            }
            current["blocks"].append(block)
            summary.images += 1
        if n_placeholder:
            summary.warnings.append(
                f"이미지 {n_placeholder}장은 placeholder 로 삽입됨 "
                "(추출 실패 또는 업로드 미구성) — 에디터에서 다시 연결 필요"
            )

    # 빈 섹션 (heading 만 있고 본문 없음) 정리는 하지 않음 — 구조 보존.
    summary.warnings.append(
        "PDF 는 휴리스틱 변환입니다 (폰트 크기→heading, find_tables→표). "
        "원본 구조가 명확할수록 정확합니다."
    )

    # Widget post-pass — docx/pptx/xlsx 와 동일.
    from . import widget_markers as _wm

    _wm.apply_widget_markers(sections, summary)
    _wm.apply_widget_autodetect(sections, summary)

    metadata: dict[str, Any] = {
        "division": _settings_default_division(),
        "owners": [owner_user_id] if owner_user_id else [],
        "tags": [],
        "confidentiality": _settings_default_confidentiality(),
    }
    docjson: dict[str, Any] = {
        "schema_version": "1.0",
        "id": str(ulid.new()),
        "slug": slug,
        "title": (title.strip() or "Untitled")[:200],
        "metadata": metadata,
        "infobox": {},
        "sections": sections,
    }
    return {"document": docjson, "summary": summary}
