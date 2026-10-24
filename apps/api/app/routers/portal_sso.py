"""HWAX Portal SSO callback — true single sign-on.

Flow: the user is logged into the HWAX portal and clicks the MX White Paper tile. The portal mints
a short-lived RS256 "launch" JWT (aud = this service) and auto-POSTs it here. We:
  1. fetch the portal's JWKS (cached) and verify the token (RS256, aud, exp, scope=launch),
  2. upsert the user by email (auto-create on first SSO — sensible for corp AD identities),
  3. start a LOCAL session (reuse the existing _issue_session machinery via cookies),
  4. redirect the browser into the app — already logged in.

Disabled (404) unless `portal_jwks_url` is set, so standalone deploys are unaffected. The local
email/password login still works as a fallback.

The launch token also carries the portal's view of the person (docs/llm-wiki C4): an `affiliation` claim
(absent when the portal has none) and `plat:` entries inside `groups`. We store that snapshot on the user
(`portal_*`) on every launch, and the user lands in the team mapped to that affiliation (C5) — on every
launch, not just the first (사용자 결정 10-25: 포털의 소속이 그대로 간다). 팀은 문서 권한을 가르지 않는다(역할 · 범위가
가른다) — 팀 공유 스니펫 · 템플릿 · 홈 기본값만 따라 바뀐다.

SSO 전용(`MXWP_SSO_ONLY`, app/core/sso_only.py)이면 이 진입이 사람이 들어오는 유일한 길이고, 세션(refresh)은 소속 사진
수명(24시간) 이하다 — 사진이 낡으면 화면이 진입 링크로 다시 다녀온다.
"""
from __future__ import annotations

import json
import logging
import secrets
import time
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, Form, Request, Response
from fastapi.responses import RedirectResponse
from jose import jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import sso_only
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError
from app.core.portal_identity import claims_portal_access
from app.core.security import hash_password, make_refresh_token
# Reuse the canonical refresh-cookie setter from the auth router so the cookie name/path/flags match
# exactly what /auth/refresh (called by the SPA bootstrap) expects.
from app.routers.auth import _set_refresh_cookie

router = APIRouter(prefix="/api/v1/auth", tags=["portal-sso"])
log = logging.getLogger(__name__)


# Bug fix (2026-06-09) — `APIError.__init__()` 가 `status_code`/`code` kwarg
# 를 받지 않아 4xx 분기가 모두 500 으로 떨어지던 문제. 다른 라우터들의
# 표준 패턴 (subclass + class attribute) 으로 정정.
class _SsoDisabledError(APIError):
    http_status = 404
    code = "sso_disabled"


class _BadTokenError(APIError):
    http_status = 401
    code = "bad_token"


class _NoKeyError(APIError):
    http_status = 401
    code = "no_key"


class _InvalidTokenError(APIError):
    http_status = 401
    code = "invalid_token"


class _WrongScopeError(APIError):
    http_status = 401
    code = "wrong_scope"


class _ReplayError(APIError):
    http_status = 401
    code = "replay"


class _NoTeamError(APIError):
    http_status = 503
    code = "no_team"

# Tiny in-process JWKS cache (each process fetches its own — fine). The jti replay guard lives in the DB
# (portal_launch_jti, C6): an in-memory set is per process, so two uvicorn workers would each accept the
# same launch token once.
_jwks_cache: dict[str, Any] = {"keys": None, "fetched": 0.0}


async def _portal_jwks() -> list[dict[str, Any]]:
    s = get_settings()
    now = time.time()
    if _jwks_cache["keys"] is not None and now - _jwks_cache["fetched"] < 300:
        return _jwks_cache["keys"]
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(s.portal_jwks_url)
        r.raise_for_status()
        keys = r.json().get("keys", [])
    _jwks_cache["keys"] = keys
    _jwks_cache["fetched"] = now
    return keys


async def _verify_portal_token(token: str) -> dict[str, Any]:
    s = get_settings()
    keys = await _portal_jwks()
    try:
        header = jwt.get_unverified_header(token)
    except Exception as e:  # noqa: BLE001
        raise _BadTokenError("malformed launch token") from e
    key = next((k for k in keys if k.get("kid") == header.get("kid")), None) or (keys[0] if keys else None)
    if key is None:
        raise _NoKeyError("portal JWKS has no usable key")
    try:
        # python-jose silently ignores a PyJWT-style "require": [...] list — each claim needs its own
        # require_* flag (the list form let a token without aud skip the audience check).
        claims = jwt.decode(
            token, key, algorithms=["RS256"], audience=s.portal_audience,
            options={"require_exp": True, "require_aud": True, "require_sub": True, "require_jti": True},
        )
    except Exception as e:  # noqa: BLE001
        raise _InvalidTokenError("launch token rejected") from e
    if claims.get("scope") != "launch":
        raise _WrongScopeError("not a launch token")
    return claims


async def _claim_jti(s: AsyncSession, jti: str, exp: float) -> None:
    """Spend a launch token's jti once, across processes. Expired rows go first (their tokens fail exp anyway)."""
    await s.execute(text("DELETE FROM portal_launch_jti WHERE exp < NOW()"))
    claimed = (await s.execute(
        text("""
            INSERT INTO portal_launch_jti (jti, exp) VALUES (:j, to_timestamp(:e))
            ON CONFLICT (jti) DO NOTHING RETURNING jti
        """),
        {"j": jti, "e": exp},
    )).scalar()
    await s.commit()
    if claimed is None:
        raise _ReplayError("launch token already used")


async def _find_user(s: AsyncSession, email: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text("SELECT id, email, name, role, team_id, is_active FROM users WHERE LOWER(email) = LOWER(:e)"),
        {"e": email},
    )).first()
    if row is None:
        return None
    return {"id": str(row[0]), "email": row[1], "name": row[2], "role": row[3],
            "team_id": str(row[4]) if row[4] else None, "is_active": bool(row[5])}


async def _upsert_user(s: AsyncSession, *, email: str, name: str, affiliation: str | None = None) -> dict[str, Any]:
    found = await _find_user(s, email)
    if found:
        return await _sync_team(s, found, affiliation)
    return await _create_user(s, email=email, name=name, affiliation=affiliation)


async def _sync_team(s: AsyncSession, user: dict[str, Any], affiliation: str | None) -> dict[str, Any]:
    """소속 → 팀 표에 있으면 그 팀으로 옮긴다 — 표에 없거나 소속이 없으면 그대로(관리자가 둔 팀을 지우지 않는다)."""
    if not affiliation:
        return user
    team = (await s.execute(
        text("SELECT team_id FROM wiki_aff_team_map WHERE affiliation = :a"), {"a": affiliation},
    )).scalar()
    if team is None or str(team) == user["team_id"]:
        return user
    # 다른 팀의 그룹은 비운다 — 그룹은 팀 아래에 있다
    await s.execute(text("""
        UPDATE users SET team_id = CAST(:t AS uuid),
               group_id = CASE WHEN group_id IN (SELECT id FROM groups WHERE team_id = CAST(:t AS uuid)) THEN group_id END
         WHERE id = CAST(:id AS uuid)
    """), {"t": str(team), "id": user["id"]})
    await s.execute(text("""
        INSERT INTO audit_logs (user_id, action, target, payload)
        VALUES (CAST(:id AS uuid), 'auth.portal.team_sync', :tg, CAST(:p AS JSONB))
    """), {"id": user["id"], "tg": f"user:{user['id']}",
            "p": json.dumps({"affiliation": affiliation, "from": user["team_id"], "to": str(team)})})
    await s.commit()
    return {**user, "team_id": str(team)}


async def _create_user(s: AsyncSession, *, email: str, name: str, affiliation: str | None) -> dict[str, Any]:
    # First SSO login → auto-create (matches signup_service column set). SSO users have no password,
    # so we store a random hash the local password path can never match. The team comes from the
    # admin's affiliation → team map (C5); without a mapping, the first team as before.
    team = None
    if affiliation:
        team = (await s.execute(
            text("SELECT team_id FROM wiki_aff_team_map WHERE affiliation = :a"), {"a": affiliation},
        )).scalar()
    if team is None:
        team = (await s.execute(text("SELECT id FROM teams LIMIT 1"))).scalar()
    if team is None:
        raise _NoTeamError("no team configured — run seed first")
    cfg = get_settings()
    role = cfg.portal_sso_default_role if cfg.portal_sso_default_role in ("reader", "editor", "owner", "admin") else "editor"
    uid = str(uuid4())
    await s.execute(
        text("""
            INSERT INTO users (id, email, name, password_hash, role, team_id, group_id, is_active)
            VALUES (CAST(:id AS uuid), :e, :n, :ph, :role, CAST(:t AS uuid), NULL, TRUE)
        """),
        {"id": uid, "e": email, "n": name or email.split("@")[0],
         "ph": hash_password(secrets.token_urlsafe(32)), "role": role, "t": str(team)},
    )
    await s.commit()
    return {"id": uid, "email": email, "name": name, "role": role, "team_id": str(team), "is_active": True}


@router.post("/portal-callback")
async def portal_callback(
    request: Request,
    token: str = Form(...),
    s: AsyncSession = Depends(get_db),
) -> Response:
    cfg = get_settings()
    if not cfg.portal_jwks_url:
        raise _SsoDisabledError("portal SSO not enabled")

    claims = await _verify_portal_token(token)
    await _claim_jti(s, claims["jti"], float(claims["exp"]))
    affiliation, plat = claims_portal_access(claims)
    user = await _upsert_user(s, email=claims["email"], name=claims.get("name") or "", affiliation=affiliation)

    # The launch token is the portal's whole, signed snapshot — overwrite every time (an absent affiliation
    # claim means none now; an empty plat list means none, unlike NULL = never seen).
    try:
        await s.execute(
            text("""
                UPDATE users SET last_login_at = NOW(), portal_affiliation = :a,
                       portal_plat = CAST(:p AS text[]), portal_access_at = NOW()
                WHERE id = CAST(:id AS uuid)
            """),
            {"id": user["id"], "a": affiliation, "p": plat},
        )
        await s.commit()
    except Exception:
        log.warning("portal-callback: could not record last_login / portal access", exc_info=True)
        await s.rollback()

    # Set ONLY the refresh cookie (same name/path/flags as the password login). We redirect into the
    # app; its bootstrap calls /auth/refresh on load, which reads this cookie and mints the access
    # token — so the user lands logged in with no second login and no token in any URL.
    resp = RedirectResponse(url=cfg.portal_sso_landing, status_code=303)
    ttl = sso_only.session_ttl_seconds()
    await _set_refresh_cookie(resp, make_refresh_token(user["id"], ttl_seconds=ttl), max_age=ttl)
    return resp
