"""document_versions 보존 정책 압축 CLI.

Plan §11 정책 (24h 전부 / 30d 일자별 1개 / 그 이상 월별 1개; head + v=1 보존).

Usage:
  apptainer exec instance://mxwp_api /bin/sh -c \\
    "cd /workspace/apps/api && python3 -m app.scripts.compact_versions"

  # 단일 문서만:
  python3 -m app.scripts.compact_versions <doc_id>
"""
from __future__ import annotations

import asyncio
import sys

from app.scripts._env import load_env

load_env()

from app.core.db import session_scope  # noqa: E402
from app.services.maintenance import compact_versions  # noqa: E402


async def main() -> None:
    doc_id = sys.argv[1] if len(sys.argv) > 1 else None
    async with session_scope() as s:
        n = await compact_versions(s, doc_id=doc_id)
    print(f"compacted={n} (doc_id={doc_id or 'ALL'})")


if __name__ == "__main__":
    asyncio.run(main())
