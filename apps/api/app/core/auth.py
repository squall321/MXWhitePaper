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

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import unquote

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..services.api_token_scopes import check_scope, required_scope_for
from ..wiki import audience
from .config import get_settings
from .db import get_db
from .errors import Conflict, Forbidden, Unauthorized
from .portal_identity import secret_tag, verified_affiliation, verified_plat
from .security import decode_token, verify_password


class ScopeInsufficient(Forbidden):
    """Specialized Forbidden — token authenticates but its scopes are too narrow."""

    code = "SCOPE_INSUFFICIENT"

class WikiPageWrite(Conflict):
    """기계 호출이 위키 문서의 내용을 직접 고치려 했다 — `POST /api/v1/wiki/propose`(늘 검토)로."""

    code = "WIKI_USE_PROPOSE"


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


_USER_COLS = """
    id, email, name, role, team_id, is_active, email_verified_at,
    portal_affiliation, portal_plat, portal_access_at
"""


def _user_row(row: Any) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "email": row[1],
        "name": row[2],
        "role": row[3],
        "team_id": str(row[4]) if row[4] else None,
        "is_active": bool(row[5]),
        "email_verified_at": row[6].isoformat() if row[6] else None,
        # 포털 진입 토큰이 남긴 소속 · 플랫폼(CONTRACTS §2-10). 위임 호출이면 _resolve_delegated 가 그 호출의 증명값으로 바꾼다.
        "portal_affiliation": row[7],
        "portal_plat": list(row[8]) if row[8] is not None else None,
        "portal_access_at": row[9].isoformat() if row[9] else None,
    }


async def _fetch_user_by_id(s: AsyncSession, uid: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text(f"SELECT {_USER_COLS} FROM users WHERE id = CAST(:id AS uuid)"),
        {"id": uid},
    )).first()
    if not row or not bool(row[5]):
        return None
    return _user_row(row)


async def _fetch_admin(s: AsyncSession) -> dict[str, Any] | None:
    row = (await s.execute(text(f"""
        SELECT {_USER_COLS}
        FROM users WHERE role = 'admin' AND is_active = TRUE
        ORDER BY created_at LIMIT 1
    """))).first()
    if not row:
        return None
    return _user_row(row)


# 위임 토큰으로는 자격 증명을 다루지 않는다 — 비밀을 쥔 게이트웨이가 그 사람의 장수명 PAT 를 만들거나 2FA 를 끄는 길이 된다.
_DELEGATION_DENIED_PREFIXES = ("/api/v1/me/api-tokens", "/api/v1/me/2fa")


async def _resolve_delegated(
    s: AsyncSession, payload: dict[str, Any], request: Request
) -> dict[str, Any]:
    """게이트웨이 · 포털 위임 토큰(typ=delegated, routers/auth_sso.py) → 사람.

    산 토큰 — 위임이 켜져 있고(비밀 있음) · 비밀 지문이 지금 비밀과 같고 · 세대가 sso_delegations 와 같고 · 사람이 살아 있다.
    범위는 read + write(`/admin/*` 아님)이고 admin 역할도 owner 로 낮춘다 — AI 가 사람 명의로 admin 승인(용어 · 온톨로지 ·
    `plat:` 넓히기)을 하지 않게. 소속 · 플랫폼은 저장된 값이 아니라 **이 호출의 증명**으로만 정한다(없으면 없는 것 — 닫힌 쪽).
    """
    secret = get_settings().mxwp_sso_secret
    if not secret:
        raise Unauthorized("SSO delegation is disabled")
    sub, client, gen = payload.get("sub"), payload.get("cli"), payload.get("gen")
    if not sub or not isinstance(client, str) or not isinstance(gen, int):
        raise Unauthorized("Malformed delegated token")
    if payload.get("sk") != secret_tag(secret):
        raise Unauthorized("Delegated token from a previous secret")
    current = (await s.execute(
        text("SELECT generation FROM sso_delegations WHERE user_id = CAST(:u AS uuid) AND client = :c"),
        {"u": sub, "c": client},
    )).scalar()
    if current != gen:
        raise Unauthorized("Delegated token revoked")
    user = await _fetch_user_by_id(s, sub)
    if not user:
        raise Unauthorized("User not found or inactive")

    path = request.url.path
    if any(path == p or path.startswith(p + "/") for p in _DELEGATION_DENIED_PREFIXES):
        raise Forbidden("위임 토큰으로는 API 토큰 · 2FA 를 다루지 않는다")
    scopes = payload.get("scope") if isinstance(payload.get("scope"), list) else ["read"]
    if not check_scope(scopes, request.method, path):
        needed = required_scope_for(request.method, path)
        raise ScopeInsufficient(
            f"Token lacks {needed} scope",
            details={"required_scope": needed, "granted_scopes": scopes},
        )
    if ROLE_ORDER.get(user["role"], 0) > ROLE_ORDER["owner"]:
        user["role"] = "owner"

    email = str(payload.get("eml") or user["email"])
    aff = verified_affiliation(request.headers, secret=secret, email=email)
    plat = verified_plat(request.headers, secret=secret, email=email)
    user["portal_affiliation"] = aff
    user["portal_plat"] = plat
    user["portal_access_at"] = datetime.now(UTC).isoformat() if (aff or plat) else None
    user["auth_via"] = f"delegated:{client}"
    return user


async def _resolve_api_token(
    s: AsyncSession, full_token: str
) -> tuple[dict[str, Any], list[str]] | None:
    """Return (user, scopes) for the token (or None on any failure).

    1. Strip the `mxwp_` namespace, take the first 8 chars as the prefix.
    2. Look up candidate rows by `token_prefix` (indexed). There may be
       multiple — argon2-verify each `token_hash` against the full plaintext
       until one matches.
    3. Reject if revoked_at IS NOT NULL or expires_at < NOW().
    4. Bump `last_used_at` so the UI can show "마지막 사용".
    5. (0024) Hand the token's `scopes` array back to the caller so the
       middleware can enforce verb-vs-scope.
    """
    body = full_token[len(_API_TOKEN_NAMESPACE):]
    if len(body) < _API_TOKEN_PREFIX_LEN:
        return None
    prefix = body[:_API_TOKEN_PREFIX_LEN]

    rows = (await s.execute(
        text("""
            SELECT id, user_id, token_hash, revoked_at, expires_at, scopes
            FROM api_tokens
            WHERE token_prefix = :p
        """),
        {"p": prefix},
    )).all()
    if not rows:
        return None

    matched_id: str | None = None
    matched_user_id: str | None = None
    matched_scopes: list[str] = []
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
                raw_scopes = row[5]
                if isinstance(raw_scopes, list):
                    matched_scopes = [str(x) for x in raw_scopes]
                elif isinstance(raw_scopes, str):
                    # JSONB sometimes round-trips as the JSON-encoded string
                    # depending on the asyncpg/SA stack. Be defensive.
                    import json as _json
                    try:
                        v = _json.loads(raw_scopes)
                        matched_scopes = (
                            [str(x) for x in v] if isinstance(v, list) else []
                        )
                    except Exception:
                        matched_scopes = []
                else:
                    matched_scopes = []
                break
        except Exception:
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
    except Exception:
        await s.rollback()

    return user, matched_scopes


# 문서 내용을 바꾸는 길 — 문서 라우터 · 상태 전이(approvals). 보기 기록(/view) · 댓글 · 구독 같은 곁길은 뺀다.
_DOC_WRITE = re.compile(r"^/api/v1/documents/([^/]+)(?:/(?:versions/\d+/restore|title|infobox|variables|custom-css|"
                        r"sections/[^/]+|blocks(?:/[^/]+(?:/move)?)?|transition))?/?$")


async def _guard_wiki_writes(s: AsyncSession, request: Request, user: dict[str, Any]) -> None:
    """기계 호출(API 토큰 · 위임 — 게이트웨이 · MCP · 포털 에이전트)은 위키 문서의 내용을 옆길로 고치지 못한다(CONTRACTS §7).

    위키 문서의 쓰기는 `wiki_propose` 하나로 모은다 — 검증 · 근거 · 기록을 건너뛰는 길을 남기지 않는다. 사람의 웹 세션(사람 절 ·
    사람 관리 문서)과 위키 반영(시스템)은 그대로.
    """
    via = str(user.get("auth_via") or "")
    if request.method not in ("POST", "PUT", "PATCH", "DELETE") or not (via == "api_token" or via.startswith("delegated:")):
        return
    m = _DOC_WRITE.match(request.url.path)
    if m is None:
        return
    slug = unquote(m.group(1))
    hit = (await s.execute(text(
        "SELECT 1 FROM documents d JOIN wiki_pages wp ON wp.doc_id = d.id WHERE d.slug = :s"), {"s": slug})).first()
    if hit is not None:
        raise WikiPageWrite("위키 문서는 POST /api/v1/wiki/propose 로 고친다 — API 토큰 · 위임 호출의 직접 쓰기는 막는다",
                            details={"slug": slug})


async def get_current_user(
    request: Request, s: AsyncSession = Depends(get_db)
) -> dict[str, Any]:
    """사람을 해소하고, 이 요청의 '읽는 사람'(보이기 범위 문맥 — app/wiki/audience.py)으로 둔다."""
    user = await _resolve_current_user(request, s)
    audience.set_viewer(audience.SERVICE if audience.is_service_call(user) else audience.viewer_from_user(user))
    await _guard_wiki_writes(s, request, user)
    return user


async def _resolve_current_user(request: Request, s: AsyncSession) -> dict[str, Any]:
    settings = get_settings()
    auth_header = request.headers.get("authorization") or request.headers.get(
        "Authorization"
    )
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(None, 1)[1].strip()

        # 0023 — personal API token path. JWT path stays unchanged below.
        if token.startswith(_API_TOKEN_NAMESPACE):
            resolved = await _resolve_api_token(s, token)
            if not resolved:
                raise Unauthorized("Invalid or revoked API token")
            user, scopes = resolved
            # 0024 — verb-vs-scope enforcement. /me/* is bypassed inside
            # check_scope so the user can always inspect/revoke their own
            # tokens regardless of the granted scope.
            if not check_scope(scopes, request.method, request.url.path):
                needed = required_scope_for(request.method, request.url.path)
                raise ScopeInsufficient(
                    f"Token lacks {needed} scope",
                    details={
                        "required_scope": needed,
                        "granted_scopes": scopes,
                    },
                )
            user["auth_via"] = "api_token"
            return user

        try:
            payload = decode_token(token)
        except ValueError as e:
            raise Unauthorized("Invalid or expired token") from e
        if payload.get("typ") == "delegated":
            return await _resolve_delegated(s, payload, request)
        if payload.get("typ") != "access":
            raise Unauthorized("Wrong token type")
        sub = payload.get("sub")
        if not sub:
            raise Unauthorized("Token missing sub")
        user = await _fetch_user_by_id(s, sub)
        if not user:
            raise Unauthorized("User not found or inactive")
        return user

    # No token — dev fallback (Sprint 5 호환). 기본은 닫혀 있고, 켜야만 열린다.
    # app_env 만 보던 때는 기본값이 development 라 '설정 안 한 박스'가 곧 '인증 없는 박스'였다.
    if settings.app_env != "development" or not settings.allow_dev_admin_fallback:
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
