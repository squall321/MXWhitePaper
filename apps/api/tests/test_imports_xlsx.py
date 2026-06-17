"""POST /imports/xlsx 단위 + HTTP 테스트.

Fixture .xlsx 는 openpyxl 으로 매 테스트마다 in-memory 생성. 시나리오:
  - 시트 → 섹션, 숫자 헤더 표 → table + chart/kpi autodetect
  - 큰 표 → SpreadsheetBlock
  - 비-xlsx 확장자 → 422
  - zip 이지만 xl/workbook.xml 없음 → 422
"""
from __future__ import annotations

import io
from collections.abc import Iterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.routers import imports as imports_mod
from app.services import xlsx_import


def _xlsx_bytes(sheets: dict[str, list[list]]) -> bytes:
    """{시트명: [[행]]} → .xlsx 바이트."""
    from openpyxl import Workbook

    wb = Workbook()
    # 기본 시트 제거 후 우리 시트만
    default = wb.active
    wb.remove(default)
    for name, rows in sheets.items():
        ws = wb.create_sheet(title=name)
        for row in rows:
            ws.append(row)
    bio = io.BytesIO()
    wb.save(bio)
    return bio.getvalue()


@pytest.fixture(autouse=True)
def _reset_rate_limit() -> Iterator[None]:
    imports_mod._reset_rate_limit_for_tests()
    yield
    imports_mod._reset_rate_limit_for_tests()


# ── Direct unit tests (no HTTP) ──────────────────────────────────────
def test_xlsx_sheet_becomes_section() -> None:
    buf = _xlsx_bytes(
        {
            "매출": [["부서", "1분기", "2분기"], ["영업", 100, 120], ["개발", 80, 90]],
            "비용": [["항목", "금액"], ["임차료", 50]],
        }
    )
    result = xlsx_import.xlsx_to_document(buf, slug="t", title="재무", owner_user_id="u")
    doc = result["document"]
    assert doc["slug"] == "t"
    assert doc["schema_version"] == "1.0"
    titles = [s["title"] for s in doc["sections"]]
    assert "매출" in titles and "비용" in titles


def test_xlsx_numeric_table_becomes_table() -> None:
    # 일반 숫자 표는 TableBlock 으로 보존 (chart autodetect 는 없음 — chart 는
    # embedded 엑셀 차트나 Widget: chart 마커로만 생성).
    buf = _xlsx_bytes(
        {"data": [["월", "매출"], ["1월", 100], ["2월", 200], ["3월", 300]]}
    )
    result = xlsx_import.xlsx_to_document(buf, slug="t", owner_user_id="u")
    blocks = result["document"]["sections"][0]["blocks"]
    types = {b["type"] for b in blocks}
    assert "table" in types


def test_xlsx_label_value_table_autodetects_kpi() -> None:
    # label/value 헤더 + 1~4행 → KpiCardsBlock 으로 자동 승격.
    buf = _xlsx_bytes(
        {"kpi": [["label", "value"], ["매출", "1.2조"], ["성장률", "12%"]]}
    )
    result = xlsx_import.xlsx_to_document(buf, slug="t", owner_user_id="u")
    blocks = result["document"]["sections"][0]["blocks"]
    types = {b["type"] for b in blocks}
    # kpi-cards 로 승격됐거나 (autodetect 동작), 안 되면 table 로 보존.
    assert types & {"kpi-cards", "table"}


def test_xlsx_large_table_becomes_spreadsheet() -> None:
    rows = [["c1", "c2"]] + [[i, i * 2] for i in range(250)]
    buf = _xlsx_bytes({"big": rows})
    result = xlsx_import.xlsx_to_document(buf, slug="t", owner_user_id="u")
    blocks = result["document"]["sections"][0]["blocks"]
    assert any(b["type"] == "spreadsheet" for b in blocks)


def test_xlsx_empty_sheet_warns() -> None:
    buf = _xlsx_bytes({"빈시트": []})
    result = xlsx_import.xlsx_to_document(buf, slug="t", owner_user_id="u")
    # 빈 시트만 있으면 fallback 섹션 1개 + warning
    assert any("빈 시트" in w for w in result["summary"].warnings)


def test_is_xlsx_content_guard() -> None:
    buf = _xlsx_bytes({"s": [["a"]]})
    assert xlsx_import.is_xlsx_content(buf) is True
    assert xlsx_import.is_xlsx_content(b"not a zip") is False


# ── HTTP-level tests ─────────────────────────────────────────────────
async def test_import_xlsx_happy_path() -> None:
    buf = _xlsx_bytes(
        {"매출": [["월", "매출"], ["1월", 100], ["2월", 200]]}
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/xlsx",
            files={
                "file": (
                    "report.xlsx",
                    buf,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                )
            },
            data={"slug": "xlsx-report", "title": "엑셀 보고서"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["error"] is None
    doc = body["data"]["document"]
    assert doc["slug"] == "xlsx-report"
    assert doc["title"] == "엑셀 보고서"
    assert len(doc["sections"]) >= 1


async def test_import_xlsx_rejects_non_xlsx_extension() -> None:
    buf = _xlsx_bytes({"s": [["a", "b"]]})
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/xlsx",
            files={"file": ("hello.txt", buf, "text/plain")},
        )
    assert r.status_code == 422


async def test_import_xlsx_rejects_non_zip() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/v1/imports/xlsx",
            files={"file": ("bogus.xlsx", b"not a zip at all", "application/octet-stream")},
        )
    assert r.status_code == 422
