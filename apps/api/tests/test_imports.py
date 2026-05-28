"""POST /imports/docx 단위 테스트.

Fixture .docx 는 `docx_import.build_minimal_docx()` 로 매 테스트마다 in-memory
생성한다 (커밋된 바이너리 없음). 시나리오:
  - happy path: heading + 단락 + 표 + 이미지 + 수식 모두 포함된 docx 가져오기
  - oversize → 422
  - non-docx 확장자 → 422
  - zip 이지만 word/document.xml 없음 → 422
  - non-zip (random bytes) → 422
  - rate-limit (5/min) → 429
"""
from __future__ import annotations

import io
from collections.abc import Iterator
from struct import pack
from zlib import compress

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.routers import imports as imports_mod
from app.services import docx_import


# ── Helpers: minimal PNG bytes (1×1 transparent) ─────────────────────
def _tiny_png() -> bytes:
    # 8-byte signature
    sig = b"\x89PNG\r\n\x1a\n"

    def _chunk(name: bytes, data: bytes) -> bytes:
        from binascii import crc32
        return pack(">I", len(data)) + name + data + pack(">I", crc32(name + data))

    ihdr = pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)  # 1x1 RGBA
    raw = b"\x00" + b"\x00\x00\x00\x00"  # filter byte + 1 RGBA pixel
    idat = compress(raw)
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> Iterator[None]:
    imports_mod._reset_rate_limit_for_tests()
    yield
    imports_mod._reset_rate_limit_for_tests()


# ── Direct unit tests on docx_import (no HTTP) ───────────────────────
def test_omml_to_latex_fraction() -> None:
    docx = docx_import.build_minimal_docx(include_equation=True)
    result = docx_import.docx_to_document(
        docx, slug="t", title="t", owner_user_id="u"
    )
    doc = result["document"]
    blocks = doc["sections"][0]["blocks"]
    math_blocks = [b for b in blocks if b["type"] == "math"]
    assert len(math_blocks) == 1
    assert "\\frac" in math_blocks[0]["expression"]


def test_zip_magic_byte_detection() -> None:
    # PK\x03\x04 만 OK, 다른 4바이트는 reject
    assert docx_import.is_docx_zip_magic(b"PK\x03\x04abcd") is True
    assert docx_import.is_docx_zip_magic(b"abcd") is False
    assert docx_import.is_docx_zip_magic(b"") is False


def test_is_docx_content_rejects_zip_without_document_xml() -> None:
    import zipfile

    # zip 이지만 docx 가 아닌 케이스
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        zf.writestr("hello.txt", "world")
    raw = out.getvalue()
    assert docx_import.is_docx_zip_magic(raw) is True
    assert docx_import.is_docx_content(raw) is False


def test_heading_stack_creates_nested_sections() -> None:
    docx = docx_import.build_minimal_docx(
        headings=[(1, "Top"), (2, "Mid"), (3, "Leaf")],
        paragraphs=[("body inside leaf", None)],
    )
    result = docx_import.docx_to_document(
        docx, slug="t", title="", owner_user_id="u"
    )
    doc = result["document"]
    s1 = doc["sections"][0]
    assert s1["title"] == "Top"
    s2 = s1["subsections"][0]
    assert s2["title"] == "Mid"
    s3 = s2["subsections"][0]
    assert s3["title"] == "Leaf"
    assert s3["blocks"][0]["text"] == "body inside leaf"


def test_dotted_numbering_promotes_section_depth() -> None:
    """Heading-1 styled "3.1.2.3 Foo" should land at depth 4 (heading-4 block)
    even though Word's style alone says level 1, because the dotted prefix
    is the strongest hierarchy signal authors give us."""
    docx = docx_import.build_minimal_docx(
        headings=[
            (1, "1 Overview"),
            (1, "1.1 Background"),
            (1, "1.1.1 Detail"),
            (1, "1.1.1.1 Deep"),
        ],
    )
    result = docx_import.docx_to_document(
        docx, slug="t", title="", owner_user_id="u"
    )
    sections = result["document"]["sections"]
    # Top-level only contains "Overview"; deeper headings nest under it.
    assert len(sections) == 1
    assert sections[0]["title"] == "Overview"
    s2 = sections[0]["subsections"][0]
    assert s2["level"] == 2 and s2["title"] == "Background"
    s3 = s2["subsections"][0]
    assert s3["level"] == 3 and s3["title"] == "Detail"
    # depth-4 collapses into a heading-4 block at s3.
    blocks = s3["blocks"]
    assert any(
        b.get("type") == "heading-4" and b.get("title") == "Deep" for b in blocks
    )


def test_unstyled_dotted_heading_detected_as_section() -> None:
    """A plain (Normal-styled) paragraph that *reads* like "2.1 Foo" should
    still be promoted to a level-2 section. Authors frequently paste
    headings without applying Heading styles."""
    docx = docx_import.build_minimal_docx(
        headings=[(1, "Top")],
        paragraphs=[
            ("2.1 Plain section", None),
            ("내용 단락", None),
        ],
    )
    result = docx_import.docx_to_document(
        docx, slug="t", title="", owner_user_id="u"
    )
    s1 = result["document"]["sections"][0]
    s2 = s1["subsections"][0]
    assert s2["level"] == 2
    assert s2["title"] == "Plain section"
    assert s2["blocks"][0]["text"] == "내용 단락"


def test_caption_pattern_without_style_attaches_to_table() -> None:
    """When the caption paragraph lacks Word's `Caption` style but reads
    like "표 1: …", the importer should still attach it to the preceding
    table."""
    docx = docx_import.build_minimal_docx(
        headings=[(1, "T")],
        table=[["분기", "매출"], ["Q1", "100"]],
        # Caption paragraph AFTER the table, no style applied.
        paragraphs=[("표 1: 분기별 매출 요약", None)],
    )
    result = docx_import.docx_to_document(
        docx, slug="t", title="", owner_user_id="u"
    )
    blocks = result["document"]["sections"][0]["blocks"]
    table_blocks = [b for b in blocks if b["type"] == "table"]
    assert len(table_blocks) == 1
    assert table_blocks[0].get("caption") == "분기별 매출 요약"
    # The caption paragraph must NOT also surface as a standalone paragraph.
    paragraph_texts = [b.get("text", "") for b in blocks if b["type"] == "paragraph"]
    assert not any("표 1" in t for t in paragraph_texts)


def test_table_with_caption_uses_meta_note() -> None:
    docx = docx_import.build_minimal_docx(
        headings=[(1, "T")],
        paragraphs=[("표 1: 매출 요약", "Caption")],
        table=[["분기", "매출"], ["Q1", "100"]],
    )
    result = docx_import.docx_to_document(
        docx, slug="t", title="", owner_user_id="u"
    )
    doc = result["document"]
    blocks = doc["sections"][0]["blocks"]
    table_blocks = [b for b in blocks if b["type"] == "table"]
    assert len(table_blocks) == 1
    tb = table_blocks[0]
    assert tb["headers"] == ["분기", "매출"]
    assert tb["rows"] == [["Q1", "100"]]
    assert (tb.get("meta") or {}).get("note") == "표 1: 매출 요약"


def test_caption_pattern_requires_separator_not_prose() -> None:
    """L9 regression — "Figure 1 shows our results" 같은 본문이 직전 표/
    이미지의 caption 으로 잘못 슬립되지 않는다. 표 직후 단락이라도 separator
    (':', '.', '-', ')') 없이 trailing prose 가 따라오면 일반 paragraph 로
    유지."""
    docx = docx_import.build_minimal_docx(
        headings=[(1, "T")],
        table=[["분기", "매출"], ["Q1", "100"]],
        paragraphs=[("Figure 1 shows our quarterly results in detail.", None)],
    )
    result = docx_import.docx_to_document(
        docx, slug="t", title="", owner_user_id="u"
    )
    blocks = result["document"]["sections"][0]["blocks"]
    table_blocks = [b for b in blocks if b["type"] == "table"]
    paragraph_blocks = [b for b in blocks if b["type"] == "paragraph"]
    assert len(table_blocks) == 1
    # caption 으로 슬립되면 안 됨.
    assert "caption" not in table_blocks[0]
    # 본문 단락으로 살아 있어야 함.
    assert any(
        "Figure 1 shows" in (b.get("text") or "") for b in paragraph_blocks
    )


def test_caption_pattern_with_separator_still_attaches() -> None:
    """L9 regression — separator (`:`, `.`, `-`, `)`) 가 있으면 여전히
    caption 으로 attached. 기존 동작 회귀 가드."""
    # 다양한 separator variant.
    for cap_text, expected_clean in [
        ("Figure 1: 분기별 매출 요약", "분기별 매출 요약"),
        ("Figure 1. Quarterly summary", "Quarterly summary"),
        ("그림 1 - 추세 그래프", "추세 그래프"),
    ]:
        docx = docx_import.build_minimal_docx(
            headings=[(1, "T")],
            table=[["분기", "매출"], ["Q1", "100"]],
            paragraphs=[(cap_text, None)],
        )
        result = docx_import.docx_to_document(
            docx, slug="t", title="", owner_user_id="u"
        )
        blocks = result["document"]["sections"][0]["blocks"]
        table_blocks = [b for b in blocks if b["type"] == "table"]
        assert len(table_blocks) == 1, cap_text
        assert table_blocks[0].get("caption") == expected_clean, cap_text


# ── HTTP-level tests ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_import_docx_happy_path() -> None:
    docx = docx_import.build_minimal_docx(
        headings=[(1, "보고서"), (2, "요약")],
        paragraphs=[
            ("이번 분기 결산입니다.", None),
            ("그림 1: 추세", "Caption"),
        ],
        table=[["A", "B"], ["1", "2"]],
        include_image=_tiny_png(),
        include_equation=True,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx",
            files={"file": ("report.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            data={"slug": "test-report", "title": "테스트 보고서"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["error"] is None
    data = body["data"]
    doc = data["document"]
    summary = data["summary"]
    assert doc["slug"] == "test-report"
    assert doc["title"] == "테스트 보고서"
    # 통계 검증
    assert summary["headings"] >= 2
    assert summary["tables"] == 1
    assert summary["images"] == 1
    assert summary["equations"] >= 1


@pytest.mark.asyncio
async def test_import_docx_rejects_oversize() -> None:
    # 31 MB 의 가짜 zip — 헤더만 PK 로 시작해도 사이즈 체크가 먼저 거부.
    huge = b"PK\x03\x04" + b"\x00" * (imports_mod._docx_max_bytes() + 10)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx",
            files={"file": ("big.docx", huge, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_import_docx_rejects_non_docx_extension() -> None:
    docx = docx_import.build_minimal_docx(paragraphs=[("hi", None)])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx",
            files={"file": ("hello.txt", docx, "text/plain")},
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_import_docx_rejects_non_zip_bytes() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx",
            files={"file": ("bogus.docx", b"random bytes that are not zip", "application/octet-stream")},
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_import_docx_rejects_zip_without_document_xml() -> None:
    import zipfile
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        zf.writestr("hello.txt", "world")
    raw = out.getvalue()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx",
            files={"file": ("fake.docx", raw, "application/octet-stream")},
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_import_docx_rate_limit() -> None:
    docx = docx_import.build_minimal_docx(paragraphs=[("hi", None)])
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 5 번 성공 → 6 번째 429
        for _ in range(5):
            r = await ac.post(
                "/api/v1/imports/docx",
                files={"file": ("a.docx", docx, "application/octet-stream")},
            )
            assert r.status_code == 200, r.text
        r = await ac.post(
            "/api/v1/imports/docx",
            files={"file": ("a.docx", docx, "application/octet-stream")},
        )
    assert r.status_code == 429, r.text
    assert r.json()["error"]["code"] == "RATE_LIMITED"


@pytest.mark.asyncio
async def test_import_docx_derives_slug_from_filename() -> None:
    docx = docx_import.build_minimal_docx(
        headings=[(1, "Title from heading")],
        paragraphs=[("body", None)],
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx",
            files={"file": ("My Report (2026).docx", docx, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    doc = body["data"]["document"]
    # 'My Report (2026).docx' → 'my-report-2026'
    assert doc["slug"].startswith("my-report")
    # title override 없음 → 첫 헤딩이 사용됨
    assert doc["title"] == "Title from heading"


# ── M3 / M4 / M5: Import hardening ───────────────────────────────────
def _docx_with_extras(
    *,
    body_xml_extras: str = "",
    extra_parts: dict[str, str] | None = None,
    extra_rels: str = "",
    extra_overrides: str = "",
) -> bytes:
    """Build a minimal .docx with surgical extensions for hardening tests.

    Lets a test drop arbitrary body XML, extra zip parts (header/footer),
    extra relationship XML, and Content-Types overrides without bloating
    build_minimal_docx for one-off scenarios.
    """
    import zipfile

    extra_parts = extra_parts or {}
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        f'<w:body>{body_xml_extras}</w:body></w:document>'
    )
    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
        f'{extra_rels}'
        '</Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>'
        '<Default Extension="svg" ContentType="image/svg+xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        f'{extra_overrides}'
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
        for path, payload in extra_parts.items():
            zf.writestr(path, payload)
    return out.getvalue()


# M3 — SVG 이미지가 zip 안에 있으면 summary.warnings 에 SVG 경고가 떨어진다.
@pytest.mark.asyncio
async def test_import_docx_svg_image_emits_warning() -> None:
    # 가짜 SVG 1장을 word/media/ 에 넣음 — 본문은 단순 단락 1개.
    body = '<w:p><w:r><w:t xml:space="preserve">hi</w:t></w:r></w:p>'
    svg_bytes = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
    docx = _docx_with_extras(
        body_xml_extras=body,
        extra_parts={"word/media/icon1.svg": svg_bytes.decode("ascii")},
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx",
            files={"file": ("svg-doc.docx", docx, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    summary = r.json()["data"]["summary"]
    warnings = summary["warnings"]
    assert any("SVG" in w and "icon1.svg" in w for w in warnings), warnings


# M4 — 셀 안에 nested <w:tbl> 가 들어있으면 텍스트 평탄화로 보존.
def test_nested_table_in_cell_flattened_to_paragraphs() -> None:
    # 외부 1×1 표, 그 셀 안에 nested 2-row × 2-col 표.
    nested_tbl = (
        '<w:tbl>'
        '<w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>'
        '<w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>'
        '<w:tr><w:tc><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc>'
        '<w:tc><w:p><w:r><w:t>D</w:t></w:r></w:p></w:tc></w:tr>'
        '</w:tbl>'
    )
    body = (
        '<w:tbl><w:tr><w:tc>'
        '<w:p><w:r><w:t>before</w:t></w:r></w:p>'
        f'{nested_tbl}'
        '<w:p><w:r><w:t>after</w:t></w:r></w:p>'
        '</w:tc></w:tr></w:tbl>'
    )
    docx = _docx_with_extras(body_xml_extras=body)
    result = docx_import.docx_to_document(
        docx, slug="nt", title="nt", owner_user_id="u"
    )
    doc = result["document"]
    summary = result["summary"]
    # 외부 표 1개
    blocks = doc["sections"][0]["blocks"]
    table_blocks = [b for b in blocks if b["type"] == "table"]
    assert len(table_blocks) == 1
    tb = table_blocks[0]
    # 외부 셀이 blocks 모드 (sparse) — nested table 이 mixed-content 강제.
    cell0 = tb["cells"][0]
    cell_blocks = cell0["blocks"]
    texts = [b.get("text", "") for b in cell_blocks if b["type"] == "paragraph"]
    # before / nested A | B / nested C | D / after 순서대로 들어옴.
    assert texts == ["before", "A | B", "C | D", "after"]
    # 경고가 들어가야 사용자가 인지 가능.
    assert any("nested table flattened" in w for w in summary.warnings), summary.warnings


# M5 — header/footer xml 이 있으면 첫 섹션 최상단에 CalloutBlock 1개.
def test_header_footer_extracted_to_callout() -> None:
    header_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:p><w:r><w:t>회사 비밀 — 외부 유출 금지</w:t></w:r></w:p></w:hdr>'
    )
    footer_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:p><w:r><w:t>Page 1 of 1</w:t></w:r></w:p></w:ftr>'
    )
    body = (
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
        '<w:r><w:t>본문 시작</w:t></w:r></w:p>'
        '<w:p><w:r><w:t>본문 단락</w:t></w:r></w:p>'
    )
    docx = _docx_with_extras(
        body_xml_extras=body,
        extra_parts={
            "word/header1.xml": header_xml,
            "word/footer1.xml": footer_xml,
        },
    )
    result = docx_import.docx_to_document(
        docx, slug="hf", title="hf", owner_user_id="u"
    )
    doc = result["document"]
    first_section = doc["sections"][0]
    first_block = first_section["blocks"][0]
    assert first_block["type"] == "callout"
    assert first_block["variant"] == "info"
    assert first_block["title"] == "문서 상단/하단 정보"
    assert "회사 비밀" in first_block["text"]
    assert "Page 1 of 1" in first_block["text"]
    assert "머리글:" in first_block["text"]
    assert "바닥글:" in first_block["text"]


# M5 — header/footer 가 둘 다 없으면 CalloutBlock 이 안 들어간다 (no-op).
def test_no_header_footer_no_callout_injected() -> None:
    body = (
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>'
        '<w:r><w:t>본문 시작</w:t></w:r></w:p>'
        '<w:p><w:r><w:t>본문 단락</w:t></w:r></w:p>'
    )
    docx = _docx_with_extras(body_xml_extras=body)
    result = docx_import.docx_to_document(
        docx, slug="nh", title="nh", owner_user_id="u"
    )
    doc = result["document"]
    blocks = doc["sections"][0]["blocks"]
    callouts = [b for b in blocks if b["type"] == "callout"]
    assert callouts == []
