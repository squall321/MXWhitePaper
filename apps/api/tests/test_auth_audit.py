"""G1 — audit_logs writes for /auth/login + /auth/login/totp.

Covers the three new actions added to apps/api/app/routers/auth.py:
  - auth.login         (successful password login)
  - auth.login.totp    (successful 2FA exchange)
  - auth.login.failed  (wrong password)

Each test uses a throwaway user so the seed admin's state stays clean.
"""
from __future__ import annotations

import json

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password
from app.main import app
from app.services.totp import current_code, generate_secret


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


async def _create_user(email: str, password: str) -> str:
    async with session_scope() as s:
        await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})
        row = (
            await s.execute(
                text(
                    """
                    INSERT INTO users (email, name, role, password_hash, is_active)
                    VALUES (:e, :n, 'reader', :h, TRUE)
                    RETURNING id
                    """
                ),
                {"e": email, "n": "Audit Test", "h": hash_password(password)},
            )
        ).first()
        assert row is not None
        await s.commit()
        return str(row[0])


async def _enable_totp(user_id: str) -> str:
    """Flip the user into 2FA-required state and return the shared secret."""
    secret = generate_secret()
    async with session_scope() as s:
        await s.execute(
            text(
                """
                UPDATE users
                   SET totp_secret = :sec,
                       totp_enabled_at = NOW(),
                       totp_backup_codes = CAST('[]' AS jsonb)
                 WHERE id = CAST(:uid AS uuid)
                """
            ),
            {"sec": secret, "uid": user_id},
        )
        await s.commit()
    return secret


async def _delete_user(email: str) -> None:
    async with session_scope() as s:
        # FK cascade: clear audit rows referencing this user first so the
        # users DELETE doesn't trip a constraint.
        row = (
            await s.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})
        ).first()
        if row is not None:
            await s.execute(
                text("DELETE FROM audit_logs WHERE user_id = CAST(:uid AS uuid)"),
                {"uid": str(row[0])},
            )
        await s.execute(text("DELETE FROM users WHERE email = :e"), {"e": email})
        await s.commit()


async def _audit_rows(user_id: str, action: str) -> list[dict]:
    async with session_scope() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT user_id, action, target, payload
                    FROM audit_logs
                    WHERE action = :a
                      AND user_id = CAST(:uid AS uuid)
                    ORDER BY created_at DESC
                    """
                ),
                {"a": action, "uid": user_id},
            )
        ).all()
    out = []
    for r in rows:
        payload = r[3]
        if isinstance(payload, str):
            payload = json.loads(payload)
        out.append(
            {
                "user_id": str(r[0]) if r[0] else None,
                "action": r[1],
                "target": r[2],
                "payload": payload,
            }
        )
    return out


# ── tests ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_successful_login_writes_auth_login_audit_row() -> None:
    email = "audit-login@mx.local"
    password = "AuditPass123!"
    user_id = await _create_user(email, password)
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )
        assert r.status_code == 200, r.text

        rows = await _audit_rows(user_id, "auth.login")
        assert len(rows) == 1, rows
        row = rows[0]
        assert row["user_id"] == user_id
        assert row["target"] == f"user:{user_id}"
        assert row["payload"].get("method") == "password"
        assert row["payload"].get("email") == email
    finally:
        await _delete_user(email)


@pytest.mark.asyncio
async def test_failed_login_writes_auth_login_failed_audit_row() -> None:
    email = "audit-failed@mx.local"
    password = "RightPass123!"
    user_id = await _create_user(email, password)
    try:
        async with await _client() as ac:
            r = await ac.post(
                "/api/v1/auth/login",
                json={"email": email, "password": "wrong-password-xxx"},
            )
        assert r.status_code == 401, r.text

        rows = await _audit_rows(user_id, "auth.login.failed")
        assert len(rows) == 1, rows
        row = rows[0]
        # Known email → user_id resolved (not NULL).
        assert row["user_id"] == user_id
        assert row["target"] == f"user:{user_id}"
        assert row["payload"].get("email") == email
        # Payload MUST NOT contain the attempted password.
        assert "password" not in row["payload"]
        assert "wrong-password-xxx" not in json.dumps(row["payload"])
    finally:
        await _delete_user(email)


@pytest.mark.asyncio
async def test_successful_totp_writes_auth_login_totp_audit_row() -> None:
    email = "audit-totp@mx.local"
    password = "TotpUserPass123!"
    user_id = await _create_user(email, password)
    try:
        secret = await _enable_totp(user_id)

        async with await _client() as ac:
            # 1st leg — password login returns 401 + partial_token.
            r1 = await ac.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )
            assert r1.status_code == 401, r1.text
            body1 = r1.json()
            assert body1["error"]["code"] == "TOTP_REQUIRED"
            partial = body1["error"]["details"]["partial_token"]

            # 2nd leg — exchange partial + TOTP code.
            code = current_code(secret)
            r2 = await ac.post(
                "/api/v1/auth/login/totp",
                json={"partial_token": partial, "code": code},
            )
            assert r2.status_code == 200, r2.text

        rows = await _audit_rows(user_id, "auth.login.totp")
        assert len(rows) == 1, rows
        row = rows[0]
        assert row["user_id"] == user_id
        assert row["target"] == f"user:{user_id}"
        assert row["payload"].get("method") == "totp"
        assert row["payload"].get("email") == email
    finally:
        await _delete_user(email)
