"""Two-factor authentication (TOTP) router (Cycle 17).

Endpoints (all under ``/api/v1``):

  - POST /me/2fa/setup
      Stage a fresh secret + 8 backup codes. Requires the user to confirm
      their password in the body. Nothing is persisted yet — instead the
      secret is wrapped in a SHORT-LIVED signed JWT (the "stage token")
      that the FE echoes back on /verify. This avoids a half-configured
      row in users on abandoned setups.

  - POST /me/2fa/verify {stage_token, code}
      Validate the first 6-digit code against the staged secret. On
      success, write ``totp_secret``, ``totp_enabled_at`` = NOW(), and
      argon2-hash + persist the staged backup codes.

  - POST /me/2fa/disable {password, code_or_backup}
      Wipe ``totp_secret`` / ``totp_enabled_at`` / ``totp_backup_codes``.
      Requires both password AND a valid current TOTP code (or a backup
      code) so a stolen session token alone cannot disable 2FA.

  - POST /me/2fa/regenerate-backup-codes {code}
      Rotate the 8 backup codes. Old codes are dropped. Plaintext is
      returned exactly once.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import Unauthorized, ValidationFailed, envelope
from app.core.security import hash_password, verify_password
from app.services.totp import (
    BACKUP_USED_MARKER,
    generate_backup_codes,
    generate_secret,
    normalise_backup_code,
    provisioning_uri,
    verify_code,
)

router = APIRouter(prefix="/api/v1", tags=["two_factor"])


# Stage token: short-lived JWT that carries the proposed (yet-unpersisted)
# secret + backup codes between /setup and /verify. 10 minutes is plenty
# for a user to scan a QR + type the first code, and a leaked stage token
# is useless without the password to mint a fresh one anyway.
_STAGE_TTL_SECONDS = 10 * 60
_STAGE_TYP = "totp_stage"


class SetupIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


class VerifyIn(BaseModel):
    stage_token: str = Field(..., min_length=8, max_length=4096)
    code: str = Field(..., min_length=6, max_length=12)


class DisableIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)
    code: str = Field(..., min_length=6, max_length=20)


class RegenIn(BaseModel):
    code: str = Field(..., min_length=6, max_length=20)


def _make_stage_token(
    user_id: str, secret: str, backup_codes: list[str]
) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "typ": _STAGE_TYP,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=_STAGE_TTL_SECONDS)).timestamp()),
        "totp_secret": secret,
        "backup_codes": backup_codes,
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def _decode_stage_token(token: str, *, expected_user_id: str) -> dict[str, Any]:
    s = get_settings()
    try:
        payload = jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except JWTError as e:
        raise Unauthorized("Invalid or expired stage token") from e
    if payload.get("typ") != _STAGE_TYP:
        raise Unauthorized("Wrong stage token type")
    if payload.get("sub") != expected_user_id:
        raise Unauthorized("Stage token user mismatch")
    return payload


async def _fetch_user_secrets(
    s: AsyncSession, user_id: str
) -> tuple[str | None, datetime | None, list[str], str]:
    """Return (totp_secret, totp_enabled_at, backup_hashes, password_hash)."""
    row = (
        await s.execute(
            text(
                """
                SELECT totp_secret, totp_enabled_at, totp_backup_codes,
                       password_hash
                FROM users WHERE id = CAST(:uid AS uuid)
                """
            ),
            {"uid": user_id},
        )
    ).first()
    if not row:
        raise Unauthorized("User not found")
    raw_codes = row[2]
    if isinstance(raw_codes, str):
        # JSONB sometimes round-trips as a string depending on driver.
        import json as _json
        try:
            raw_codes = _json.loads(raw_codes)
        except Exception:  # noqa: BLE001
            raw_codes = []
    if not isinstance(raw_codes, list):
        raw_codes = []
    return row[0], row[1], [str(x) for x in raw_codes], row[3]


async def _consume_backup_code(
    s: AsyncSession, user_id: str, plaintext: str, backup_hashes: list[str]
) -> bool:
    """Match ``plaintext`` against the unused argon2 hashes; mark on hit."""
    norm = normalise_backup_code(plaintext)
    if not norm:
        return False
    matched_idx: int | None = None
    for i, h in enumerate(backup_hashes):
        if h == BACKUP_USED_MARKER:
            continue
        try:
            if verify_password(norm, h):
                matched_idx = i
                break
        except Exception:  # noqa: BLE001
            continue
    if matched_idx is None:
        return False
    backup_hashes[matched_idx] = BACKUP_USED_MARKER
    import json as _json
    await s.execute(
        text(
            "UPDATE users SET totp_backup_codes = CAST(:c AS jsonb) "
            "WHERE id = CAST(:uid AS uuid)"
        ),
        {"c": _json.dumps(backup_hashes), "uid": user_id},
    )
    await s.commit()
    return True


async def verify_totp_for_user(
    s: AsyncSession,
    user_id: str,
    code: str,
    *,
    allow_backup: bool = True,
) -> bool:
    """Shared verify path used by /me/2fa/* and the login flow.

    Tries the live TOTP code first; on miss falls through to the backup
    code list (if ``allow_backup`` is True). Backup hits are consumed
    atomically inside the same DB session.
    """
    secret, _enabled_at, hashes, _pw = await _fetch_user_secrets(s, user_id)
    if not secret:
        return False
    if verify_code(secret, code):
        return True
    if allow_backup:
        return await _consume_backup_code(s, user_id, code, hashes)
    return False


# ── /me/2fa/setup ──────────────────────────────────────────────────────────


@router.post("/me/2fa/setup")
async def setup(
    payload: SetupIn,
    user: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _secret, enabled_at, _hashes, pw_hash = await _fetch_user_secrets(
        s, user["id"]
    )
    if not verify_password(payload.password, pw_hash):
        raise Unauthorized("Password confirmation failed")
    if enabled_at is not None:
        raise ValidationFailed(
            "2FA is already enabled — disable it before re-running setup"
        )

    secret = generate_secret()
    backup_codes = generate_backup_codes()
    stage_token = _make_stage_token(user["id"], secret, backup_codes)
    qr_uri = provisioning_uri(secret, account=user["email"])

    return envelope(
        data={
            "secret": secret,
            "qr_uri": qr_uri,
            "backup_codes": backup_codes,
            "stage_token": stage_token,
            "expires_in": _STAGE_TTL_SECONDS,
        }
    )


# ── /me/2fa/verify ─────────────────────────────────────────────────────────


@router.post("/me/2fa/verify")
async def verify(
    payload: VerifyIn,
    user: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    stage = _decode_stage_token(payload.stage_token, expected_user_id=user["id"])
    secret = str(stage.get("totp_secret") or "")
    backup_codes = stage.get("backup_codes") or []
    if not secret or not isinstance(backup_codes, list):
        raise Unauthorized("Stage token missing fields")
    if not verify_code(secret, payload.code):
        raise ValidationFailed("Invalid TOTP code")

    # Hash the *normalised* form (uppercase, no separators) so verify
    # input — also normalised — matches regardless of how the user types
    # the code back in (with or without the cosmetic hyphen).
    backup_hashes = [
        hash_password(normalise_backup_code(str(c))) for c in backup_codes
    ]
    import json as _json
    await s.execute(
        text(
            """
            UPDATE users
               SET totp_secret = :sec,
                   totp_enabled_at = NOW(),
                   totp_backup_codes = CAST(:codes AS jsonb)
             WHERE id = CAST(:uid AS uuid)
            """
        ),
        {
            "sec": secret,
            "codes": _json.dumps(backup_hashes),
            "uid": user["id"],
        },
    )
    await s.commit()
    return envelope(data={"enabled": True})


# ── /me/2fa/disable ────────────────────────────────────────────────────────


@router.post("/me/2fa/disable")
async def disable(
    payload: DisableIn,
    user: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _secret, enabled_at, _hashes, pw_hash = await _fetch_user_secrets(
        s, user["id"]
    )
    if enabled_at is None:
        raise ValidationFailed("2FA is not enabled")
    if not verify_password(payload.password, pw_hash):
        raise Unauthorized("Password confirmation failed")
    if not await verify_totp_for_user(s, user["id"], payload.code):
        raise Unauthorized("Invalid TOTP or backup code")

    await s.execute(
        text(
            """
            UPDATE users
               SET totp_secret = NULL,
                   totp_enabled_at = NULL,
                   totp_backup_codes = '[]'::jsonb
             WHERE id = CAST(:uid AS uuid)
            """
        ),
        {"uid": user["id"]},
    )
    await s.commit()
    return envelope(data={"disabled": True})


# ── /me/2fa/regenerate-backup-codes ────────────────────────────────────────


@router.post("/me/2fa/regenerate-backup-codes")
async def regenerate_backup_codes(
    payload: RegenIn,
    user: dict[str, Any] = Depends(require_reader),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    _secret, enabled_at, _hashes, _pw = await _fetch_user_secrets(s, user["id"])
    if enabled_at is None:
        raise ValidationFailed("2FA is not enabled")
    # Disallow backup codes here — caller must have a live TOTP. Otherwise
    # someone with a single backup code could spin up unlimited new ones.
    if not await verify_totp_for_user(s, user["id"], payload.code, allow_backup=False):
        raise Unauthorized("Invalid TOTP code")

    new_codes = generate_backup_codes()
    new_hashes = [hash_password(normalise_backup_code(c)) for c in new_codes]
    import json as _json
    await s.execute(
        text(
            "UPDATE users SET totp_backup_codes = CAST(:c AS jsonb) "
            "WHERE id = CAST(:uid AS uuid)"
        ),
        {"c": _json.dumps(new_hashes), "uid": user["id"]},
    )
    await s.commit()
    return envelope(data={"backup_codes": new_codes})
