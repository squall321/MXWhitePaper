"""wiki_link_alias.resolve_term_aliases — alias 인식 단위 테스트.

approved term 의 aliases 슬러그가 본문에 `[[alias]]` 로 등장하면 canonical
term 슬러그로 redirect 되고, 원본 alias 는 metadata.alias_of 에 보존된다.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.core.db import session_scope
from app.services.wiki_link_alias import resolve_term_aliases


@pytest.mark.asyncio
async def test_alias_slug_redirects_to_canonical_term() -> None:
    canonical = f"trans-{uuid.uuid4().hex[:6]}"
    alias = f"atten-{uuid.uuid4().hex[:6]}"
    async with session_scope() as s:
        await s.execute(
            text("""
                INSERT INTO terms (term, definition, domain, status, aliases)
                VALUES (:term, '어텐션 메커니즘 기반 시퀀스 모델', 'ml',
                        'approved', :aliases)
            """),
            {"term": canonical, "aliases": [alias]},
        )
        await s.commit()

        links = [{"target_slug": alias, "anchor": None, "display": None,
                  "source_path": "sections[0]/p"}]
        out = await resolve_term_aliases(s, links)
        assert out[0]["target_slug"] == canonical
        assert out[0]["metadata"]["alias_of"] == alias

        # cleanup
        await s.execute(
            text("DELETE FROM terms WHERE term = :t"), {"t": canonical}
        )
        await s.commit()


@pytest.mark.asyncio
async def test_canonical_slug_is_passthrough() -> None:
    """이미 canonical term 이면 그대로 둔다 (alias_of 미설정)."""
    canonical = f"kernel-{uuid.uuid4().hex[:6]}"
    async with session_scope() as s:
        await s.execute(
            text("""
                INSERT INTO terms (term, definition, domain, status, aliases)
                VALUES (:term, 'OS 핵심 모듈', 'general', 'approved', '{}')
            """),
            {"term": canonical},
        )
        await s.commit()

        links = [{"target_slug": canonical, "anchor": None, "display": None,
                  "source_path": "x"}]
        out = await resolve_term_aliases(s, links)
        assert out[0]["target_slug"] == canonical
        assert "alias_of" not in (out[0].get("metadata") or {})

        await s.execute(
            text("DELETE FROM terms WHERE term = :t"), {"t": canonical}
        )
        await s.commit()


@pytest.mark.asyncio
async def test_unknown_slug_is_untouched() -> None:
    """DB 에 없는 슬러그는 그대로 둔다 — 일반 문서 링크일 수 있음."""
    async with session_scope() as s:
        slug = f"random-doc-{uuid.uuid4().hex[:6]}"
        links = [{"target_slug": slug, "anchor": None, "display": None,
                  "source_path": "x"}]
        out = await resolve_term_aliases(s, links)
        assert out[0]["target_slug"] == slug
        assert "alias_of" not in (out[0].get("metadata") or {})


@pytest.mark.asyncio
async def test_rejected_alias_is_ignored() -> None:
    """status != 'approved' 인 term 의 alias 는 redirect 되지 않는다."""
    canonical = f"reject-{uuid.uuid4().hex[:6]}"
    alias = f"al-{uuid.uuid4().hex[:6]}"
    async with session_scope() as s:
        await s.execute(
            text("""
                INSERT INTO terms (term, definition, domain, status, aliases)
                VALUES (:term, '거부된 용어', 'general', 'rejected', :aliases)
            """),
            {"term": canonical, "aliases": [alias]},
        )
        await s.commit()

        links = [{"target_slug": alias, "anchor": None, "display": None,
                  "source_path": "x"}]
        out = await resolve_term_aliases(s, links)
        assert out[0]["target_slug"] == alias
        assert "alias_of" not in (out[0].get("metadata") or {})

        await s.execute(
            text("DELETE FROM terms WHERE term = :t"), {"t": canonical}
        )
        await s.commit()


@pytest.mark.asyncio
async def test_empty_links_returns_empty() -> None:
    async with session_scope() as s:
        out = await resolve_term_aliases(s, [])
        assert out == []
