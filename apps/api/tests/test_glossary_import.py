"""FR-13 — POST /glossary/import CSV / JSON bulk import + 중복 skip."""
from __future__ import annotations

import io

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests._glossary_helpers import (
    cleanup_terms_starting,
    ensure_user,
    login_admin,
    unique_term,
)


@pytest.mark.asyncio
async def test_csv_import_inserts_and_skips_duplicates() -> None:
    transport = ASGITransport(app=app)
    prefix = unique_term("imp-")
    csv_text = (
        "term,definition,domain,subdomain,term_en,aliases\n"
        f"{prefix}a,정의A,ml,,A_en,alias1|alias2\n"
        f"{prefix}b,정의B,ml,,,\n"
        # 같은 (term, domain) 중복 → skip
        f"{prefix}a,재정의,ml,,X_en,\n"
    )
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            admin = await login_admin(ac)
            files = {
                "file": (
                    "glossary.csv",
                    io.BytesIO(csv_text.encode("utf-8")),
                    "text/csv",
                ),
            }
            r = await ac.post(
                "/api/v1/glossary/import",
                headers={"Authorization": f"Bearer {admin}"},
                files=files,
            )
            assert r.status_code == 200, r.text
            data = r.json()["data"]
            # a, b 두 row 신규 + a 중복 1 skip
            assert data["imported"] == 2
            assert data["skipped"] == 1

            # GET /glossary 로 확인 (admin 으로 status=approved 직접 조회)
            r = await ac.get(
                "/api/v1/glossary",
                params={"q": prefix, "size": 100},
            )
            items = r.json()["data"]["items"]
            terms = {it["term"] for it in items}
            assert f"{prefix}a" in terms
            assert f"{prefix}b" in terms
            # alias 가 정상 파싱되었는지
            row_a = next(it for it in items if it["term"] == f"{prefix}a")
            assert "alias1" in (row_a.get("aliases") or [])
    finally:
        await cleanup_terms_starting(prefix)


@pytest.mark.asyncio
async def test_json_body_import_works_without_file() -> None:
    transport = ASGITransport(app=app)
    prefix = unique_term("imp-json-")
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            admin = await login_admin(ac)
            r = await ac.post(
                "/api/v1/glossary/import",
                headers={"Authorization": f"Bearer {admin}"},
                json={"rows": [
                    {"term": f"{prefix}1", "definition": "정의1",
                     "domain": "ml"},
                    {"term": f"{prefix}2", "definition": "정의2",
                     "domain": "ml", "aliases": ["x", "y"]},
                ]},
            )
            assert r.status_code == 200, r.text
            assert r.json()["data"]["imported"] == 2
    finally:
        await cleanup_terms_starting(prefix)


@pytest.mark.asyncio
async def test_import_reader_forbidden() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        reader = await ensure_user("reader-glossary@mx.local", "reader")
        r = await ac.post(
            "/api/v1/glossary/import",
            headers={"Authorization": f"Bearer {reader}"},
            json={"rows": [{"term": "x", "definition": "y"}]},
        )
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_import_without_body_or_file_returns_422() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        admin = await login_admin(ac)
        r = await ac.post(
            "/api/v1/glossary/import",
            headers={"Authorization": f"Bearer {admin}"},
        )
        assert r.status_code == 422
