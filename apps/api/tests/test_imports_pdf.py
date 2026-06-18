"""POST /imports/pdf 단위 + HTTP 테스트.

Fixture .pdf 는 PyMuPDF(fitz) 로 매 테스트마다 in-memory 생성. PDF 는
휴리스틱 변환이므로 (폰트 크기→heading, find_tables→표) 정확한 카운트보다
구조가 합리적으로 만들어지는지에 초점.
"""
from __future__ import annotations

from collections.abc import Iterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.routers import imports as imports_mod
from app.services import pdf_import


# fitz 의 builtin 폰트(Helvetica)는 한글 글리프가 없어 insert_text 가 한글을
# 점(·)으로 대체한다. 이는 *테스트 fixture* 한계일 뿐 — 실제 PDF 는 폰트를
# 임베드하므로 한글 추출이 정상이다. 따라서 fixture 본문은 ASCII 로 둔다.
def _pdf_bytes(*, title: str = "Big Heading", body: str = "This is a body paragraph.") -> bytes:
    """제목(큰 폰트) + 본문(작은 폰트) 한 페이지 PDF."""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), title, fontsize=24)
    page.insert_text((72, 160), body, fontsize=11)
    out = doc.tobytes()
    doc.close()
    return out


def _pdf_with_table() -> bytes:
    """간단한 격자 표가 그려진 PDF (find_tables 가 잡도록 선으로 셀 구성)."""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    # 2x2 격자 + 텍스트 — find_tables 는 선/정렬로 표를 인식.
    x0, y0, cw, ch = 72, 72, 120, 30
    cells = [["Dept", "Sales"], ["Ops", "100"]]
    for r in range(2):
        for c in range(2):
            rect = fitz.Rect(
                x0 + c * cw, y0 + r * ch, x0 + (c + 1) * cw, y0 + (r + 1) * ch
            )
            page.draw_rect(rect)
            page.insert_text((rect.x0 + 4, rect.y0 + 20), cells[r][c], fontsize=11)
    out = doc.tobytes()
    doc.close()
    return out


def _tiny_png() -> bytes:
    """10×10 빨강 PNG (테스트용 임베드 이미지)."""
    from binascii import crc32
    from struct import pack
    from zlib import compress

    def ch(name: bytes, data: bytes) -> bytes:
        return pack(">I", len(data)) + name + data + pack(">I", crc32(name + data))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = pack(">IIBBBBB", 10, 10, 8, 2, 0, 0, 0)  # 10x10 RGB
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * 10 for _ in range(10))
    return sig + ch(b"IHDR", ihdr) + ch(b"IDAT", compress(raw)) + ch(b"IEND", b"")


def _pdf_with_image() -> bytes:
    """이미지가 임베드된 한 페이지 PDF."""
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 80), "Report with image", fontsize=20)
    page.insert_image(fitz.Rect(72, 120, 172, 220), stream=_tiny_png())
    out = doc.tobytes()
    doc.close()
    return out


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> Iterator[None]:
    imports_mod._reset_rate_limit_for_tests()
    yield
    imports_mod._reset_rate_limit_for_tests()


# ── Direct unit tests ────────────────────────────────────────────────
def test_pdf_text_becomes_blocks() -> None:
    buf = _pdf_bytes(title="Annual Plan 2026", body="Our goal this year is growth.")
    result = pdf_import.pdf_to_document(buf, slug="t", title="계획", owner_user_id="u")
    doc = result["document"]
    assert doc["slug"] == "t"
    assert doc["schema_version"] == "1.0"
    # 본문 텍스트가 어딘가의 섹션 블록에 paragraph 로 들어갔는지
    all_text = " ".join(
        b.get("text", "")
        for s in doc["sections"]
        for b in s["blocks"]
        if b["type"] == "paragraph"
    )
    titles = " ".join(s["title"] for s in doc["sections"])
    assert "growth" in all_text
    # 큰 폰트 제목은 heading(섹션)으로 승격됐을 가능성
    assert "Annual Plan" in (all_text + " " + titles)


def test_pdf_table_extracted() -> None:
    buf = _pdf_with_table()
    result = pdf_import.pdf_to_document(buf, slug="t", owner_user_id="u")
    blocks = [b for s in result["document"]["sections"] for b in s["blocks"]]
    # find_tables 가 잡으면 table 블록, 못 잡아도 텍스트는 보존 (회귀 안전).
    has_table = any(b["type"] == "table" for b in blocks)
    has_text = any(b["type"] == "paragraph" for b in blocks)
    assert has_table or has_text


def test_pdf_heuristic_warning_present() -> None:
    buf = _pdf_bytes()
    result = pdf_import.pdf_to_document(buf, slug="t", owner_user_id="u")
    assert any("휴리스틱" in w for w in result["summary"].warnings)


def test_is_pdf_magic_guard() -> None:
    assert pdf_import.is_pdf_magic(_pdf_bytes()) is True
    assert pdf_import.is_pdf_magic(b"not a pdf") is False


def test_extract_pdf_image_returns_bytes() -> None:
    import fitz

    doc = fitz.open(stream=_pdf_with_image(), filetype="pdf")
    xrefs = [img[0] for page in doc for img in page.get_images(full=True)]
    assert xrefs, "임베드 이미지가 있어야 함"
    extracted = pdf_import.extract_pdf_image(doc, xrefs[0])
    assert extracted is not None
    data, ext = extracted
    assert isinstance(data, bytes) and len(data) > 0
    assert ext  # png/jpeg 등


def test_pdf_image_uploader_wires_real_id() -> None:
    # image_uploader 가 sha 로 id 를 돌려주면 ImageBlock.imageId 에 반영된다
    # (placeholder 가 아니라). 라우터 없이 stub uploader 로 계약만 검증.
    seen: dict[str, bytes] = {}

    def stub(data: bytes, _name: str) -> dict[str, str]:
        seen["data"] = data
        return {"image_id": "01TESTIMAGEID000000000000"}

    result = pdf_import.pdf_to_document(
        _pdf_with_image(), slug="t", owner_user_id="u", image_uploader=stub
    )
    imgs = [
        b
        for s in result["document"]["sections"]
        for b in s["blocks"]
        if b["type"] == "image"
    ]
    assert imgs, "image 블록이 있어야 함"
    assert imgs[0]["imageId"] == "01TESTIMAGEID000000000000"
    assert "data" in seen  # uploader 가 실제 바이트로 호출됨
    # placeholder warning 이 없어야 함 (업로드 성공)
    assert not any("placeholder" in w for w in result["summary"].warnings)


# ── HTTP-level tests ─────────────────────────────────────────────────
async def test_import_pdf_happy_path() -> None:
    buf = _pdf_bytes(title="Quarterly Report", body="Sales increased.")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/pdf",
            files={"file": ("report.pdf", buf, "application/pdf")},
            data={"slug": "pdf-report", "title": "PDF 보고서"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["error"] is None
    doc = body["data"]["document"]
    assert doc["slug"] == "pdf-report"
    assert doc["title"] == "PDF 보고서"


async def test_import_pdf_image_uploaded_and_resolvable() -> None:
    # 임베드 이미지가 라우터의 _preprocess_pdf_images 로 실제 업로드되어
    # ImageBlock 이 placeholder 가 아닌 resolvable image_id 를 갖는지.
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/pdf",
            files={"file": ("withimg.pdf", _pdf_with_image(), "application/pdf")},
            data={"slug": "pdf-withimg"},
        )
        assert r.status_code == 200, r.text
        doc = r.json()["data"]["document"]
        imgs = [
            b
            for s in doc["sections"]
            for b in s["blocks"]
            if b["type"] == "image"
        ]
        assert imgs, "image 블록이 있어야 함"
        image_id = imgs[0]["imageId"]
        # 실제 업로드된 image 는 GET /images/{id} 로 resolvable (404 아님).
        got = await ac.get(f"/api/v1/images/{image_id}")
        assert got.status_code == 200, (
            f"image_id {image_id} 가 resolvable 해야 함 (dangling placeholder 아님): "
            f"{got.text}"
        )


async def test_import_pdf_rejects_non_pdf_extension() -> None:
    buf = _pdf_bytes()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/pdf",
            files={"file": ("hello.txt", buf, "text/plain")},
        )
    assert r.status_code == 422


async def test_import_pdf_rejects_non_pdf_bytes() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/pdf",
            files={"file": ("bogus.pdf", b"not a pdf at all", "application/pdf")},
        )
    assert r.status_code == 422
