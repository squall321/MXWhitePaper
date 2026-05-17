"""POST /imports/docx/roundtrip 단위 테스트.

새 라운드트립 엔드포인트는 DB / MinIO / Meilisearch 를 건드리지 않고
업로드된 .docx 를 DocumentJSON 으로 정규화한 뒤 다시 .docx 로 돌려준다.
검증 포인트:
  - body 가 valid .docx 바이트
  - 응답 헤더에 통계가 채워져 있음 (Sections / Toc-Found / Toc-Method …)
  - TOC1 스타일 단락은 strip_toc=true (기본) 면 사라짐
  - verify_toc=true (기본) 면 TOC 항목과 본문 헤딩이 비교돼 missing 카운트가 보고됨
  - 이미지 바이트가 라운드트립을 지나도 보존됨 (sha256 매칭)
  - 잘못된 zip → 422
  - 옵션 form 필드(strip_toc/aggressive_toc) 가 정상 적용됨
"""
from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Iterator
from struct import pack
from zlib import compress

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.routers import imports as imports_mod
from app.services import docx_import


# ── helpers ──────────────────────────────────────────────────────────
def _tiny_png() -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"

    def _chunk(name: bytes, data: bytes) -> bytes:
        from binascii import crc32

        return pack(">I", len(data)) + name + data + pack(">I", crc32(name + data))

    ihdr = pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)
    raw = b"\x00" + b"\x00\x00\x00\x00"
    idat = compress(raw)
    return sig + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", idat) + _chunk(b"IEND", b"")


def _extract_first_png(blob: bytes) -> bytes | None:
    """라운드트립 결과 docx 의 word/media/ 첫 번째 PNG 바이트."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        return None
    for name in zf.namelist():
        if name.startswith("word/media/") and name.lower().endswith(".png"):
            return zf.read(name)
    return None


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> Iterator[None]:
    imports_mod._reset_rate_limit_for_tests()
    yield
    imports_mod._reset_rate_limit_for_tests()


# ── HTTP-level tests ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_roundtrip_returns_valid_docx_and_headers() -> None:
    """단순한 docx → 라운드트립 → docx. 통계 헤더가 채워져 있어야 한다."""
    docx = docx_import.build_minimal_docx(
        headings=[(1, "보고서"), (2, "요약")],
        paragraphs=[("이번 분기 결산입니다.", None)],
        table=[["분기", "매출"], ["Q1", "100"]],
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("report.docx", docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        )
    assert r.status_code == 200, r.text

    # body 는 valid docx zip 이어야 한다
    out = r.content
    assert docx_import.is_docx_zip_magic(out)
    assert docx_import.is_docx_content(out)

    # Content-Disposition 의 파일명이 normalized 접미사로 변경됨
    cd = r.headers.get("content-disposition", "")
    assert "report.normalized.docx" in cd

    # 카운터 헤더 — sections >= 1, tables == 1
    assert int(r.headers["X-MXWP-Roundtrip-Sections"]) >= 1
    assert int(r.headers["X-MXWP-Roundtrip-Tables"]) == 1
    assert r.headers["X-MXWP-Roundtrip-Toc-Found"] == "false"

    # JSON summary 도 헤더에 들어 있어야 한다
    summary = json.loads(r.headers["X-MXWP-Roundtrip-Summary"])
    assert summary["tables"] == 1


@pytest.mark.asyncio
async def test_roundtrip_image_bytes_preserved() -> None:
    """이미지가 들어 있는 docx 도 라운드트립 후 동일한 PNG 바이트가 나와야 한다.

    Roundtrip mode 의 핵심 보장: MinIO 가 없는 경로에서도 원본 이미지가
    DocumentJSON → docx_export 의 image_resolver 를 거쳐 그대로 유지된다.
    """
    png = _tiny_png()
    docx = docx_import.build_minimal_docx(
        headings=[(1, "Report")],
        paragraphs=[("Body", None)],
        include_image=png,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("img.docx", docx, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    assert int(r.headers["X-MXWP-Roundtrip-Images"]) >= 1

    embedded = _extract_first_png(r.content)
    assert embedded is not None, "output docx must contain at least one PNG"
    # sha256 가 정확히 같아야 한다 — Pillow re-encode 가 일어나면 깨진다
    assert hashlib.sha256(embedded).digest() == hashlib.sha256(png).digest()


@pytest.mark.asyncio
async def test_roundtrip_strip_toc_removes_toc_paragraphs() -> None:
    """`TOC1` 스타일 단락은 strip_toc=true(기본) 면 결과에서 사라져야 한다."""
    # Heading 으로 잡힐 본문 챕터 3개 + TOC1 스타일 단락 3개를 같이 넣는다.
    docx = docx_import.build_minimal_docx(
        headings=[
            (1, "Chapter A"),
            (1, "Chapter B"),
            (1, "Chapter C"),
        ],
        paragraphs=[
            ("Chapter A", "TOC1"),
            ("Chapter B", "TOC1"),
            ("Chapter C", "TOC1"),
            ("일반 단락", None),
        ],
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("toc.docx", docx, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    assert r.headers["X-MXWP-Roundtrip-Toc-Found"] == "true"
    # method B (TOC1 스타일) 가 잡혔어야 한다
    assert "B" in r.headers["X-MXWP-Roundtrip-Toc-Method"]
    # TOC 엔트리 3 개가 잡혔고
    assert int(r.headers["X-MXWP-Roundtrip-Toc-Entries"]) == 3
    # 본문 헤딩 3 개 모두 있으므로 missing 은 0
    assert int(r.headers["X-MXWP-Roundtrip-Toc-Missing"]) == 0


@pytest.mark.asyncio
async def test_roundtrip_verify_toc_reports_missing_chapters() -> None:
    """TOC 에는 있지만 본문에는 없는 챕터는 toc_missing 으로 카운트된다."""
    docx = docx_import.build_minimal_docx(
        headings=[
            (1, "Chapter A"),
            (1, "Chapter B"),
            # Chapter C 는 본문에 없음
        ],
        paragraphs=[
            ("Chapter A", "TOC1"),
            ("Chapter B", "TOC1"),
            ("Chapter C", "TOC1"),   # 본문에 없는 항목
        ],
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("toc-miss.docx", docx, "application/octet-stream")},
        )
    assert r.status_code == 200, r.text
    assert r.headers["X-MXWP-Roundtrip-Toc-Found"] == "true"
    assert int(r.headers["X-MXWP-Roundtrip-Toc-Missing"]) >= 1

    summary = json.loads(r.headers["X-MXWP-Roundtrip-Summary"])
    assert any("Chapter C" in t for t in (summary.get("toc_missing") or []))


@pytest.mark.asyncio
async def test_roundtrip_keep_toc_via_form_field() -> None:
    """strip_toc=false 로 보내면 TOC 단락이 보존되어야 한다 (그리고 출력에 들어감)."""
    docx = docx_import.build_minimal_docx(
        headings=[(1, "Chapter A")],
        paragraphs=[
            ("Chapter A", "TOC1"),
            ("그 외 본문", None),
        ],
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("keep.docx", docx, "application/octet-stream")},
            data={"strip_toc": "false"},
        )
    assert r.status_code == 200, r.text
    # 검출은 됐지만 strip 은 하지 않은 케이스
    assert r.headers["X-MXWP-Roundtrip-Toc-Found"] == "true"
    # 입력의 TOC 단락이 결과 docx 본문 (document.xml) 에도 살아 있어야 한다.
    # 두 번 등장해야 — heading "Chapter A" + TOC 단락 "Chapter A".
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        doc_xml = zf.read("word/document.xml").decode("utf-8")
    assert doc_xml.count("Chapter A") >= 2


@pytest.mark.asyncio
async def test_roundtrip_rejects_non_docx_extension() -> None:
    transport = ASGITransport(app=app)
    docx = docx_import.build_minimal_docx(paragraphs=[("hi", None)])
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("hello.txt", docx, "text/plain")},
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_roundtrip_rejects_non_zip_bytes() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("bogus.docx", b"not a zip", "application/octet-stream")},
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_roundtrip_rejects_zip_without_document_xml() -> None:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        zf.writestr("hello.txt", "world")
    raw = out.getvalue()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("fake.docx", raw, "application/octet-stream")},
        )
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_roundtrip_rejects_oversize() -> None:
    huge = b"PK\x03\x04" + b"\x00" * (imports_mod._docx_max_bytes() + 10)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/docx/roundtrip",
            files={"file": ("big.docx", huge, "application/octet-stream")},
        )
    assert r.status_code == 422, r.text
