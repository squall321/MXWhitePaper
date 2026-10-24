# 위키를 덤프 · 합치기에서 빼는 시험 — 덤프는 위키 문서 · 그 태그 줄을 싣지 않고, 합치기는 이 박스의 위키 문서를 덮어쓰지 않는다
"""docs/llm-wiki W3 완료 기준 '덤프에 위키가 없음'. 버킷 쪽(data-dump.sh · data-merge.sh 의 mxwp-wiki-sources 건너뛰기)은 셸이라
여기서 보지 않는다. 스냅숏은 pg_dump 전체 · 백업 밖 모든 버킷이라 위키가 저절로 든다(docs/lat/snapshots.md).
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.core.db import session_scope
from app.scripts import dump_data, import_dump

RUN = uuid4().hex[:8]
QUERIES = dict(dump_data.QUERIES)


@pytest.fixture
async def docs() -> Any:
    ids: dict[str, str] = {}
    async with session_scope() as s:
        owner = str((await s.execute(text("SELECT id FROM users ORDER BY created_at LIMIT 1"))).scalar_one())
        tag = str((await s.execute(text("INSERT INTO tags (name) VALUES (:n) RETURNING id"),
                                   {"n": f"w3-dump-{RUN}"})).scalar_one())
        for name in ("plain", "wiki"):
            ids[name] = str((await s.execute(text("""
                INSERT INTO documents (slug, title, summary, status, content_json, owner_id)
                VALUES (:slug, :t, '', 'published', CAST(:c AS jsonb), CAST(:o AS uuid)) RETURNING id
            """), {"slug": f"w3-dump-{RUN}-{name}", "t": f"덤프 시험 {name}", "c": json.dumps({"v": name}),
                   "o": owner})).scalar_one())
            await s.execute(text("INSERT INTO document_tags (document_id, tag_id) VALUES (CAST(:d AS uuid), CAST(:t AS uuid))"),
                            {"d": ids[name], "t": tag})
        await s.execute(text("""
            INSERT INTO wiki_pages (doc_id, kind, managed, audience) VALUES (CAST(:d AS uuid), 'source', 'ai', ARRAY['org'])
        """), {"d": ids["wiki"]})
        await s.commit()
    yield ids
    async with session_scope() as s:
        await s.execute(text("DELETE FROM documents WHERE slug LIKE :p"), {"p": f"w3-dump-{RUN}-%"})
        await s.execute(text("DELETE FROM tags WHERE name = :n"), {"n": f"w3-dump-{RUN}"})


async def test_dump_leaves_out_wiki_documents_and_their_tags(docs: dict[str, str]) -> None:
    async with session_scope() as s:
        doc_ids = {str(r[0]) for r in (await s.execute(text(QUERIES["documents"]))).all()}
        tagged = {str(r[0]) for r in (await s.execute(text(QUERIES["document_tags"]))).all()}
    assert docs["plain"] in doc_ids and docs["wiki"] not in doc_ids
    assert docs["plain"] in tagged and docs["wiki"] not in tagged


async def test_merge_never_overwrites_a_local_wiki_document(docs: dict[str, str]) -> None:
    incoming = {"id": str(uuid4()), "slug": f"w3-dump-{RUN}-wiki", "title": "덮어쓰려는 문서", "summary": "",
                "status": "published", "content_json": {"v": "incoming"}, "schema_ver": "1.0", "version": 1,
                "updated_at": datetime.now(UTC).isoformat()}
    async with session_scope() as s:
        owner = str((await s.execute(text("SELECT id FROM users ORDER BY created_at LIMIT 1"))).scalar_one())
        id_map, inserted, skipped, overwritten = await import_dump._import_documents(
            s, [incoming], "overwrite", owner, False)
        await s.commit()
        content = (await s.execute(text("SELECT content_json FROM documents WHERE id = CAST(:i AS uuid)"),
                                   {"i": docs["wiki"]})).scalar_one()
    assert (inserted, skipped, overwritten) == (0, 1, 0) and incoming["id"] not in id_map
    assert (json.loads(content) if isinstance(content, str) else content) == {"v": "wiki"}
