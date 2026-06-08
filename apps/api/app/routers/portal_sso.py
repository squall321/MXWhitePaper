"""HWAX Portal SSO callback — true single sign-on.

Flow: the user is logged into the HWAX portal and clicks the MX White Paper tile. The portal mints
a short-lived RS256 "launch" JWT (aud = this service) and auto-POSTs it here. We:
  1. fetch the portal's JWKS (cached) and verify the token (RS256, aud, exp, scope=launch),
  2. upsert the user by email (auto-create on first SSO — sensible for corp AD identities),
  3. start a LOCAL session (reuse the existing _issue_session machinery via cookies),
  4. redirect the browser into the app — already logged in.

Disabled (404) unless `portal_jwks_url` is set, so standalone deploys are unaffected. The local
email/password login still works as a fallback.
"""
from __future__ import annotations

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

from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError
from app.core.security import hash_password, make_refresh_token
# Reuse the canonical refresh-cookie setter from the auth router so the cookie name/path/flags match
# exactly what /auth/refresh (called by the SPA bootstrap) expects.
from app.routers.auth import _set_refresh_cookie

router = APIRouter(prefix="/api/v1/auth", tags=["portal-sso"])

# Tiny in-process JWKS cache + replay guard (single-process uvicorn). For multi-replica, back these
# with Redis — same seam as the rest of the app.
_jwks_cache: dict[str, Any] = {"keys": None, "fetched": 0.0}
_seen_jti: dict[str, float] = {}


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


def _gc_jti(now: float) -> None:
    for k, exp in list(_seen_jti.items()):
        if exp < now:
            del _seen_jti[k]


async def _verify_portal_token(token: str) -> dict[str, Any]:
    s = get_settings()
    keys = await _portal_jwks()
    try:
        header = jwt.get_unverified_header(token)
    except Exception as e:  # noqa: BLE001
        raise APIError(status_code=401, code="bad_token", message="malformed launch token") from e
    key = next((k for k in keys if k.get("kid") == header.get("kid")), None) or (keys[0] if keys else None)
    if key is None:
        raise APIError(status_code=401, code="no_key", message="portal JWKS has no usable key")
    try:
        claims = jwt.decode(
            token, key, algorithms=["RS256"], audience=s.portal_audience,
            options={"require": ["exp", "aud", "sub", "jti"]},
        )
    except Exception as e:  # noqa: BLE001
        raise APIError(status_code=401, code="invalid_token", message="launch token rejected") from e
    if claims.get("scope") != "launch":
        raise APIError(status_code=401, code="wrong_scope", message="not a launch token")
    now = time.time()
    _gc_jti(now)
    jti = claims["jti"]
    if jti in _seen_jti:
        raise APIError(status_code=401, code="replay", message="launch token already used")
    _seen_jti[jti] = float(claims["exp"])
    return claims


async def _upsert_user(s: AsyncSession, *, email: str, name: str) -> dict[str, Any]:
    row = (await s.execute(
        text("SELECT id, email, name, role, team_id FROM users WHERE LOWER(email) = LOWER(:e)"),
        {"e": email},
    )).first()
    if row:
        return {"id": str(row[0]), "email": row[1], "name": row[2], "role": row[3], "team_id": str(row[4]) if row[4] else None}

    # First SSO login → auto-create (matches signup_service column set). SSO users have no password,
    # so we store a random hash the local password path can never match. Attach to the first team.
    team = (await s.execute(text("SELECT id FROM teams LIMIT 1"))).scalar()
    if team is None:
        raise APIError(status_code=503, code="no_team", message="no team configured — run seed first")
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
    return {"id": uid, "email": email, "name": name, "role": role, "team_id": str(team)}


@router.post("/portal-callback")
async def portal_callback(
    request: Request,
    token: str = Form(...),
    s: AsyncSession = Depends(get_db),
) -> Response:
    cfg = get_settings()
    if not cfg.portal_jwks_url:
        raise APIError(status_code=404, code="sso_disabled", message="portal SSO not enabled")

    claims = await _verify_portal_token(token)
    user = await _upsert_user(s, email=claims["email"], name=claims.get("name") or "")

    try:
        await s.execute(text("UPDATE users SET last_login_at = NOW() WHERE id = CAST(:id AS uuid)"), {"id": user["id"]})
        await s.commit()
    except Exception:
        await s.rollback()

    # Set ONLY the refresh cookie (same name/path/flags as the password login). We redirect into the
    # app; its bootstrap calls /auth/refresh on load, which reads this cookie and mints the access
    # token — so the user lands logged in with no second login and no token in any URL.
    resp = RedirectResponse(url=cfg.portal_sso_landing, status_code=303)
    await _set_refresh_cookie(resp, make_refresh_token(user["id"]))
    return resp
