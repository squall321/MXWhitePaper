"""Sprint 6 — 용어집 부수효과 + 라우터 통합 테스트."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app

SAMPLES = Path("/workspace/packages/shared/samples")
if not SAMPLES.exists():
    SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"


def _ulid_like() -> str:
    import secrets
    alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
    return "".join(secrets.choice(alphabet) for _ in range(26))


@pytest.mark.asyncio
async def test_save_doc_with_glossary_upserts_terms_and_get_returns_them() -> None:
    sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
    new_slug = f"glossary-test-{uuid.uuid4().hex[:8]}"
    sample["slug"] = new_slug
    sample["id"] = _ulid_like()
    sample["title"] = "용어집 테스트 문서"
    # glossary 추가
    sample["glossary"] = [
        {"term": "DPS", "definition": "Daily Profit Statement — 일일 손익계산서"},
        {"term": "MX", "definition": "Mobile eXperience"},
    ]

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/api/v1/documents", json=sample)
        assert r1.status_code == 201, r1.text

        # 용어집 GET — DPS 검색
        r2 = await ac.get("/api/v1/glossary", params={"q": "DPS"})
    assert r2.status_code == 200, r2.text
    items = r2.json()["data"]
    terms = [it["term"] for it in items]
    assert "DPS" in terms
    dps = next(it for it in items if it["term"] == "DPS")
    assert dps["related_doc_count"] >= 1

    # cleanup
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM documents WHERE slug = :slug"),
            {"slug": new_slug},
        )
        await s.execute(
            text("DELETE FROM terms WHERE term IN ('DPS','MX')"),
        )


@pytest.mark.asyncio
async def test_glossary_idempotent_on_repeated_save() -> None:
    """같은 doc 을 두 번 저장해도 terms.related_docs 는 distinct 유지."""
    sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
    new_slug = f"glossary-idem-{uuid.uuid4().hex[:8]}"
    sample["slug"] = new_slug
    sample["id"] = _ulid_like()
    sample["glossary"] = [{"term": "IDEM-TEST-TERM", "definition": "정의"}]

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/api/v1/documents", json=sample)
        assert r1.status_code == 201, r1.text
        etag = r1.headers.get("etag")

        # PUT 으로 한 번 더 — 같은 doc id, 같은 term
        sample["title"] = sample["title"] + " (수정)"
        r2 = await ac.put(
            f"/api/v1/documents/{new_slug}",
            json=sample,
            headers={"If-Match": etag},
        )
        assert r2.status_code == 200, r2.text

    # related_docs 개수 == 1 확인
    async with session_scope() as s:
        row = (await s.execute(
            text("""
                SELECT COALESCE(array_length(related_docs, 1), 0)
                FROM terms WHERE term = :t
            """),
            {"t": "IDEM-TEST-TERM"},
        )).first()
        assert row is not None
        assert int(row[0]) == 1, f"expected related_docs to remain 1, got {row[0]}"

        await s.execute(text("DELETE FROM documents WHERE slug = :slug"), {"slug": new_slug})
        await s.execute(text("DELETE FROM terms WHERE term = 'IDEM-TEST-TERM'"))


@pytest.mark.asyncio
async def test_glossary_term_removed_on_replace_drops_related_doc() -> None:
    """Polish D — PUT 시 glossary 에서 사라진 term 의 related_docs 에서 doc 가 빠져야 한다."""
    sample = json.loads((SAMPLES / "05-minimal-doc.json").read_text(encoding="utf-8"))
    new_slug = f"glossary-remove-{uuid.uuid4().hex[:8]}"
    sample["slug"] = new_slug
    sample["id"] = _ulid_like()
    sample["glossary"] = [
        {"term": "REMOVE-ME-TERM", "definition": "정의1"},
        {"term": "KEEP-TERM", "definition": "정의2"},
    ]

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.post("/api/v1/documents", json=sample)
        assert r1.status_code == 201, r1.text
        etag = r1.headers.get("etag")

        # 두 번째 save 에서 REMOVE-ME-TERM 제거
        sample["glossary"] = [{"term": "KEEP-TERM", "definition": "정의2"}]
        r2 = await ac.put(
            f"/api/v1/documents/{new_slug}",
            json=sample,
            headers={"If-Match": etag},
        )
        assert r2.status_code == 200, r2.text

    async with session_scope() as s:
        # REMOVE-ME-TERM 의 related_docs 에 이 doc 의 id 가 더 이상 없어야 한다
        rm_row = (await s.execute(
            text("""
                SELECT COALESCE(array_length(related_docs, 1), 0)
                FROM terms WHERE term = 'REMOVE-ME-TERM'
            """),
        )).first()
        # 이 doc 만 등록했으므로 array 가 비거나 길이 0
        assert rm_row is not None
        assert int(rm_row[0]) == 0
        # KEEP-TERM 은 여전히 1
        keep_row = (await s.execute(
            text("""
                SELECT COALESCE(array_length(related_docs, 1), 0)
                FROM terms WHERE term = 'KEEP-TERM'
            """),
        )).first()
        assert keep_row is not None
        assert int(keep_row[0]) == 1

        await s.execute(text("DELETE FROM documents WHERE slug = :slug"), {"slug": new_slug})
        await s.execute(text(
            "DELETE FROM terms WHERE term IN ('REMOVE-ME-TERM','KEEP-TERM')"
        ))
