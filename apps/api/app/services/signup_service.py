"""Self-signup business logic — kept out of routers/auth.py so the
router stays a thin parse+dispatch shell.

Single public entry point: `create_user_account()`. Internally it runs
input validation → email collision check → org consistency check →
INSERT into users + audit_logs in a single transaction.

Password rules and the email-domain whitelist are settings-driven so
the same code can serve a tighter prod config and a looser dev/CI one.
"""
from __future__ import annotations

import json
import re
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import APIError, Conflict, ValidationFailed
from app.core.security import hash_password


class NoTeamError(APIError):
    http_status = 503
    code = "no_team"

_PW_MIN = 12
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _check_email_format(email: str) -> None:
    if not _EMAIL_RE.match(email):
        raise ValidationFailed("invalid email format", details={"email": email})


def _check_email_domain(email: str) -> None:
    domains_str = (get_settings().signup_allowed_email_domains or "").strip()
    if not domains_str:  # empty → allow-all (dev / CI default)
        return
    allowed = {d.strip().lower() for d in domains_str.split(",") if d.strip()}
    suffix = email.lower().rsplit("@", 1)[-1]
    if suffix not in allowed:
        raise ValidationFailed(
            "email domain not allowed",
            details={"got": suffix, "allowed": sorted(allowed)},
        )


def _check_password(pw: str) -> None:
    if len(pw) < _PW_MIN:
        raise ValidationFailed(
            f"password must be at least {_PW_MIN} characters",
            details={"min_length": _PW_MIN},
        )
    if not any(c.isalpha() for c in pw):
        raise ValidationFailed("password must contain at least one letter")
    if not any(c.isdigit() for c in pw):
        raise ValidationFailed("password must contain at least one digit")
    if not any(not c.isalnum() for c in pw):
        raise ValidationFailed("password must contain at least one special character")


async def _check_email_collision(s: AsyncSession, email: str) -> None:
    """SSO-priority merge: keep it simple. Any existing row (active or
    not, sso or self) with this email blocks signup. The user is then
    nudged to SSO-login (or password-reset for the self-signup case).
    """
    row = await s.execute(
        text("SELECT 1 FROM users WHERE LOWER(email) = LOWER(:e) LIMIT 1"),
        {"e": email},
    )
    if row.scalar_one_or_none() is not None:
        raise Conflict(
            "email already registered",
            details={"email": email, "hint": "try SSO login or password reset"},
        )


async def _check_org_consistency(
    s: AsyncSession, team_id: UUID, group_id: UUID | None
) -> None:
    team_row = await s.execute(
        text("SELECT id FROM teams WHERE id = :t"), {"t": team_id}
    )
    if team_row.scalar_one_or_none() is None:
        raise ValidationFailed(
            "team_id not found", details={"team_id": str(team_id)}
        )

    if group_id is not None:
        gt_row = await s.execute(
            text("SELECT team_id FROM groups WHERE id = :g"), {"g": group_id}
        )
        gt = gt_row.scalar_one_or_none()
        if gt is None:
            raise ValidationFailed(
                "group_id not found", details={"group_id": str(group_id)}
            )
        if gt != team_id:
            raise ValidationFailed(
                "group_id does not belong to the selected team",
                details={
                    "group_team_id": str(gt),
                    "user_team_id": str(team_id),
                },
            )


async def create_user_account(
    s: AsyncSession,
    *,
    email: str,
    name: str,
    password: str,
    team_id: UUID,
    group_id: UUID | None,
    request_ip: str | None,
) -> dict[str, Any]:
    """Validate, then INSERT user + audit_log in a single transaction.

    Returns the newly created user dict (id/email/name/role/team_id/group_id)
    ready to be wrapped in the response envelope. Raises ValidationFailed
    (422) / Conflict (409) on caller-fixable problems.
    """
    _check_email_format(email)
    _check_email_domain(email)
    _check_password(password)
    name = name.strip()
    if not name:
        raise ValidationFailed("name must not be empty")

    await _check_email_collision(s, email)
    await _check_org_consistency(s, team_id, group_id)

    user_id = uuid4()
    pwd_hash = hash_password(password)

    # session.begin() is intentionally skipped — FastAPI's get_db dep
    # gives us a session whose autobegin handles the first execute(),
    # and we drive commit/rollback ourselves below so this path works
    # both inside the router (one session) and inside tests that share
    # the same session across the request.
    await s.execute(
        text("""
            INSERT INTO users (id, email, name, password_hash, role,
                               team_id, group_id, is_active)
            VALUES (:id, :email, :name, :pwh, 'reader',
                    :tid, :gid, TRUE)
        """),
        {
            "id": user_id,
            "email": email,
            "name": name,
            "pwh": pwd_hash,
            "tid": team_id,
            "gid": group_id,
        },
    )
    await s.execute(
        text("""
            INSERT INTO audit_logs (user_id, action, target, payload, ip)
            VALUES (:uid, 'user_signup', :tgt, CAST(:p AS JSONB),
                    CAST(:ip AS INET))
        """),
        {
            "uid": user_id,
            "tgt": f"user:{user_id}",
            "p": json.dumps(
                {
                    "email": email,
                    "team_id": str(team_id),
                    "group_id": str(group_id) if group_id else None,
                },
                ensure_ascii=False,
            ),
            "ip": request_ip,
        },
    )
    await s.commit()

    return {
        "id": str(user_id),
        "email": email,
        "name": name,
        "role": "reader",
        "team_id": str(team_id),
        "group_id": str(group_id) if group_id else None,
    }


async def create_user_account_self_team(
    s: AsyncSession,
    *,
    email: str,
    name: str,
    password: str,
    request_ip: str | None,
) -> dict[str, Any]:
    """Self-signup variant: auto-attach the user to the default team
    (first team, the SSO way) instead of requiring a caller-supplied
    team_id. All validation/collision/insert/audit is inherited from
    create_user_account."""
    team = (await s.execute(text("SELECT id FROM teams LIMIT 1"))).scalar()
    if team is None:
        raise NoTeamError("no team configured — run seed first")
    return await create_user_account(
        s,
        email=email,
        name=name,
        password=password,
        team_id=team,
        group_id=None,
        request_ip=request_ip,
    )
