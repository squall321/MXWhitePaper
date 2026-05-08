"""인증/인가 dependency (Sprint 6).

  - get_current_user(request) — Bearer JWT 우선, 없으면 development 환경에 한해
    admin 사용자로 폴백 (Sprint 5 호환). production 에선 401.
  - require_role(*roles) — RBAC dependency factory.

User dict 형태:
  {id, email, name, role, team_id, is_active}
"""
from __future__ import annotations

from typing import Any

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .errors import Forbidden, Unauthorized
from .security import decode_token

ROLE_ORDER: dict[str, int] = {
    "reader": 1,
    "editor": 2,
    "owner": 3,
    "admin": 4,
}


async def _fetch_user_by_id(s: AsyncSession, uid: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text("""
            SELECT id, email, name, role, team_id, is_active
            FROM users WHERE id = CAST(:id AS uuid)
        """),
        {"id": uid},
    )).first()
    if not row or not bool(row[5]):
        return None
    return {
        "id": str(row[0]),
        "email": row[1],
        "name": row[2],
        "role": row[3],
        "team_id": str(row[4]) if row[4] else None,
        "is_active": bool(row[5]),
    }


async def _fetch_admin(s: AsyncSession) -> dict[str, Any] | None:
    row = (await s.execute(text("""
        SELECT id, email, name, role, team_id, is_active
        FROM users WHERE role = 'admin' AND is_active = TRUE
        ORDER BY created_at LIMIT 1
    """))).first()
    if not row:
        return None
    return {
        "id": str(row[0]),
        "email": row[1],
        "name": row[2],
        "role": row[3],
        "team_id": str(row[4]) if row[4] else None,
        "is_active": bool(row[5]),
    }


async def get_current_user(
    request: Request, s: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    settings = get_settings()
    auth_header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(None, 1)[1].strip()
        try:
            payload = decode_token(token)
        except ValueError as e:
            raise Unauthorized("Invalid or expired token") from e
        if payload.get("typ") != "access":
            raise Unauthorized("Wrong token type")
        sub = payload.get("sub")
        if not sub:
            raise Unauthorized("Token missing sub")
        user = await _fetch_user_by_id(s, sub)
        if not user:
            raise Unauthorized("User not found or inactive")
        return user

    # No token — dev fallback (Sprint 5 호환). prod 에선 401.
    if settings.app_env != "development":
        raise Unauthorized("Authentication required")
    admin = await _fetch_admin(s)
    if not admin:
        raise Unauthorized("No admin user available for dev fallback")
    return admin


def require_role(*roles: str):
    """`Depends(require_role('editor'))` — 주어진 role 이상 권한 요구."""
    if not roles:
        raise ValueError("require_role requires at least one role")
    min_level = min(ROLE_ORDER[r] for r in roles)

    async def _dep(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        user_level = ROLE_ORDER.get(user.get("role", ""), 0)
        if user_level < min_level:
            raise Forbidden(
                f"Requires role >= {min(roles, key=lambda r: ROLE_ORDER[r])}"
            )
        return user

    return _dep


# 자주 쓰이는 alias
require_reader = require_role("reader", "editor", "owner", "admin")
require_editor = require_role("editor", "owner", "admin")
require_admin = require_role("admin")
