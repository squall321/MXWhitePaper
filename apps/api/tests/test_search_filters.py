"""Cycle 5 J3 — search filters + suggest contract tests.

These tests do *not* depend on a live Meilisearch instance. We monkeypatch
`app.search.meili_indexer.search` to capture the args the router passes in and
return a canned hit set so we can assert on the response shape.
"""
from __future__ import annotations

from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.auth import get_current_user
from app.core.db import get_db
from app.main import app
from app.search import meili_indexer


class _StubSession:
    """Bare async session stub — only the methods the search router touches.

    The router calls `s.execute()` for the audit insert and `s.commit()` /
    `s.rollback()`. The /search endpoint also passes the session into the
    audit logger and *only* that path actually executes SQL. We swallow it.
    """

    async def execute(self, *_a: Any, **_kw: Any) -> Any:
        class _Result:
            def all(self) -> list[Any]:
                return []

            def first(self) -> Any:
                return None

        return _Result()

    async def commit(self) -> None: ...
    async def rollback(self) -> None: ...
    async def close(self) -> None: ...


@pytest.fixture(autouse=True)
def _override_deps() -> Any:
    async def fake_user() -> dict[str, Any]:
        return {"id": "test-user", "email": "t@e.x", "role": "admin"}

    async def fake_db() -> Any:
        yield _StubSession()

    app.dependency_overrides[get_current_user] = fake_user
    app.dependency_overrides[get_db] = fake_db
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db, None)


def _canned_meili_response() -> dict[str, Any]:
    return {
        "hits": [
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "slug": "month-end-closing",
                "title": "월말 결산 절차",
                "summary": "월별 결산을 위한 점검 항목 정리",
                "tags": ["finance", "kpi"],
                "team_slug": "finance",
                "part_slug": "accounting",
                "updated_at": "2026-04-01T00:00:00",
                "_formatted": {
                    "title": "월말 <mark>결산</mark> 절차",
                    "summary": "월별 <mark>결산</mark>을 위한…",
                    "body_text": "이 문서는 <mark>결산</mark> 절차를 다루며 부서별 검토를 요구한다.",
                },
            },
        ],
        "estimatedTotalHits": 1,
        "processingTimeMs": 7,
    }


@pytest.fixture
def patch_meili(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_search(**kwargs: Any) -> dict[str, Any]:
        captured["kwargs"] = kwargs
        return _canned_meili_response()

    monkeypatch.setattr(meili_indexer, "search", fake_search)
    return captured


@pytest.mark.asyncio
async def test_search_returns_highlights_and_snippet(
    patch_meili: dict[str, Any],
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/search", params={"q": "결산", "limit": 5})
    assert r.status_code == 200, r.text
    body = r.json()
    items = body["data"]
    assert len(items) == 1
    item = items[0]
    assert item["slug"] == "month-end-closing"
    assert "<mark>" in item["highlights"]["title"]
    assert "<mark>" in item["highlights"]["body"]
    assert "<mark>" in item["snippet"]
    assert item["part"] == "accounting"
    assert item["tags"] == ["finance", "kpi"]
    assert "query_time_ms" in body["meta"]


@pytest.mark.asyncio
async def test_search_filters_propagate_to_meili(
    patch_meili: dict[str, Any],
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/search",
            params={
                "q": "결산",
                "part": "accounting",
                "tag": "finance",
                "author": "alice",
                "from": "2025-01-01",
                "to": "2025-12-31",
                "limit": 10,
                "offset": 5,
            },
        )
    assert r.status_code == 200, r.text
    kwargs = patch_meili["kwargs"]
    assert kwargs["filters"] == {
        "part_slug": "accounting",
        "tags": "finance",
        "author": "alice",
    }
    raw = kwargs["raw_filter_exprs"]
    assert any("updated_at >=" in e and "2025-01-01" in e for e in raw)
    assert any("updated_at <=" in e and "2025-12-31" in e for e in raw)
    assert kwargs["limit"] == 10
    assert kwargs["offset"] == 5


@pytest.mark.asyncio
async def test_search_invalid_date_silently_ignored(
    patch_meili: dict[str, Any],
) -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/v1/search",
            params={"q": "x", "from": "not-a-date", "to": "2025/13/40"},
        )
    assert r.status_code == 200
    raw = patch_meili["kwargs"]["raw_filter_exprs"]
    # Both inputs were rejected → no expressions added.
    assert raw == []


@pytest.mark.asyncio
async def test_search_resilient_to_meili_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(**_: Any) -> dict[str, Any]:
        raise RuntimeError("meili down")

    monkeypatch.setattr(meili_indexer, "search", boom)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/search", params={"q": "anything"})
    assert r.status_code == 200
    body = r.json()
    assert body["data"] == []
    assert body["meta"]["total"] == 0
    assert "error" in body["meta"]


@pytest.mark.asyncio
async def test_search_suggest_returns_grouped_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Stub Meili search for the documents bucket.
    monkeypatch.setattr(
        meili_indexer,
        "search",
        lambda **_: {
            "hits": [
                {"slug": "month-end-closing", "title": "월말 결산", "_formatted": {"title": "월말 <mark>결산</mark>"}},
            ]
        },
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/search/suggest", params={"q": "결", "limit": 5})
    assert r.status_code == 200
    body = r.json()
    data = body["data"]
    # The four buckets are always present, even when the DB tables are missing.
    for k in ("tags", "authors", "parts", "documents"):
        assert k in data
    # Documents bucket got the canned hit.
    assert any(d["slug"] == "month-end-closing" for d in data["documents"])


@pytest.mark.asyncio
async def test_search_suggest_empty_q_returns_blank_buckets() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/search/suggest", params={"q": "  "})
    assert r.status_code == 200
    body = r.json()
    assert body["data"] == {"tags": [], "authors": [], "parts": [], "documents": []}
