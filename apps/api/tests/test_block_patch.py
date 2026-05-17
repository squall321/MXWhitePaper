"""Sprint 4 — Block PATCH / insert / move / delete 테스트.

각 테스트는 onboarding-guide 시드 doc 의 알려진 block id 를 사용한다. 테스트 간 변형이
누적되면 후속 테스트가 실패하므로, 각 테스트 시작 시 sample JSON 으로 PUT 하여
초기 상태로 되돌린다.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

SLUG = "onboarding-guide"
_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
SAMPLE_PATH = _SAMPLES / "02-onboarding-guide.json"


async def _restore_seed(ac: AsyncClient) -> tuple[dict, str]:
    """onboarding-guide 를 sample JSON 으로 PUT-덮어쓰기 → 초기 etag 반환."""
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


def _ulid_like() -> str:
    import secrets
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "".join(secrets.choice(alphabet) for _ in range(26))


async def _get(ac: AsyncClient) -> tuple[dict, str]:
    return await _restore_seed(ac)


def _walk_blocks(content: dict[str, Any]):
    """flat iter of (section_id, block) for all top-level blocks of every section."""
    for sec in content.get("sections") or []:
        sid = sec["id"]
        for blk in sec.get("blocks") or []:
            yield sid, blk
        for sub in sec.get("subsections") or []:
            sub_id = sub["id"]
            for blk in sub.get("blocks") or []:
                yield sub_id, blk


def _find_first_block(content: dict[str, Any], type_: str | None = None) -> tuple[str, dict[str, Any]]:
    for sid, blk in _walk_blocks(content):
        if type_ is None or blk.get("type") == type_:
            return sid, blk
    raise AssertionError(f"no block of type={type_!r} found")


@pytest.mark.asyncio
async def test_replace_paragraph_block() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        data, etag = await _get(ac)
        # onboarding-guide 의 첫 list block 을 paragraph 로 교체
        _sid, blk = _find_first_block(data["content"], "list")
        blk_id = blk["id"]
        new_block = {"type": "paragraph", "id": blk_id, "text": "교체된 본문"}
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/blocks/{blk_id}",
            json=new_block,
            headers={"If-Match": etag},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["data"]["block"]["type"] == "paragraph"
        assert body["data"]["block"]["text"] == "교체된 본문"
        # 새 etag 다른지
        assert r.headers["etag"] != etag


@pytest.mark.asyncio
async def test_block_patch_422_on_id_mismatch() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        data, etag = await _get(ac)
        _, blk = _find_first_block(data["content"])
        blk_id = blk["id"]
        bad = {"type": "paragraph", "id": "01ZZZZZZZZZZZZZZZZZZZZZZZZ", "text": "x"}
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/blocks/{blk_id}",
            json=bad,
            headers={"If-Match": etag},
        )
        assert r.status_code == 422
        assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_block_patch_412_on_stale_etag() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        data, _etag = await _get(ac)
        _, blk = _find_first_block(data["content"])
        blk_id = blk["id"]
        new_block = {"type": "paragraph", "id": blk_id, "text": "x"}
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/blocks/{blk_id}",
            json=new_block,
            headers={"If-Match": f'W/"{data["id"]}-9999"'},
        )
        assert r.status_code == 412


@pytest.mark.asyncio
async def test_insert_block_at_end_then_delete_it() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        data, etag = await _get(ac)
        # 첫 섹션을 타깃 — 첫 sec_id 추출
        sid, _blk = _find_first_block(data["content"])
        new_id = _ulid_like()
        r = await ac.post(
            f"/api/v1/documents/{SLUG}/blocks",
            json={
                "section_id": sid,
                "block": {"type": "paragraph", "id": new_id, "text": "삽입됨"},
            },
            headers={"If-Match": etag},
        )
        assert r.status_code == 201, r.text
        new_etag = r.headers["etag"]

        # 삭제 — 412 먼저 (stale etag)
        r412 = await ac.delete(
            f"/api/v1/documents/{SLUG}/blocks/{new_id}",
            headers={"If-Match": etag},
        )
        assert r412.status_code == 412

        # 정상 삭제
        r_del = await ac.delete(
            f"/api/v1/documents/{SLUG}/blocks/{new_id}",
            headers={"If-Match": new_etag},
        )
        assert r_del.status_code == 200, r_del.text


@pytest.mark.asyncio
async def test_move_block_between_sections() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        data, etag = await _get(ac)
        # 두 개 이상의 섹션이 필요 — onboarding 은 2 개 top-level
        sections = data["content"]["sections"]
        assert len(sections) >= 2
        src_sec = sections[0]
        dst_sec = sections[1]
        # 첫 블록을 두 번째 섹션 끝으로 이동
        blk = src_sec["blocks"][0]
        blk_id = blk["id"]

        r = await ac.post(
            f"/api/v1/documents/{SLUG}/blocks/{blk_id}/move",
            json={"target_section_id": dst_sec["id"]},
            headers={"If-Match": etag},
        )
        assert r.status_code == 200, r.text

        # 단순 GET 으로 재확인 (재시드 X) — 이동 결과를 보아야 함.
        r2 = await ac.get(f"/api/v1/documents/{SLUG}")
        data2 = r2.json()["data"]
        dst_blocks = data2["content"]["sections"][1]["blocks"]
        assert any(b["id"] == blk_id for b in dst_blocks)
        src_blocks = data2["content"]["sections"][0]["blocks"]
        assert all(b["id"] != blk_id for b in src_blocks)


@pytest.mark.asyncio
async def test_block_patch_404_on_unknown_block_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _data, etag = await _get(ac)
        unknown = "01ZZZZZZZZZZZZZZZZZZZZZZZZ"
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/blocks/{unknown}",
            json={"type": "paragraph", "id": unknown, "text": "x"},
            headers={"If-Match": etag},
        )
        assert r.status_code == 404
