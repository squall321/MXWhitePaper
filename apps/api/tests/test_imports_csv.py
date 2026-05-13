"""POST /imports/csv 단위 테스트.

시나리오:
  - happy: 2 행 CSV → created=2
  - oversize → 422
  - missing required column (title) → 422
  - non-csv extension → 422
  - duplicate slug → 첫 행 created, 두 번째 행 skipped
  - body \\n\\n 분리 → paragraph 블록 N개
  - invalid confidentiality → fail-fast 422, 그 어떤 행도 insert 안 됨
  - slug 누락 시 title 에서 도출
"""
from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_factory
from app.main import app
from app.routers import imports as imports_mod


def _u() -> str:
    """짧은 unique 토큰 — 슬러그 충돌 없는 행을 매 실행마다 생성."""
    return uuid.uuid4().hex[:8]


def _csv(rows: list[str]) -> bytes:
    return ("\n".join(rows) + "\n").encode("utf-8")


async def _post_csv(content: bytes, filename: str = "data.csv") -> Any:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        return await ac.post(
            "/api/v1/imports/csv",
            files={"file": (filename, content, "text/csv")},
        )


@pytest.mark.asyncio
async def test_csv_happy_path() -> None:
    tag = _u()
    csv_bytes = _csv([
        "slug,title,summary,division,team,group,part,tags,owners,confidentiality,body",
        f"csv-doc-a-{tag},CSV Doc A,요약 A,DX,,,,intro|sample,,internal,첫 단락.",
        f"csv-doc-b-{tag},CSV Doc B,,DX,,,,faq,,public,단락1.",
    ])
    r = await _post_csv(csv_bytes)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["created"] == 2
    assert data["skipped"] == 0
    assert data["errors"] == []


@pytest.mark.asyncio
async def test_csv_rejects_oversize() -> None:
    big = b"slug,title\n" + b"x," + b"a" * (imports_mod._csv_max_bytes() + 10)
    r = await _post_csv(big)
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_csv_rejects_missing_required_column() -> None:
    csv_bytes = _csv([
        "slug,summary",
        "abc,no title here",
    ])
    r = await _post_csv(csv_bytes)
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert "title" in body["error"]["details"]["missing"]


@pytest.mark.asyncio
async def test_csv_rejects_non_csv_extension() -> None:
    r = await _post_csv(b"slug,title\nabc,X\n", filename="data.txt")
    assert r.status_code == 422, r.text


@pytest.mark.asyncio
async def test_csv_skips_duplicate_slug() -> None:
    slug = f"dup-slug-{_u()}"
    csv1 = _csv([
        "slug,title,division,owners,confidentiality,body",
        f"{slug},First,DX,,internal,b1.",
    ])
    r1 = await _post_csv(csv1)
    assert r1.status_code == 200, r1.text
    assert r1.json()["data"]["created"] == 1

    fresh = f"fresh-{_u()}"
    csv2 = _csv([
        "slug,title,division,owners,confidentiality,body",
        f"{slug},Second Try,DX,,internal,b2.",
        f"{fresh},Fresh,DX,,internal,b3.",
    ])
    r2 = await _post_csv(csv2)
    assert r2.status_code == 200, r2.text
    data = r2.json()["data"]
    assert data["created"] == 1
    assert data["skipped"] == 1


@pytest.mark.asyncio
async def test_csv_body_splits_paragraphs() -> None:
    body = "para1.\n\npara2.\n\npara3."
    slug = f"csv-body-split-{_u()}"
    csv_bytes = (
        "slug,title,division,owners,confidentiality,body\n"
        f'{slug},Body Split,DX,,internal,"{body}"\n'
    ).encode("utf-8")
    r = await _post_csv(csv_bytes)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["created"] == 1

    sm = session_factory()
    async with sm() as s:
        row = (await s.execute(
            text("SELECT content_json FROM documents WHERE slug = :s"),
            {"s": slug},
        )).first()
        assert row is not None
        content = row[0]
        section = content["sections"][0]
        para_blocks = [b for b in section["blocks"] if b["type"] == "paragraph"]
        assert len(para_blocks) == 3
        assert para_blocks[0]["text"] == "para1."
        assert para_blocks[2]["text"] == "para3."


@pytest.mark.asyncio
async def test_csv_invalid_confidentiality_fails_fast() -> None:
    bad = f"csv-bad-conf-{_u()}"
    good = f"csv-good-after-{_u()}"
    csv_bytes = _csv([
        "slug,title,division,owners,confidentiality,body",
        f"{bad},Bad Conf,DX,,wrongvalue,b.",
        f"{good},Good After,DX,,internal,b2.",
    ])
    r = await _post_csv(csv_bytes)
    assert r.status_code == 422, r.text
    err = r.json()["error"]
    assert err["code"] == "VALIDATION_ERROR"
    rows = err["details"]["errors"]
    assert any(e["slug"] == bad for e in rows)

    sm = session_factory()
    async with sm() as s:
        row = (await s.execute(
            text("SELECT 1 FROM documents WHERE slug = :s"),
            {"s": good},
        )).first()
        assert row is None


@pytest.mark.asyncio
async def test_csv_derives_slug_from_title_when_missing() -> None:
    title = f"Auto Derived Slug {_u()}"
    csv_bytes = _csv([
        "slug,title,division,owners,confidentiality,body",
        f",{title},DX,,internal,a.",
    ])
    r = await _post_csv(csv_bytes)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["created"] == 1

    sm = session_factory()
    async with sm() as s:
        row = (await s.execute(
            text("SELECT slug FROM documents WHERE title = :t"),
            {"t": title},
        )).first()
        assert row is not None
        assert row[0].startswith("auto-derived")
