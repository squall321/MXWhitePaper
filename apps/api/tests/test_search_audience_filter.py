"""H5 + H6 — block-redaction-aware search filters and author filter.

These tests do **not** depend on a live Meilisearch instance. The pattern
mirrors `test_search_filters.py`: monkeypatch `meili_indexer.search` to a
spy, override the FastAPI deps so any role can be impersonated, and assert
on the filter expressions the router emits.

For H5 the contract under test is:

  - reader → only docs with ``min_role_required = "all"`` are reachable.
  - editor / owner → docs requiring ``"all"`` *or* ``"editor"``.
  - admin → no role-based clause (sees everything).

For H6:

  - ``?author=`` is lower-cased before being sent to Meili (owner emails
    are lower-cased at index time too — see meili_indexer._fetch_flat_row).
  - The filter dict is independent of the role clause.

Indexing-side helpers are also unit-tested without touching Postgres:

  - `_max_permission_required(content_json)` walks every block including
    nested columns/tabs/accordion.
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


def _install_user(role: str) -> None:
    async def fake_user() -> dict[str, Any]:
        return {"id": "u-test", "email": "u@e.x", "role": role}

    async def fake_db() -> Any:
        yield _StubSession()

    app.dependency_overrides[get_current_user] = fake_user
    app.dependency_overrides[get_db] = fake_db


def _clear_overrides() -> None:
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def spy_meili(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    captured: dict[str, Any] = {}

    def fake_search(**kwargs: Any) -> dict[str, Any]:
        captured["kwargs"] = kwargs
        return {"hits": [], "estimatedTotalHits": 0, "processingTimeMs": 1}

    monkeypatch.setattr(meili_indexer, "search", fake_search)
    return captured


# ── H5: role-based hit filtering on /search ───────────────────────────


@pytest.mark.asyncio
async def test_reader_role_emits_all_only_filter(spy_meili: dict[str, Any]) -> None:
    _install_user("reader")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/v1/search", params={"q": "secret"})
        assert r.status_code == 200
        raw = spy_meili["kwargs"]["raw_filter_exprs"]
        assert 'min_role_required = "all"' in raw
        # No higher-tier clauses leak in for a reader.
        assert not any("editor" in e or "admin" in e for e in raw)
    finally:
        _clear_overrides()


@pytest.mark.asyncio
async def test_editor_role_emits_all_or_editor_filter(spy_meili: dict[str, Any]) -> None:
    _install_user("editor")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/v1/search", params={"q": "secret"})
        assert r.status_code == 200
        raw = spy_meili["kwargs"]["raw_filter_exprs"]
        assert any("editor" in e and "all" in e for e in raw)
    finally:
        _clear_overrides()


@pytest.mark.asyncio
async def test_admin_role_has_no_role_filter(spy_meili: dict[str, Any]) -> None:
    _install_user("admin")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/v1/search", params={"q": "secret"})
        assert r.status_code == 200
        raw = spy_meili["kwargs"]["raw_filter_exprs"]
        # Admin sees everything — no min_role_required clause.
        assert not any("min_role_required" in e for e in raw)
    finally:
        _clear_overrides()


@pytest.mark.asyncio
async def test_unknown_role_defaults_to_reader_clause(spy_meili: dict[str, Any]) -> None:
    _install_user("nobody")  # not in _ROLE_TO_PERM_LEVEL
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get("/api/v1/search", params={"q": "x"})
        assert r.status_code == 200
        raw = spy_meili["kwargs"]["raw_filter_exprs"]
        assert 'min_role_required = "all"' in raw
    finally:
        _clear_overrides()


# ── H6: author filter ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_author_filter_lowercased_and_passed_through(
    spy_meili: dict[str, Any],
) -> None:
    _install_user("admin")  # use admin so role clause stays empty
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/v1/search",
                params={"q": "report", "author": "Alice@Example.Com"},
            )
        assert r.status_code == 200
        filters = spy_meili["kwargs"]["filters"]
        # Owner emails are indexed lower-cased; the router must mirror that
        # before handing to Meilisearch or the filter never matches.
        assert filters.get("author") == "alice@example.com"
    finally:
        _clear_overrides()


@pytest.mark.asyncio
async def test_author_filter_combines_with_q(spy_meili: dict[str, Any]) -> None:
    _install_user("admin")
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/v1/search",
                params={"q": "quarterly", "author": "owner@org.io"},
            )
        assert r.status_code == 200
        kwargs = spy_meili["kwargs"]
        assert kwargs["q"] == "quarterly"
        assert kwargs["filters"]["author"] == "owner@org.io"
    finally:
        _clear_overrides()


# ── H5: indexing-side helper ──────────────────────────────────────────


def _doc(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "sections": [
            {"id": "s1", "level": 1, "title": "S", "blocks": blocks, "subsections": []}
        ]
    }


def test_max_permission_default_all() -> None:
    doc = _doc([{"type": "paragraph", "text": "hi", "id": "b1"}])
    assert meili_indexer._max_permission_required(doc) == "all"


def test_max_permission_picks_highest() -> None:
    doc = _doc([
        {"type": "paragraph", "text": "public", "id": "b1"},
        {"type": "paragraph", "text": "team", "id": "b2",
         "meta": {"permission": "editor"}},
        {"type": "paragraph", "text": "secret", "id": "b3",
         "meta": {"permission": "admin"}},
    ])
    assert meili_indexer._max_permission_required(doc) == "admin"


def test_max_permission_walks_columns() -> None:
    doc = _doc([
        {
            "type": "columns",
            "id": "col1",
            "columns": [
                [{"type": "paragraph", "text": "a", "id": "b1"}],
                [
                    {"type": "paragraph", "text": "b", "id": "b2",
                     "meta": {"permission": "editor"}},
                ],
            ],
        },
    ])
    assert meili_indexer._max_permission_required(doc) == "editor"


def test_max_permission_walks_tabs_and_accordion() -> None:
    doc = _doc([
        {
            "type": "tabs",
            "id": "t1",
            "tabs": [
                {"title": "T1", "blocks": [
                    {"type": "paragraph", "text": "x", "id": "b1",
                     "meta": {"permission": "admin"}},
                ]},
            ],
        },
        {
            "type": "accordion",
            "id": "a1",
            "items": [
                {"title": "I1", "blocks": [
                    {"type": "paragraph", "text": "y", "id": "b2",
                     "meta": {"permission": "editor"}},
                ]},
            ],
        },
    ])
    assert meili_indexer._max_permission_required(doc) == "admin"


def test_max_permission_unknown_value_treated_as_all() -> None:
    # Typo / future value must NOT silently lock the doc — the *search*
    # layer is the authoritative gate, not a heuristic on stale meta.
    doc = _doc([
        {"type": "paragraph", "text": "x", "id": "b1",
         "meta": {"permission": "vip"}},  # unknown
    ])
    assert meili_indexer._max_permission_required(doc) == "all"


def test_role_filter_exprs_matrix() -> None:
    assert meili_indexer.role_filter_exprs("admin") == []
    assert meili_indexer.role_filter_exprs("editor") == [
        'min_role_required IN ["all", "editor"]'
    ]
    assert meili_indexer.role_filter_exprs("owner") == [
        'min_role_required IN ["all", "editor"]'
    ]
    assert meili_indexer.role_filter_exprs("reader") == [
        'min_role_required = "all"'
    ]
    # Defensive defaults — None and unknown collapse to the strictest tier.
    assert meili_indexer.role_filter_exprs(None) == [
        'min_role_required = "all"'
    ]
    assert meili_indexer.role_filter_exprs("anonymous") == [
        'min_role_required = "all"'
    ]
