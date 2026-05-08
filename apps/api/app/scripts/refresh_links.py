"""links 테이블 일괄 재구축 스크립트 (Sprint 3 backfill).

모든 documents (status != 'archived') 에 대해:
  1. content_json 을 로드
  2. extract_wiki_links() 로 위키 링크 파싱
  3. links 테이블의 source_doc_id = doc.id 행 삭제 후 재삽입

Run:
  apptainer exec instance://mxwp_api /bin/sh -c \\
    "cd /workspace/apps/api && python -m app.scripts.refresh_links"

Idempotent — 여러 번 실행해도 결과 동일.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from sqlalchemy import text


def _load_env_file(path: Path) -> None:
    """conftest.py 와 동일한 단순 로더 — 외부 의존성 없이 .env 적용."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if value.startswith(('"', "'")):
            quote = value[0]
            end = value.find(quote, 1)
            value = value[1:end] if end != -1 else value[1:]
        else:
            hp = value.find(" #")
            if hp != -1:
                value = value[:hp]
            value = value.strip()
        os.environ.setdefault(key, value)


for _candidate in (
    Path("/workspace/.env"),
    Path(__file__).resolve().parents[3] / ".env",
):
    _load_env_file(_candidate)


from app.core.db import session_scope  # noqa: E402
from app.repos import document_repo  # noqa: E402
from app.services.wiki_link_extractor import extract_wiki_links  # noqa: E402


async def main() -> None:
    total_docs = 0
    total_links = 0
    async with session_scope() as s:
        rows = (await s.execute(text("""
            SELECT id, slug, content_json
            FROM documents
            WHERE status != 'archived'
            ORDER BY created_at
        """))).all()

        for row in rows:
            doc_id = str(row[0])
            slug = row[1]
            content = row[2]
            if isinstance(content, str):
                content = json.loads(content)
            extracted = extract_wiki_links(content)
            n = await document_repo.replace_links_for_document(
                s, source_doc_id=doc_id, links=extracted
            )
            total_docs += 1
            total_links += n
            print(f"  ✓ {slug} → {n} links")

    print(f"✓ refresh_links done — docs={total_docs}, links={total_links}")


if __name__ == "__main__":
    asyncio.run(main())
