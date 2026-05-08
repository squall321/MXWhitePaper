"""통합 maintenance CLI — 모든 sweep 함수를 한 번에 실행.

cron 예시:
  */10 * * * * apptainer exec instance://mxwp_api /bin/sh -c \\
    "cd /workspace/apps/api && python3 -m app.scripts.maintenance"

옵션:
  --audit-days N   audit_logs 에서 N일 이전 행 삭제 (기본 비활성)
  --yes            audit 삭제 명시 동의
"""
from __future__ import annotations

import argparse
import asyncio

from app.scripts._env import load_env

load_env()

from app.core.db import session_scope  # noqa: E402
from app.services.maintenance import (  # noqa: E402
    compact_versions,
    purge_expired_pending_uploads,
    purge_old_audit_logs,
)


async def main(audit_days: int | None, yes: bool) -> None:
    summary: dict[str, int] = {}
    async with session_scope() as s:
        summary["pending_uploads"] = await purge_expired_pending_uploads(s)
        summary["versions"] = await compact_versions(s)
        if audit_days and yes:
            summary["audit_logs"] = await purge_old_audit_logs(s, days=audit_days)

    print("Maintenance summary:")
    for k, v in summary.items():
        print(f"  {k}: deleted={v}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--audit-days", type=int, default=None,
                   help="audit_logs 보존 기간(일). 명시 시 그보다 오래된 행 삭제.")
    p.add_argument("--yes", action="store_true",
                   help="audit_logs 삭제에 명시 동의 (audit-days 와 함께)")
    a = p.parse_args()
    asyncio.run(main(a.audit_days, a.yes))
