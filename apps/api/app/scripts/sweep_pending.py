"""images_pending TTL sweeper CLI.

Run:
  apptainer exec instance://mxwp_api /bin/sh -c \\
    "cd /workspace/apps/api && python3 -m app.scripts.sweep_pending"
"""
from __future__ import annotations

import asyncio

from app.scripts._env import load_env

load_env()

from app.core.db import session_scope
from app.services.maintenance import purge_expired_pending_uploads


async def main() -> None:
    async with session_scope() as s:
        n = await purge_expired_pending_uploads(s)
    print(f"deleted={n}")


if __name__ == "__main__":
    asyncio.run(main())
