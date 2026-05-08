"""인증 라우터 (Sprint 6).

POST /api/v1/auth/login    body: {email, password}
POST /api/v1/auth/refresh  cookie: mxwp_refresh
POST /api/v1/auth/logout
GET  /api/v1/me
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import Unauthorized, envelope
from app.core.security import (
    decode_token,
    make_access_token,
    make_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/api/v1", tags=["auth"])

REFRESH_COOKIE = "mxwp_refresh"
REFRESH_COOKIE_PATH = "/api/v1/auth"


class LoginIn(BaseModel):
    # email_validator 미설치 환경 호환 — 패턴은 매우 느슨, 실제 검증은
    # DB 의 unique email 제약 + verify_password 로 대신함.
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=1, max_length=200)


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


@router.post("/auth/login")
async def login(
    payload: LoginIn,
    response: Response,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = (await s.execute(
        text("""
            SELECT id, email, name, role, team_id, password_hash, is_active
            FROM users WHERE email = :e
        """),
        {"e": payload.email},
    )).first()
    if not row or not bool(row[6]):
        raise Unauthorized("Invalid credentials")
    if not verify_password(payload.password, row[5]):
        raise Unauthorized("Invalid credentials")

    user = _user_payload(row)
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
