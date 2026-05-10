"""Sprint 4 — POST /documents/:slug/sections/reorder 테스트.

대상 문서: month-end-closing
  - 1 (level 1)
    - 1.1 (level 2)
      - 1.1.1 (level 3)

각 테스트는 sample JSON 으로 PUT 후 사용한다 — 다른 테스트가 트리를 변경했을 수도 있어서.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

SLUG = "month-end-closing"
ROOT = "01J9X1Y2Z3A4B5C6D7E8F9G0S1"
SUB = "01J9X1Y2Z3A4B5C6D7E8F9G0S2"
SUBSUB = "01J9X1Y2Z3A4B5C6D7E8F9G0S3"

_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
SAMPLE_PATH = _SAMPLES / "01-month-end-closing.json"


async def _get(ac: AsyncClient) -> tuple[dict, str]:
    sample = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    r0 = await ac.get(f"/api/v1/documents/{SLUG}")
    assert r0.status_code == 200
    etag0 = r0.headers["etag"]
    r1 = await ac.put(
        f"/api/v1/documents/{SLUG}",
        json=sample,
        headers={"If-Match": etag0},
    )
    assert r1.status_code == 200, r1.text
    r2 = await ac.get(f"/api/v1/documents/{SLUG}")
    return r2.json()["data"], r2.headers["etag"]


@pytest.mark.asyncio
async def test_reorder_promotes_subsection_to_root_renumbers() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        # SUB (현 1.1) 를 root level 로 끌어올린다 — 자식 SUBSUB 은 그대로 거느린다.
        # 모든 id 가 outline 에 들어가야 한다.
        outline = [
            {"id": ROOT, "children": []},  # 자식 없음, 그러나 SUB+SUBSUB 가 빠지면 422
            {"id": SUB, "children": [
                {"id": SUBSUB, "children": []},
            ]},
        ]
        r = await ac.post(
            f"/api/v1/documents/{SLUG}/sections/reorder",
            json={"outline": outline},
            headers={"If-Match": etag},
        )
        assert r.status_code == 200, r.text
        body = r.json()["data"]
        sections = body["sections"]
        assert len(sections) == 2
        assert sections[0]["id"] == ROOT
        assert sections[0]["number"] == "1"
        assert sections[0]["level"] == 1
        assert sections[1]["id"] == SUB
        assert sections[1]["number"] == "2"
        assert sections[1]["level"] == 1  # depth 로부터 재유도됨
        # 자식 SUBSUB 는 SUB 의 child → level 2, number 2.1
        sub_children = sections[1]["subsections"]
        assert len(sub_children) == 1
        assert sub_children[0]["id"] == SUBSUB
        assert sub_children[0]["level"] == 2
        assert sub_children[0]["number"] == "2.1"

        # cleanup: 다시 원복 (다른 테스트가 month-end-closing 에 의존하므로)
        # 그러나 이 시점 etag 는 새것 → 다음 reorder 호출은 새 etag 사용
        new_etag = r.headers["etag"]
        restore_outline = [
            {"id": ROOT, "children": [
                {"id": SUB, "children": [
                    {"id": SUBSUB, "children": []},
                ]},
            ]},
        ]
        r2 = await ac.post(
            f"/api/v1/documents/{SLUG}/sections/reorder",
            json={"outline": restore_outline},
            headers={"If-Match": new_etag},
        )
        assert r2.status_code == 200, r2.text


@pytest.mark.asyncio
async def test_reorder_422_on_depth_beyond_max() -> None:
    """Section depth is now schema-unbounded but still capped at
    `section_numbering.MAX_DEPTH` (16) so a runaway tree can't blow the
    stack. Build an outline 17-deep and assert the BE rejects it."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        # MAX_DEPTH = 16 → depth 17 should 422.
        innermost: dict[str, Any] = {"id": "01ZZZZZZZZZZZZZZZZZZZZZZZZ", "children": []}
        node: dict[str, Any] = innermost
        # Build 14 fresh wrappers (depths 4..17) on top of ROOT/SUB/SUBSUB.
        for i in range(14):
            wrap_id = f"01AAAAAAAAAAAAAAAAAAAAAA{i:02d}"
            node = {"id": wrap_id, "children": [node]}
        bad_outline = [
            {"id": ROOT, "children": [
                {"id": SUB, "children": [
                    {"id": SUBSUB, "children": [node]},
                ]},
            ]},
        ]
        r = await ac.post(
            f"/api/v1/documents/{SLUG}/sections/reorder",
            json={"outline": bad_outline},
            headers={"If-Match": etag},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_reorder_422_on_missing_section_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        # SUBSUB 누락
        outline = [
            {"id": ROOT, "children": [
                {"id": SUB, "children": []},
            ]},
        ]
        r = await ac.post(
            f"/api/v1/documents/{SLUG}/sections/reorder",
            json={"outline": outline},
            headers={"If-Match": etag},
        )
        assert r.status_code == 422


@pytest.mark.asyncio
async def test_reorder_422_on_duplicate_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        outline = [
            {"id": ROOT, "children": [
                {"id": SUB, "children": [
                    {"id": SUBSUB, "children": []},
                ]},
            ]},
            {"id": ROOT, "children": []},  # 중복
        ]
        r = await ac.post(
            f"/api/v1/documents/{SLUG}/sections/reorder",
            json={"outline": outline},
            headers={"If-Match": etag},
        )
        assert r.status_code == 422
