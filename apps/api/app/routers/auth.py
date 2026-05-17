"""인증 라우터 (Sprint 6).

POST /api/v1/auth/login        body: {email, password}
POST /api/v1/auth/login/totp   body: {partial_token, code}  (Cycle 17)
POST /api/v1/auth/refresh      cookie: mxwp_refresh
POST /api/v1/auth/logout
POST /api/v1/auth/signup       body: {email, name, password, team_id, group_id?}
GET  /api/v1/me
"""
from __future__ import annotations

import time
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError, Unauthorized, envelope
from app.core.security import (
    decode_token,
    make_access_token,
    make_refresh_token,
    verify_password,
)
from app.routers.two_factor import verify_totp_for_user
from app.services.signup_service import create_user_account

router = APIRouter(prefix="/api/v1", tags=["auth"])

REFRESH_COOKIE = "mxwp_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth"

# Cycle 17 — short-lived JWT minted after the password step succeeds for a
# user who has 2FA enabled. The FE swaps it for a real access token at
# /auth/login/totp by attaching the 6-digit code (or a backup code).
_PARTIAL_TYP = "totp_partial"
_PARTIAL_TTL_SECONDS = 5 * 60


class LoginIn(BaseModel):
    # email_validator 미설치 환경 호환 — 패턴은 매우 느슨, 실제 검증은
    # DB 의 unique email 제약 + verify_password 로 대신함.
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=200)


class LoginTotpIn(BaseModel):
    partial_token: str = Field(..., min_length=8, max_length=4096)
    code: str = Field(..., min_length=6, max_length=20)


def _make_partial_token(user_id: str) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "typ": _PARTIAL_TYP,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=_PARTIAL_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def _decode_partial_token(token: str) -> str:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except JWTError as e:
        raise Unauthorized("Invalid or expired partial token") from e
    if payload.get("typ") != _PARTIAL_TYP:
        raise Unauthorized("Wrong partial token type")
    sub = payload.get("sub")
    if not sub:
        raise Unauthorized("Partial token missing sub")
    return str(sub)


def _user_payload(row: Any) -> dict[str, Any]:
    return {
        "id": str(row[0]),
        "email": row[1],
        "name": row[2],
        "role": row[3],
        "team_id": str(row[4]) if row[4] else None,
    }


async def _set_refresh_cookie(response: Response, token: str) -> None:
    s = get_settings()
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=token,
        max_age=s.jwt_refresh_ttl_seconds,
        httponly=True,
        secure=(s.app_env != "development"),
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
    )


async def _issue_session(
    response: Response, user: dict[str, Any], s: AsyncSession
) -> dict[str, Any]:
    """Bump last_login + mint access/refresh tokens. Shared between the
    plain-password and the TOTP-exchange paths."""
    try:
        await s.execute(
            text("UPDATE users SET last_login_at = NOW() WHERE id = CAST(:id AS uuid)"),
            {"id": user["id"]},
        )
        await s.commit()
    except Exception:
        await s.rollback()

    access = make_access_token(user["id"], extra={"role": user["role"]})
    refresh = make_refresh_token(user["id"])
    await _set_refresh_cookie(response, refresh)

    settings = get_settings()
    return envelope(
        data={
            "access_token": access,
            "refresh_token": refresh,
            "token_type": "Bearer",
            "expires_in": settings.jwt_access_ttl_seconds,
            "user": user,
        }
    )


@router.post("/auth/login")
async def login(
    payload: LoginIn,
    response: Response,
    s: AsyncSession = Depends(get_db),
) -> Any:
    row = (await s.execute(
        text("""
            SELECT id, email, name, role, team_id, password_hash, is_active,
                   totp_enabled_at
            FROM users WHERE email = :e
        """),
        {"e": payload.email},
    )).first()
    if not row or not bool(row[6]):
        raise Unauthorized("Invalid credentials")
    if not verify_password(payload.password, row[5]):
        raise Unauthorized("Invalid credentials")

    user = _user_payload(row)

    # Cycle 17 — if 2FA is enabled, stop here. Hand the FE a short-lived
    # partial token; the second leg is /auth/login/totp.
    if row[7] is not None:
        partial = _make_partial_token(user["id"])
        body = envelope(
            error={
                "code": "TOTP_REQUIRED",
                "http_status": 401,
                "message": "TOTP code required",
                "details": {
                    "partial_token": partial,
                    "expires_in": _PARTIAL_TTL_SECONDS,
                },
            }
        )
        return JSONResponse(status_code=401, content=body)

    return await _issue_session(response, user, s)


@router.post("/auth/login/totp")
async def login_totp(
    payload: LoginTotpIn,
    response: Response,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    user_id = _decode_partial_token(payload.partial_token)
    row = (await s.execute(
        text("""
            SELECT id, email, name, role, team_id, password_hash, is_active,
                   totp_enabled_at
            FROM users WHERE id = CAST(:id AS uuid)
        """),
        {"id": user_id},
    )).first()
    if not row or not bool(row[6]):
        raise Unauthorized("User no longer active")
    if row[7] is None:
        # 2FA was disabled between the password step and now — refuse to
        # exchange so the FE re-runs the plain login flow.
        raise Unauthorized("2FA is not enabled for this user")

    if not await verify_totp_for_user(s, user_id, payload.code):
        raise Unauthorized("Invalid TOTP or backup code")

    user = _user_payload(row)
    return await _issue_session(response, user, s)


@router.post("/auth/refresh")
async def refresh(
    request: Request,
    response: Response,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise Unauthorized("Refresh cookie missing")
    try:
        payload = decode_token(token)
    except ValueError as e:
        raise Unauthorized("Invalid refresh token") from e
    if payload.get("typ") != "refresh":
        raise Unauthorized("Wrong token type")
    sub = payload.get("sub")
    if not sub:
        raise Unauthorized("Token missing sub")

    row = (await s.execute(
        text("""
            SELECT id, email, name, role, team_id, password_hash, is_active
            FROM users WHERE id = CAST(:id AS uuid)
        """),
        {"id": sub},
    )).first()
    if not row or not bool(row[6]):
        raise Unauthorized("User no longer active")

    user = _user_payload(row)
    access = make_access_token(user["id"], extra={"role": user["role"]})
    settings = get_settings()
    return envelope(
        data={
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": settings.jwt_access_ttl_seconds,
        }
    )


@router.post("/auth/logout", status_code=204)
async def logout(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)


@router.get("/me")
async def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return envelope(data=user)


# ── Signup ──────────────────────────────────────────────────────────


class SignupBody(BaseModel):
    # Format validation lives in signup_service (_check_email_format); the
    # pydantic side just bounds the string length so a 10 MB body can't
    # waste CPU on regex.
    email: str = Field(min_length=3, max_length=320)
    name: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=12, max_length=200)
    team_id: UUID
    group_id: UUID | None = None


# Tiny in-memory IP rate limit (5/min). Restart-bounded, which is fine
# for a self-signup flow; if abuse becomes real, move to Redis.
_SIGNUP_RATE_WINDOW = 60.0
_SIGNUP_RATE_LIMIT = 5
_signup_hits: dict[str, list[float]] = {}


class _SignupRateLimited(APIError):
    http_status = 429
    code = "RATE_LIMITED"
    message = f"signup limited to {_SIGNUP_RATE_LIMIT}/min per IP"


def _signup_ip_key(request: Request) -> str:
    if request.client is None:
        return "unknown"
    return request.client.host


def _signup_rate_ok(key: str) -> bool:
    now = time.monotonic()
    cutoff = now - _SIGNUP_RATE_WINDOW
    hits = [t for t in _signup_hits.get(key, []) if t > cutoff]
    if len(hits) >= _SIGNUP_RATE_LIMIT:
        _signup_hits[key] = hits
        return False
    hits.append(now)
    _signup_hits[key] = hits
    return True


@router.post("/auth/signup", status_code=201)
async def signup(
    body: SignupBody,
    request: Request,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if not _signup_rate_ok(_signup_ip_key(request)):
        raise _SignupRateLimited()
    user = await create_user_account(
        s,
        email=str(body.email),
        name=body.name,
        password=body.password,
        team_id=body.team_id,
        group_id=body.group_id,
        request_ip=request.client.host if request.client else None,
    )
    return envelope(data={"user": user})
