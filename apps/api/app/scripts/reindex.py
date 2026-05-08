"""Meilisearch reindex CLI.

Usage (apptainer container):
  apptainer exec instance://mxwp_api /bin/sh -c \\
    "cd /workspace/apps/api && python3 -m app.scripts.reindex"
"""
from __future__ import annotations

import asyncio

from app.core.db import session_scope
from app.search import meili_indexer


async def _main() -> None:
    meili_indexer.ensure_index()
    async with session_scope() as s:
        # documents_flat_v 가 stale 일 수 있으니 best-effort refresh
        try:
            from sqlalchemy import text
            await s.execute(text("REFRESH MATERIALIZED VIEW documents_flat_v"))
            await s.commit()
        except Exception as e:
            print(f"⚠ matview refresh failed (continuing): {e}")
        result = await meili_indexer.reindex_all(s)
    print(f"✓ reindex complete — pushed {result['indexed']} docs, "
          f"index size: {result['stats_count']}")


if __name__ == "__main__":
    asyncio.run(_main())
