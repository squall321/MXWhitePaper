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
def _reset_rate_limit() -> None:
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
    huge = b"PK\x03\x04" + b"\x00" * (imports_mod.MAX_DOCX_BYTES + 10)
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
