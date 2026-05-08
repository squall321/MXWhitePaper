"""Document 라우터: GET seed + POST→GET round-trip."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app

# seed 가 /workspace/packages/shared/samples 에서 로드한 5개 문서 중 하나
SEED_SLUG = "month-end-closing"
SAMPLES = Path("/workspace/packages/shared/samples")
if not SAMPLES.exists():
    SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"


def _ulid_like() -> str:
    """간단한 ULID 호환 26자 base32 (테스트용 — 실제 ULID 아님)."""
    # ULID 알파벳: 0-9, A-H, J, K, M, N, P-T, V-Z (Crockford base32)
    import secrets
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "".join(secrets.choice(alphabet) for _ in range(26))


@pytest.mark.asyncio
async def test_get_seed_document_returns_etag_and_sections() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(f"/api/v1/documents/{SEED_SLUG}")
    assert r.status_code == 200, r.text
    etag = r.headers.get("etag")
    assert etag is not None
    assert etag.startswith('W/"')
    body = r.json()
    assert body["error"] is None
    assert body["data"]["slug"] == SEED_SLUG
    sections = body["data"]["content"]["sections"]
    # seed sample(01-month-end-closing.json) 기준: 1개 top-level + level-2 자식 존재.
    # 5개 시드 문서 합계 == 5 임을 list 테스트에서 검증.
    assert len(sections) == 1
    assert sections[0]["level"] == 1
    sub = sections[0]["subsections"]
    assert len(sub) >= 1
    assert all(s["level"] == 2 for s in sub)


@pytest.mark.asyncio
async def test_list_documents_returns_seed() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/documents", params={"limit": 50})
    assert r.status_code == 200
    body = r.json()
    slugs = {d["slug"] for d in body["data"]}
    assert SEED_SLUG in slugs
    # seed 는 5개 문서를 published 상태로 넣음
    assert len(slugs) >= 5


@pytest.mark.asyncio
async def test_post_then_get_round_trip() -> None:
    """sample doc 을 신규 slug 로 복제 등록 → GET 으로 동일 slug 조회 가능."""
    sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
    new_slug = f"test-doc-{uuid.uuid4().hex[:8]}"
    sample["slug"] = new_slug
    sample["id"] = _ulid_like()
    # title 도 약간 바꿔둠
    sample["title"] = f"테스트: {sample['title']}"

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/api/v1/documents", json=sample)
        assert r1.status_code == 201, r1.text
        body1 = r1.json()
        assert body1["data"]["slug"] == new_slug
        etag1 = r1.headers.get("etag")
        assert etag1 is not None

        r2 = await ac.get(f"/api/v1/documents/{new_slug}")
        assert r2.status_code == 200
        body2 = r2.json()
        assert body2["data"]["slug"] == new_slug
        assert body2["data"]["version"] == 1
        # section number 는 서버가 재부여한다 — 1 부터 시작
        assert body2["data"]["content"]["sections"][0]["number"] == "1"

        # cleanup: soft delete (archive)
        r3 = await ac.delete(f"/api/v1/documents/{new_slug}")
        assert r3.status_code == 204


@pytest.mark.asyncio
async def test_put_requires_if_match() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # GET 으로 현재 etag 확보
        r1 = await ac.get(f"/api/v1/documents/{SEED_SLUG}")
        body = r1.json()["data"]
        content = body["content"]

        # If-Match 없이 PUT → 412
        r2 = await ac.put(f"/api/v1/documents/{SEED_SLUG}", json=content)
        assert r2.status_code == 412

        # 잘못된 If-Match → 412
        r3 = await ac.put(
            f"/api/v1/documents/{SEED_SLUG}",
            json=content,
            headers={"If-Match": 'W/"00000000-0000-0000-0000-000000000000-99"'},
        )
        assert r3.status_code == 412


# ── Polish D — metadata.part resolution & tags pipeline ─────────────


def _minimal_payload(new_slug: str) -> dict:
    sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
    sample["slug"] = new_slug
    sample["id"] = _ulid_like()
    return sample


@pytest.mark.asyncio
async def test_post_resolves_part_by_slug_no_warnings() -> None:
    payload = _minimal_payload(f"part-slug-{uuid.uuid4().hex[:8]}")
    payload["metadata"]["part"] = "cae"  # Cycle 14 reset 의 part slug
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/documents", json=payload)
        assert r.status_code == 201, r.text
        body = r.json()
        warnings = (body.get("meta") or {}).get("warnings") or []
        assert all(
            w.get("field") != "metadata.part" for w in warnings
        ), warnings
        # cleanup
        await ac.delete(f"/api/v1/documents/{payload['slug']}")


@pytest.mark.asyncio
async def test_post_resolves_part_by_korean_name() -> None:
    payload = _minimal_payload(f"part-name-{uuid.uuid4().hex[:8]}")
    payload["metadata"]["part"] = "CAE그룹"  # Cycle 14 reset 의 part name (한글)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/documents", json=payload)
        assert r.status_code == 201, r.text
        # part_id 가 실제로 채워졌는지 GET 으로 확인
        r2 = await ac.get(f"/api/v1/documents/{payload['slug']}")
        assert r2.status_code == 200
        assert r2.json()["data"]["part_id"] is not None
        await ac.delete(f"/api/v1/documents/{payload['slug']}")


@pytest.mark.asyncio
async def test_post_unresolved_part_emits_warning() -> None:
    payload = _minimal_payload(f"part-bad-{uuid.uuid4().hex[:8]}")
    payload["metadata"]["part"] = "존재하지않는파트"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/documents", json=payload)
        assert r.status_code == 201, r.text
        warnings = (r.json().get("meta") or {}).get("warnings") or []
        assert any(
            w.get("field") == "metadata.part" and w.get("code") == "unresolved"
            for w in warnings
        ), warnings
        await ac.delete(f"/api/v1/documents/{payload['slug']}")


@pytest.mark.asyncio
async def test_post_tags_pipeline_writes_join_rows() -> None:
    """metadata.tags 가 tags + document_tags 에 멱등 upsert 되어야 한다."""
    from sqlalchemy import text as _text

    from app.core.db import session_scope

    tag_a = f"태그A-{uuid.uuid4().hex[:6]}"
    tag_b = "R&R"
    payload = _minimal_payload(f"tag-{uuid.uuid4().hex[:8]}")
    payload["metadata"]["tags"] = [tag_a, tag_b]
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/documents", json=payload)
        assert r.status_code == 201, r.text

    async with session_scope() as s:
        rows = (await s.execute(
            _text("""
                SELECT t.name FROM document_tags dt
                JOIN tags t ON t.id = dt.tag_id
                JOIN documents d ON d.id = dt.document_id
                WHERE d.slug = :slug
            """),
            {"slug": payload["slug"]},
        )).all()
        names = {r[0] for r in rows}
        assert tag_a in names
        assert tag_b in names
        await s.execute(
            _text("DELETE FROM documents WHERE slug = :s"),
            {"s": payload["slug"]},
        )


@pytest.mark.asyncio
async def test_friendly_validation_error_korean_message() -> None:
    payload = _minimal_payload(f"bad-enum-{uuid.uuid4().hex[:8]}")
    payload["metadata"]["confidentiality"] = "TOP-SECRET"  # enum 위반
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/documents", json=payload)
    assert r.status_code == 422
    body = r.json()
    err = body["error"]
    assert err["code"] == "VALIDATION_ERROR"
    # 한국어 안내 + details.errors 에 친화적 항목이 있어야 함
    assert "DocumentJSON" in err["message"] or "규격" in err["message"]
    details = err.get("details") or {}
    items = details.get("errors") or []
    assert items, body
    fields = [it.get("field") for it in items]
    assert any("confidentiality" in (f or "") for f in fields)


@pytest.mark.asyncio
async def test_post_hangul_slug_accepted() -> None:
    payload = _minimal_payload(f"한글-{uuid.uuid4().hex[:6]}")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/v1/documents", json=payload)
        assert r.status_code == 201, r.text
        r2 = await ac.get(f"/api/v1/documents/{payload['slug']}")
        assert r2.status_code == 200
        await ac.delete(f"/api/v1/documents/{payload['slug']}")
