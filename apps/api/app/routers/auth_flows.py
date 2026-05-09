"""Auth completeness flows (Cycle 0026).

Adds the standard email-verification + password-reset endpoints on top of
the existing JWT login. Tokens are short-lived single-use entries in
``auth_tokens``; only the argon2 hash of the plaintext is persisted, so a
DB leak alone cannot impersonate a user.

Endpoints:
  - POST /api/v1/auth/email/send-verification (reader+, self) — mints
    a 24h email_verify token, sends template email.
  - POST /api/v1/auth/email/verify {token}   — marks the user as verified
    and consumes the token.
  - POST /api/v1/auth/password/forgot {email}— mints a 15-min token if
    the email matches an active user. **Always returns 200** (no leak).
  - POST /api/v1/auth/password/reset {token, new_password}.
"""
from __future__ import annotations

import secrets
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import Unauthorized, ValidationFailed, envelope
from app.core.security import hash_password, verify_password
from app.services.email import (
    password_reset_template,
    send_email,
    verify_email_template,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# Token TTLs are intentionally short — long enough that a user clicking
# from email Just Works, short enough that a leaked link is mostly inert.
_VERIFY_TTL_SECONDS = 24 * 60 * 60  # 24h
_RESET_TTL_SECONDS = 15 * 60  # 15min
_TOKEN_BYTES = 32  # 256-bit url-safe token; fits comfortably in URLs


class SendVerificationOut(BaseModel):
    sent: bool


class VerifyEmailIn(BaseModel):
    token: str = Field(..., min_length=8, max_length=512)


class ForgotPasswordIn(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)


class ResetPasswordIn(BaseModel):
    token: str = Field(..., min_length=8, max_length=512)
    new_password: str = Field(..., min_length=8, max_length=200)


def _new_token() -> str:
    return secrets.token_urlsafe(_TOKEN_BYTES)


async def _mint_token(
    s: AsyncSession,
    *,
    user_id: str,
    kind: str,
    ttl_seconds: int,
) -> str:
    """Issue a fresh token of the given kind. Returns the **plaintext**.

    Existing un-used tokens of the same kind are not revoked — multiple
    in-flight links work; whichever is consumed first wins.
    """
    plain = _new_token()
    token_hash = hash_password(plain)
    await s.execute(
        text(
            """
            INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
            VALUES (
              CAST(:uid AS uuid), :kind, :h,
              NOW() + (:ttl || ' seconds')::interval
            )
            """
        ),
        {"uid": user_id, "kind": kind, "h": token_hash, "ttl": str(ttl_seconds)},
    )
    await s.commit()
    return plain


async def _consume_token(
    s: AsyncSession, *, plaintext: str, kind: str
) -> dict[str, Any] | None:
    """Verify + mark used. Returns ``{user_id, token_id}`` on match, else None.

    Match strategy mirrors api_tokens.py: pull all candidate (user_id,
    token_hash) rows for the kind that are still alive (not used, not
    expired), then argon2-verify the plaintext against each. With token
    entropy of 256 bits collisions are astronomically rare, but even with
    many in-flight tokens the cost is bounded by ``unused × verify``.
    """
    rows = (
        await s.execute(
            text(
                """
                SELECT id, user_id, token_hash
                FROM auth_tokens
                WHERE kind = :kind
                  AND used_at IS NULL
                  AND expires_at > NOW()
                """
            ),
            {"kind": kind},
        )
    ).all()
    for row in rows:
        try:
            if verify_password(plaintext, row[2]):
                # Mark consumed atomically so a second click is a no-op.
                upd = await s.execute(
                    text(
                        """
                        UPDATE auth_tokens SET used_at = NOW()
                        WHERE id = CAST(:id AS uuid)
                          AND used_at IS NULL
                        RETURNING id
                        """
                    ),
                    {"id": str(row[0])},
                )
                if upd.first() is None:
                    # Lost the race — already consumed.
                    return None
                await s.commit()
                return {"user_id": str(row[1]), "token_id": str(row[0])}
        except Exception:  # noqa: BLE001
            # Argon2 throws on malformed hashes; just keep looking.
            continue
    return None


# ── Email verification ─────────────────────────────────────────────────────


@router.post("/email/send-verification")
async def send_verification(
    user: dict[str, Any] = Depends(get_current_user),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Mint a fresh email-verify token + send the link to the caller's address.

    Idempotent — a user with multiple unverified clicks just gets a new
    token; old ones quietly expire.
    """
    plain = await _mint_token(
        s, user_id=user["id"], kind="email_verify", ttl_seconds=_VERIFY_TTL_SECONDS
    )
    settings = get_settings()
    verify_url = f"{settings.web_base_url.rstrip('/')}/auth/verify?token={plain}"
    subject, body = verify_email_template(user.get("name") or "", verify_url)
    sent = await send_email(user["email"], subject, body)
    return envelope(data=SendVerificationOut(sent=sent).model_dump())


@router.post("/email/verify")
async def verify_email(
    payload: VerifyEmailIn,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    match = await _consume_token(s, plaintext=payload.token, kind="email_verify")
    if not match:
        raise Unauthorized("Invalid or expired verification token")

    await s.execute(
        text(
            "UPDATE users SET email_verified_at = NOW() "
            "WHERE id = CAST(:uid AS uuid) AND email_verified_at IS NULL"
        ),
        {"uid": match["user_id"]},
    )
    await s.commit()
    return envelope(data={"verified": True})


# ── Password reset ─────────────────────────────────────────────────────────


@router.post("/password/forgot")
async def forgot_password(
    payload: ForgotPasswordIn,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Always returns 200 to avoid leaking whether ``email`` exists.

    Behaviour:
      - email matches an active user → mint reset token + send email.
      - email unknown / inactive → no-op, but the same response shape is
        returned so attackers can't enumerate the user table.
    """
    row = (
        await s.execute(
            text(
                """
                SELECT id, email, name, is_active
                FROM users WHERE email = :e
                """
            ),
            {"e": payload.email},
        )
    ).first()
    if row and bool(row[3]):
        plain = await _mint_token(
            s,
            user_id=str(row[0]),
            kind="password_reset",
            ttl_seconds=_RESET_TTL_SECONDS,
        )
        settings = get_settings()
        reset_url = (
            f"{settings.web_base_url.rstrip('/')}/auth/reset?token={plain}"
        )
        subject, body = password_reset_template(row[2] or "", reset_url)
        await send_email(row[1], subject, body)

    return envelope(data={"sent": True})


@router.post("/password/reset")
async def reset_password(
    payload: ResetPasswordIn,
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if len(payload.new_password) < 8:
        raise ValidationFailed("비밀번호는 8자 이상이어야 합니다")

    match = await _consume_token(s, plaintext=payload.token, kind="password_reset")
    if not match:
        raise Unauthorized("Invalid or expired reset token")

    new_hash = hash_password(payload.new_password)
    await s.execute(
        text(
            "UPDATE users SET password_hash = :h "
            "WHERE id = CAST(:uid AS uuid)"
        ),
        {"h": new_hash, "uid": match["user_id"]},
    )
    # Defence-in-depth: also invalidate any other outstanding reset tokens
    # for this user so a leaked second link can't be reused.
    await s.execute(
        text(
            """
            UPDATE auth_tokens SET used_at = NOW()
            WHERE user_id = CAST(:uid AS uuid)
              AND kind = 'password_reset'
              AND used_at IS NULL
            """
        ),
        {"uid": match["user_id"]},
    )
    await s.commit()
    return envelope(data={"reset": True})
