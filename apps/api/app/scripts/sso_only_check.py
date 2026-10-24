# SSO 전용을 켜기 전에 — 포털로 들어온 적 없는 사람 계정(켜면 웹 로그인을 못 한다)을 뽑는다. 서비스 계정 빼고, 비상 관리자 표시
"""사용자 결정 10-25 — 박스마다 사람이 이 목록을 보고 `MXWP_SSO_ONLY=true` 를 켠다(docs/llm-wiki checklist 'SSO 전용').

    apptainer exec instance://mxwp_api bash -c 'cd /workspace/apps/api && python -m app.scripts.sso_only_check'

- 고르는 것 — 살아 있고 `portal_access_at` 이 없는(포털 진입으로 들어온 적이 없는) 사람 계정. 서비스 계정(`MXWP_SERVICE_ACCOUNTS`)은
  빼고, 비상 관리자(`MXWP_LOCAL_LOGIN_ALLOW`)는 '비상' 으로 표시한다 — 그 계정은 켜도 비밀번호로 들어온다.
- 막히는 것은 웹 로그인뿐이다 — API 토큰 · 게이트웨이 위임은 그대로다. 같은 이메일로 포털에서 들어오면 그 계정에 그대로 이어진다.
- 읽기만 한다.
"""
from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import text

from app.scripts._env import load_env


async def never_entered() -> list[dict[str, Any]]:
    from app.core import sso_only
    from app.core.config import get_settings
    from app.core.db import session_scope

    service = {e.strip().lower() for e in get_settings().mxwp_service_accounts.split(",") if e.strip()}
    async with session_scope() as s:
        rows = (await s.execute(text("""
            SELECT email, role, last_login_at, created_at FROM users
             WHERE is_active AND portal_access_at IS NULL
             ORDER BY last_login_at DESC NULLS LAST, email
        """))).all()
    return [{"email": r[0], "role": r[1], "last_login_at": r[2], "created_at": r[3],
             "local": sso_only.local_allowed(r[0])} for r in rows if r[0].lower() not in service]


def main() -> None:
    load_env()
    from app.core.config import get_settings

    rows = asyncio.run(never_entered())
    cfg = get_settings()
    print(f"SSO 전용 — 지금 {'켜짐' if cfg.mxwp_sso_only else '꺼짐'} · 비상 관리자 {cfg.mxwp_local_login_allow or '(없음)'}")
    print(f"포털로 들어온 적 없는 사람 계정 {len(rows)} (서비스 계정 뺌) — 켜면 비상 관리자 말고는 웹 로그인을 못 한다\n")
    for r in rows:
        last = r["last_login_at"].strftime("%Y-%m-%d %H:%M") if r["last_login_at"] else "로그인 없음"
        print(f"  {'비상 ' if r['local'] else '     '}{r['email']:<40} {r['role']:<7} 마지막 로그인 {last}")
    blocked = sum(1 for r in rows if not r["local"])
    print(f"\n켜면 막히는 계정 {blocked} · 같은 이메일로 포털에서 들어오면 그 계정에 이어진다")
    print("서비스 계정은 API 토큰으로 쓰여 뺐다 — 웹으로 들어가야 하면(시험 · 비상) MXWP_LOCAL_LOGIN_ALLOW 에 넣는다")


if __name__ == "__main__":
    main()
