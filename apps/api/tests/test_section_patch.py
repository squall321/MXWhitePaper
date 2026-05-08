"""Sprint 4 — PATCH /documents/:slug/sections/:section_id 테스트.

대상 시드: month-end-closing
  sections[0]: id=...G0S1 number=1 level=1 title=개요
    subsections[0]: id=...G0S2 number=1.1 level=2 title=결산 일정
      subsections[0]: id=...G0S3 number=1.1.1 level=3 title=월결산 상세 일정

각 테스트는 sample JSON 으로 PUT 후 등을 사용해 트리 상태를 초기화한다.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

SLUG = "month-end-closing"
ROOT_SECTION_ID = "01J9X1Y2Z3A4B5C6D7E8F9G0S1"  # level 1
LEVEL2_SECTION_ID = "01J9X1Y2Z3A4B5C6D7E8F9G0S2"  # level 2 (under root)
LEVEL3_SECTION_ID = "01J9X1Y2Z3A4B5C6D7E8F9G0S3"  # level 3

_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
SAMPLE_PATH = _SAMPLES / "01-month-end-closing.json"


async def _get(ac: AsyncClient, slug: str = SLUG) -> tuple[dict, str]:
    """sample JSON 으로 PUT 한 뒤 GET. 결과는 (data, fresh_etag)."""
    sample = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    r0 = await ac.get(f"/api/v1/documents/{slug}")
    assert r0.status_code == 200, r0.text
    etag0 = r0.headers["etag"]
    r1 = await ac.put(
        f"/api/v1/documents/{slug}",
        json=sample,
        headers={"If-Match": etag0},
    )
    assert r1.status_code == 200, r1.text
    r2 = await ac.get(f"/api/v1/documents/{slug}")
    return r2.json()["data"], r2.headers["etag"]


@pytest.mark.asyncio
async def test_patch_section_title_returns_new_etag() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        data, etag = await _get(ac)
        v0 = data["version"]
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/sections/{ROOT_SECTION_ID}",
            json={"title": "개요 (수정됨)"},
            headers={"If-Match": etag},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["data"]["section"]["title"] == "개요 (수정됨)"
        # number 는 renumber 가 다시 할당 → 1
        assert body["data"]["section"]["number"] == "1"
        new_etag = r.headers["etag"]
        assert new_etag != etag
        assert body["meta"]["etag"] == new_etag
        # version bump
        assert body["data"]["version"] == v0 + 1


@pytest.mark.asyncio
async def test_patch_section_412_on_stale_etag() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        data, _etag = await _get(ac)
        bad = f'W/"{data["id"]}-9999"'
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/sections/{ROOT_SECTION_ID}",
            json={"title": "x"},
            headers={"If-Match": bad},
        )
        assert r.status_code == 412
        assert r.json()["error"]["code"] == "PRECONDITION_FAILED"


@pytest.mark.asyncio
async def test_patch_section_404_on_unknown_section() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/sections/01ZZZZZZZZZZZZZZZZZZZZZZZZ",
            json={"title": "x"},
            headers={"If-Match": etag},
        )
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "NOT_FOUND"


@pytest.mark.asyncio
async def test_patch_section_422_on_level_violation() -> None:
    """root section (parent_level=0) 의 level 을 2 로 바꾸려 하면 422."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/sections/{ROOT_SECTION_ID}",
            json={"level": 2},
            headers={"If-Match": etag},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_patch_section_with_change_log_header() -> None:
    """X-MXWP-Change-Log 헤더가 versions 에 반영된다 (auto-save 시나리오)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/sections/{ROOT_SECTION_ID}",
            json={"title": "개요-자동저장"},
            headers={"If-Match": etag, "X-MXWP-Change-Log": "auto-save"},
        )
        assert r.status_code == 200, r.text
        new_v = r.json()["data"]["version"]
        v = await ac.get(f"/api/v1/documents/{SLUG}/versions")
        items = v.json()["data"]
        match = [it for it in items if it["version"] == new_v]
        assert match and match[0]["change_log"] == "auto-save"


@pytest.mark.asyncio
async def test_patch_section_rejects_invalid_change_log() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/sections/{ROOT_SECTION_ID}",
            json={"title": "x"},
            headers={
                "If-Match": etag,
                "X-MXWP-Change-Log": "bad\nvalue;DROP TABLE",
            },
        )
        assert r.status_code == 422
