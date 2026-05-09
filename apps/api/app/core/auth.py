"""인증/인가 dependency (Sprint 6).

  - get_current_user(request) — Bearer JWT 우선, 없으면 development 환경에 한해
    admin 사용자로 폴백 (Sprint 5 호환). production 에선 401.
  - 0023: bearer 가 `mxwp_` 로 시작하면 personal access token 으로 해석한다.
    api_tokens.token_prefix 로 후보를 좁히고 argon2 로 평문을 검증.
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
from .security import decode_token, verify_password

ROLE_ORDER: dict[str, int] = {
    "reader": 1,
    "editor": 2,
    "owner": 3,
    "admin": 4,
}

# 0023 — personal API token namespace + prefix length. Mirrored in
# `routers/api_tokens.py` (single source of truth lives there but we copy
# the constants here to avoid an import cycle: routers ↔ core/auth).
_API_TOKEN_NAMESPACE = "mxwp_"
_API_TOKEN_PREFIX_LEN = 8


async def _fetch_user_by_id(s: AsyncSession, uid: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text("""
            SELECT id, email, name, role, team_id, is_active, email_verified_at
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
        "email_verified_at": row[6].isoformat() if row[6] else None,
    }


async def _fetch_admin(s: AsyncSession) -> dict[str, Any] | None:
    row = (await s.execute(text("""
        SELECT id, email, name, role, team_id, is_active, email_verified_at
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
        "email_verified_at": row[6].isoformat() if row[6] else None,
    }


async def _resolve_api_token(
    s: AsyncSession, full_token: str
) -> dict[str, Any] | None:
    """Return the token's user (or None on any failure).

    1. Strip the `mxwp_` namespace, take the first 8 chars as the prefix.
    2. Look up candidate rows by `token_prefix` (indexed). There may be
       multiple — argon2-verify each `token_hash` against the full plaintext
       until one matches.
    3. Reject if revoked_at IS NOT NULL or expires_at < NOW().
    4. Bump `last_used_at` so the UI can show "마지막 사용".
    """
    body = full_token[len(_API_TOKEN_NAMESPACE):]
    if len(body) < _API_TOKEN_PREFIX_LEN:
        return None
    prefix = body[:_API_TOKEN_PREFIX_LEN]

    rows = (await s.execute(
        text("""
            SELECT id, user_id, token_hash, revoked_at, expires_at
            FROM api_tokens
            WHERE token_prefix = :p
        """),
        {"p": prefix},
    )).all()
    if not rows:
        return None

    matched_id: str | None = None
    matched_user_id: str | None = None
    for row in rows:
        if row[3] is not None:
            continue
        if row[4] is not None:
            # expires_at < NOW() — ask the DB to do the comparison so the
            # tz handling matches the column.
            from datetime import UTC, datetime
            if row[4] <= datetime.now(UTC):
                continue
        try:
            if verify_password(full_token, row[2]):
                matched_id = str(row[0])
                matched_user_id = str(row[1])
                break
        except Exception:  # noqa: BLE001
            continue

    if matched_user_id is None or matched_id is None:
        return None

    user = await _fetch_user_by_id(s, matched_user_id)
    if not user:
        return None

    # last_used_at refresh — fire-and-forget; don't block auth on commit issues.
    try:
        await s.execute(
            text(
                "UPDATE api_tokens SET last_used_at = NOW() "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"id": matched_id},
        )
        await s.commit()
    except Exception:  # noqa: BLE001
        await s.rollback()

    return user


async def get_current_user(
    request: Request, s: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    settings = get_settings()
    auth_header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(None, 1)[1].strip()

        # 0023 — personal API token path. JWT path stays unchanged below.
        if token.startswith(_API_TOKEN_NAMESPACE):
            user = await _resolve_api_token(s, token)
            if not user:
                raise Unauthorized("Invalid or revoked API token")
            return user

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
