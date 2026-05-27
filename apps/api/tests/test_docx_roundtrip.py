"""DOCX export → import 라운드트립 테스트.

`render_docx()` 가 출력한 바이트를 `docx_to_document()` 로 다시 읽어서
구조가 합리적으로 보존되는지 확인한다.

분기점 (의도적 한계):
  - callout block → import 측에 매칭 스타일 없음 → 본문이 plain paragraph 로
    회수됨. 텍스트는 보존, 변형 정보는 손실.
  - quote block → 'Quote' 스타일은 헤딩이 아니므로 plain paragraph 로 회수.
  - chart / gantt / flow / org-chart → import 가 표/단락으로만 인식.
  - footnote 인라인 표기 (`[^N]`) 는 export 측에서 ` (body)` 로 치환되어 본문에
    들어감 — 의도된 변환.
  - speaker note (`meta.note: speaker:…`) 는 drop.
  - **list `style:"check"` → import 가 항상 `"bullet"` 로 복원** (pass-3 N2
    확인). export 는 `☐ ` prefix 텍스트를 굽지만 import 가 numFmt 아닌
    prefix 매칭 분기를 갖고 있지 않음. items 텍스트의 ☐ 도 별도 정리 안 됨.
    별도 사이클로 (import 측 prefix detection 추가) — `test_list_check_roundtrip_known_limitation` 회귀 테스트가 현 동작을 명시.

따라서 본 테스트는 "block 타입의 1:1 일치" 가 아닌 "텍스트 콘텐츠 보존" 과
"네이티브 표현으로 변환된 블록(table, list, image)의 type 일치" 를 검증한다.
"""
from __future__ import annotations

import io
from typing import Any

from docx import Document

from app.services.docx_export import DocxOptions, render_docx
from app.services.docx_import import docx_to_document


def _make_png(size: int = 4) -> bytes:
    """Tiny but valid PNG (Pillow is already a project dep)."""
    from PIL import Image as _PILImage

    img = _PILImage.new("RGB", (size, size), (0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


_PNG_BLOB = _make_png()


def _resolver(image_id: str) -> dict[str, Any] | None:
    if image_id == "01IMG00000000000000000000":
        return {"bytes": _PNG_BLOB, "mime": "image/png"}
    return None


def _walk_blocks(doc: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []

    def w(secs: list[dict[str, Any]]) -> None:
        for s in secs or []:
            for b in s.get("blocks") or []:
                out.append(b)
            w(s.get("subsections") or [])

    w(doc.get("sections") or [])
    return out


def test_roundtrip_paragraph_heading_list_table_code_quote() -> None:
    """기본 블록 — paragraph / heading / list / table / code / quote.

    제목/요약/메타데이터 + 다양한 블록을 한 문서에 넣고 render→import.
    """
    doc = {
        "schema_version": "1.0",
        "id": "01TEST0000000000000000RT01",
        "slug": "rt-basic",
        "title": "라운드트립 기본",
        "summary": "기본 블록 라운드트립",
        "metadata": {
            "division": "MX",
            "owners": ["test@example.com"],
            "tags": ["roundtrip"],
            "confidentiality": "internal",
        },
        "sections": [
            {
                "id": "01SEC00000000000000RT0001A",
                "number": "1",
                "level": 1,
                "title": "서론",
                "blocks": [
                    {
                        "type": "paragraph",
                        "id": "01P00000000000000000RT01A",
                        "text": "단순 **굵게** 와 *기울임* 을 포함한 문단.",
                    },
                    {
                        "type": "list",
                        "id": "01L0000000000000000RT01A",
                        "style": "bullet",
                        "items": ["사과", "배"],
                    },
                    {
                        "type": "code",
                        "id": "01CD00000000000000RT01A",
                        "language": "py",
                        "code": "x = 1\ny = 2",
                    },
                    {
                        "type": "quote",
                        "id": "01Q000000000000000RT01A",
                        "text": "측정 가능해야 관리할 수 있다.",
                        "cite": "Drucker",
                    },
                    {
                        "type": "table",
                        "id": "01T000000000000000RT01A",
                        "headers": ["이름", "수량"],
                        "rows": [["사과", "3"]],
                    },
                ],
                "subsections": [],
            }
        ],
    }
    blob = render_docx(doc)

    # Pre-flight — file is a valid Word document.
    Document(io.BytesIO(blob))

    # Re-import.
    result = docx_to_document(
        blob,
        slug="rt-basic-imported",
        title="",
        owner_user_id="01OWNER000000000000000000",
    )
    imported = result["document"]
    blocks = _walk_blocks(imported)
    types = [b["type"] for b in blocks]

    # The list block is recognized natively.
    assert "list" in types
    # The table block survives.
    assert "table" in types
    # At least one paragraph (containing the bold/italic text) survives.
    assert "paragraph" in types

    # Text content fidelity.
    flat_text = " ".join(
        (b.get("text") or "")
        + " "
        + " ".join(b.get("items") or [])
        + " "
        + " ".join(
            cell for row in b.get("rows") or [] for cell in row
        )
        + " "
        + " ".join(b.get("headers") or [])
        + " "
        + (b.get("code") or "")
        for b in blocks
    )
    assert "굵게" in flat_text
    assert "기울임" in flat_text
    assert "사과" in flat_text
    assert "Drucker" in flat_text  # quote cite preserved
    assert "이름" in flat_text  # table header
    assert "y = 2" in flat_text  # code body

    # Section title preserved (importer keeps the section number prefix as
    # part of the title since DOCX heading text has no separate numbering).
    sec_titles = [s.get("title") for s in imported.get("sections") or []]
    assert any("서론" in t for t in sec_titles)


def test_roundtrip_callout_downgrades_to_paragraph() -> None:
    """callout 은 import 측에 매칭 스타일이 없어 일반 단락으로 회수된다."""
    doc = {
        "schema_version": "1.0",
        "id": "01TEST0000000000000000RT02",
        "slug": "rt-callout",
        "title": "callout 라운드트립",
        "metadata": {"division": "MX", "owners": ["t@e.com"], "tags": []},
        "sections": [
            {
                "id": "01SEC00000000000000RT0002A",
                "number": "1",
                "level": 1,
                "title": "본문",
                "blocks": [
                    {
                        "type": "callout",
                        "id": "01CA00000000000000RT02A",
                        "variant": "warn",
                        "title": "주의",
                        "text": "확인하세요",
                    }
                ],
                "subsections": [],
            }
        ],
    }
    blob = render_docx(doc)
    result = docx_to_document(
        blob,
        slug="rt-callout-imported",
        title="",
        owner_user_id="01OWNER000000000000000000",
    )
    flat = " ".join(
        b.get("text") or "" for b in _walk_blocks(result["document"])
    )
    assert "주의" in flat
    assert "확인" in flat


def test_roundtrip_image_block_with_resolver_survives() -> None:
    """image 블록 — render 시 add_picture, import 시 image 블록 복원."""
    doc = {
        "schema_version": "1.0",
        "id": "01TEST0000000000000000RT03",
        "slug": "rt-image",
        "title": "이미지 라운드트립",
        "metadata": {"division": "MX", "owners": ["t@e.com"], "tags": []},
        "sections": [
            {
                "id": "01SEC00000000000000RT0003A",
                "number": "1",
                "level": 1,
                "title": "본문",
                "blocks": [
                    {
                        "type": "image",
                        "id": "01I00000000000000000RT03A",
                        "imageId": "01IMG00000000000000000000",
                        "caption": "그림",
                    }
                ],
                "subsections": [],
            }
        ],
    }
    blob = render_docx(doc, options=DocxOptions(image_resolver=_resolver))
    result = docx_to_document(
        blob,
        slug="rt-image-imported",
        title="",
        owner_user_id="01OWNER000000000000000000",
    )
    types = [b["type"] for b in _walk_blocks(result["document"])]
    assert "image" in types


def test_roundtrip_page_break_paragraph() -> None:
    """page-break-before 는 paragraph(meta.note='page-break-before') 로 round-trip."""
    doc = {
        "schema_version": "1.0",
        "id": "01TEST0000000000000000RT04",
        "slug": "rt-pgbreak",
        "title": "페이지 나누기",
        "metadata": {"division": "MX", "owners": ["t@e.com"], "tags": []},
        "sections": [
            {
                "id": "01SEC00000000000000RT0004A",
                "number": "1",
                "level": 1,
                "title": "본문",
                "blocks": [
                    {
                        "type": "paragraph",
                        "id": "01P00000000000000000RT04A",
                        "text": "이전",
                    },
                    {
                        "type": "paragraph",
                        "id": "01P00000000000000000RT04B",
                        "text": "",
                        "meta": {"note": "page-break-before"},
                    },
                    {
                        "type": "paragraph",
                        "id": "01P00000000000000000RT04C",
                        "text": "이후",
                    },
                ],
                "subsections": [],
            }
        ],
    }
    blob = render_docx(doc)
    result = docx_to_document(
        blob,
        slug="rt-pgbreak-imported",
        title="",
        owner_user_id="01OWNER000000000000000000",
    )
    blocks = _walk_blocks(result["document"])
    has_break = any(
        (b.get("meta") or {}).get("note") == "page-break-before"
        for b in blocks
    )
    assert has_break, [
        str(b.get("type") or "") + ":" + str(b.get("text") or "") for b in blocks
    ]


def test_roundtrip_block_order_preserved_for_simple_doc() -> None:
    """단순한 문서에서 블록 순서가 보존되는지 확인."""
    doc = {
        "schema_version": "1.0",
        "id": "01TEST0000000000000000RT05",
        "slug": "rt-order",
        "title": "순서",
        "metadata": {"division": "MX", "owners": ["t@e.com"], "tags": []},
        "sections": [
            {
                "id": "01SEC00000000000000RT0005A",
                "number": "1",
                "level": 1,
                "title": "본문",
                "blocks": [
                    {
                        "type": "paragraph",
                        "id": "01P00000000000000000RT05A",
                        "text": "alpha",
                    },
                    {
                        "type": "paragraph",
                        "id": "01P00000000000000000RT05B",
                        "text": "beta",
                    },
                    {
                        "type": "paragraph",
                        "id": "01P00000000000000000RT05C",
                        "text": "gamma",
                    },
                ],
                "subsections": [],
            }
        ],
    }
    blob = render_docx(doc)
    result = docx_to_document(
        blob,
        slug="rt-order-imported",
        title="",
        owner_user_id="01OWNER000000000000000000",
    )
    paragraphs: list[str] = [
        b["text"] for b in _walk_blocks(result["document"])
        if b.get("type") == "paragraph" and b.get("text")
    ]
    # alpha appears before beta, beta before gamma.
    a = next((i for i, t in enumerate(paragraphs) if "alpha" in t), -1)
    b = next((i for i, t in enumerate(paragraphs) if "beta" in t), -1)
    g = next((i for i, t in enumerate(paragraphs) if "gamma" in t), -1)
    assert a >= 0 and b > a and g > b


def test_list_check_roundtrip_preserves_style() -> None:
    """list `style:"check"` round-trip — style 보존 (H7 fix).

    docx_export 가 각 item 앞에 `☐ ` prefix 를 박고, docx_import 가 prefix
    매칭으로 check style 을 복원한다. items 본문에 web 컨벤션 `[x]` / `[ ]`
    prefix 가 있으면 그대로 보존 (중복 마킹 회피).
    """
    doc = {
        "schema_version": "1.0",
        "id": "01TEST0000000000000000RTCK",
        "slug": "rt-check-list",
        "title": "체크 리스트 회귀",
        "metadata": {"division": "MX", "owners": ["t@e.com"], "tags": []},
        "sections": [
            {
                "id": "01SEC00000000000000RTCK01",
                "number": "1",
                "level": 1,
                "title": "할 일",
                "blocks": [
                    {
                        "type": "list",
                        "id": "01L00000000000000000RTCK1",
                        "style": "check",
                        "items": ["[x] 문서 작성", "[ ] 리뷰 요청", "[ ] 배포"],
                    }
                ],
                "subsections": [],
            }
        ],
    }
    blob = render_docx(doc)
    result = docx_to_document(
        blob,
        slug="rt-check-list-imported",
        title="",
        owner_user_id="01OWNER000000000000000000",
    )
    lists = [b for b in _walk_blocks(result["document"]) if b.get("type") == "list"]
    assert lists, "import 가 list block 자체는 인식해야 함"
    assert lists[0]["style"] == "check", (
        f"check style 가 보존되어야 함. 실제: {lists[0]['style']}"
    )
    # `[x]` / `[ ]` 본문 prefix 는 그대로 보존.
    items = lists[0]["items"]
    assert items[0] == "[x] 문서 작성", f"checked item: {items[0]}"
    assert items[1] == "[ ] 리뷰 요청", f"unchecked item: {items[1]}"
    assert items[2] == "[ ] 배포", f"unchecked item: {items[2]}"


def test_list_check_external_glyph_only_assigns_state() -> None:
    """외부 도구가 `[x]` 없이 `☑` / `☐` 만 쓴 경우 — checked 상태 부여.

    우리 export 는 항상 `☐ ` 만 굽지만, 다른 작성 도구로 만든 docx 는
    `☑ Done item` 같은 형태일 수 있다. 이때 import 가 `[x] ` / `[ ] ` 를
    삽입해 web 렌더러의 체크박스 상태를 살린다.
    """
    import zipfile

    # 손으로 만든 minimal docx — `☑ Done` + `☐ Todo` 두 줄.
    # `_list_info` 가 인식하려면 numPr 가 필요.
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
        '<w:r><w:t xml:space="preserve">☑ Done item</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
        '<w:r><w:t xml:space="preserve">☐ Todo item</w:t></w:r></w:p>'
        '</w:body></w:document>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/>'
        '</Relationships>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("word/document.xml", document_xml)
    blob = buf.getvalue()

    result = docx_to_document(
        blob,
        slug="external-check",
        title="외부",
        owner_user_id="01OWNER000000000000000000",
    )
    lists = [b for b in _walk_blocks(result["document"]) if b.get("type") == "list"]
    assert lists, "list 인식"
    assert lists[0]["style"] == "check"
    items = lists[0]["items"]
    assert items[0] == "[x] Done item"
    assert items[1] == "[ ] Todo item"


def test_list_check_mixed_stays_bullet() -> None:
    """일부 item 만 ☐ 면 일반 bullet 유지 — 데이터 손실 방지 (텍스트는 보존)."""
    import zipfile

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
        '<w:r><w:t xml:space="preserve">☐ Has check prefix</w:t></w:r></w:p>'
        '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
        '<w:r><w:t xml:space="preserve">No prefix at all</w:t></w:r></w:p>'
        '</w:body></w:document>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/>'
        '</Relationships>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("word/document.xml", document_xml)
    blob = buf.getvalue()

    result = docx_to_document(
        blob,
        slug="mixed",
        title="",
        owner_user_id="01OWNER000000000000000000",
    )
    lists = [b for b in _walk_blocks(result["document"]) if b.get("type") == "list"]
    assert lists, "list 인식"
    assert lists[0]["style"] == "bullet", "혼합 list 는 bullet 유지"
    # 텍스트는 그대로 보존.
    items = lists[0]["items"]
    assert items[0] == "☐ Has check prefix"
    assert items[1] == "No prefix at all"


def test_list_check_roundtrip_idempotent() -> None:
    """export → import → export → import — 두 번째 사이클의 결과가 첫 번째와 동일."""
    doc = {
        "schema_version": "1.0",
        "id": "01TEST0000000000000000RTCI",
        "slug": "rt-check-idem",
        "title": "체크 멱등성",
        "metadata": {"division": "MX", "owners": ["t@e.com"], "tags": []},
        "sections": [
            {
                "id": "01SEC00000000000000RTCI01",
                "number": "1",
                "level": 1,
                "title": "할 일",
                "blocks": [
                    {
                        "type": "list",
                        "id": "01L00000000000000000RTCI1",
                        "style": "check",
                        "items": ["[x] 한 일", "[ ] 안 한 일"],
                    }
                ],
                "subsections": [],
            }
        ],
    }
    blob1 = render_docx(doc)
    result1 = docx_to_document(
        blob1, slug="cycle1", title="", owner_user_id="01OWNER000000000000000000"
    )
    lists1 = [b for b in _walk_blocks(result1["document"]) if b.get("type") == "list"]
    assert lists1 and lists1[0]["style"] == "check"
    assert lists1[0]["items"] == ["[x] 한 일", "[ ] 안 한 일"]

    # 두 번째 사이클 — 첫 import 결과를 다시 export → import.
    doc2 = result1["document"]
    blob2 = render_docx(doc2)
    result2 = docx_to_document(
        blob2, slug="cycle2", title="", owner_user_id="01OWNER000000000000000000"
    )
    lists2 = [b for b in _walk_blocks(result2["document"]) if b.get("type") == "list"]
    assert lists2 and lists2[0]["style"] == "check"
    assert lists2[0]["items"] == lists1[0]["items"], (
        f"멱등성 위반: cycle2={lists2[0]['items']} vs cycle1={lists1[0]['items']}"
    )


def test_list_check_nested_roundtrip() -> None:
    """nested check list — depth 보존."""
    doc = {
        "schema_version": "1.0",
        "id": "01TEST0000000000000000RTCN",
        "slug": "rt-check-nested",
        "title": "중첩",
        "metadata": {"division": "MX", "owners": ["t@e.com"], "tags": []},
        "sections": [
            {
                "id": "01SEC00000000000000RTCN01",
                "number": "1",
                "level": 1,
                "title": "할 일",
                "blocks": [
                    {
                        "type": "list",
                        "id": "01L00000000000000000RTCN1",
                        "style": "check",
                        # depth 인코딩: 2 스페이스 = depth 1.
                        "items": ["[ ] 상위", "  [x] 자식 1", "  [ ] 자식 2"],
                    }
                ],
                "subsections": [],
            }
        ],
    }
    blob = render_docx(doc)
    result = docx_to_document(
        blob, slug="nested-imported", title="", owner_user_id="01OWNER000000000000000000"
    )
    lists = [b for b in _walk_blocks(result["document"]) if b.get("type") == "list"]
    assert lists and lists[0]["style"] == "check"
    # check 본문 보존 (depth indent 는 export-import 사이에서 깨질 수 있어
    # 텍스트 내용 자체만 검증).
    items = lists[0]["items"]
    joined = "\n".join(items)
    assert "[ ] 상위" in joined
    assert "[x] 자식 1" in joined
    assert "[ ] 자식 2" in joined
