"""Sprint 6 — Meilisearch 검색 통합 테스트.

전제: seed 가 5개 published 문서를 적재했고, reindex 가 한 번 이상 실행됐다.
테스트는 conftest 가 MXWP_SKIP_VIEW_REFRESH=1 로 view 갱신을 막으므로,
여기서 직접 REFRESH + reindex 를 호출해 인덱스를 동기화한다.
"""
from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.main import app
from app.search import meili_indexer


@pytest.fixture(autouse=True)
def _meili_required() -> None:
    # Meilisearch 가 죽어있으면 skip — CI 단계에서는 항상 살려둔다.
    if os.environ.get("MXWP_SKIP_MEILI") == "1":
        pytest.skip("MXWP_SKIP_MEILI is set")


@pytest.mark.asyncio
async def test_search_returns_month_end_closing_for_keyword() -> None:
    # 1) view 갱신 + reindex (seed 직후 인덱스가 stale 일 수 있음)
    async with session_scope() as s:
        try:
            await s.execute(text("REFRESH MATERIALIZED VIEW documents_flat_v"))
            await s.commit()
        except Exception:
            pass
        meili_indexer.ensure_index()
        await meili_indexer.reindex_all(s)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/search", params={"q": "결산", "limit": 10})

    assert r.status_code == 200, r.text
    body = r.json()
    slugs = [h["slug"] for h in body["data"]]
    assert "month-end-closing" in slugs, f"expected month-end-closing in {slugs}"
    assert body["meta"]["total"] >= 1
    assert "took_ms" in body["meta"]


@pytest.mark.asyncio
async def test_search_with_filter_team() -> None:
    async with session_scope() as s:
        try:
            await s.execute(text("REFRESH MATERIALIZED VIEW documents_flat_v"))
            await s.commit()
        except Exception:
            pass
        meili_indexer.ensure_index()
        await meili_indexer.reindex_all(s)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/search", params={"q": "", "team": "finance", "limit": 50})

    assert r.status_code == 200, r.text
    body = r.json()
    # finance 팀 하위 문서가 최소 1건 — seed 의 month-end-closing 이 finance 임
    assert body["meta"]["total"] >= 1
