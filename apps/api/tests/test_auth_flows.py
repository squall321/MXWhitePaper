"""Cycle 0026 — email verification + password reset flows.

Coverage:
  - POST /auth/email/send-verification mints + sends, idempotent.
  - POST /auth/email/verify success path flips email_verified_at.
  - Token reuse rejected (used_at gate).
  - Expired tokens rejected.
  - Garbage / unknown tokens rejected.
  - POST /auth/password/forgot ALWAYS returns 200, even for unknown emails.
  - POST /auth/password/reset rotates the password (login with old fails,
    new succeeds) and invalidates other reset tokens for the user.
  - Short passwords rejected at /password/reset.

Reuses the dev-fallback admin user that conftest seeds, plus a freshly
created throwaway user for password-reset round-trips so we never wreck
the seed admin's password.
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password
from app.main import app


async def _client() -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ── fixtures ────────────────────────────────────────────────────────────────


@pytest.fixture(autouse=True)
async def _wipe_auth_tokens():
    async with session_scope() as s:
        await s.execute(text("DELETE FROM auth_tokens"))
        # Reset admin verification so send-verification tests start clean.
        await s.execute(
            text(
                "UPDATE users SET email_verified_at = NULL "
                "WHERE email = 'admin@mx.local'"
            )
        )
    yield
    async with session_scope() as s:
        await s.execute(text("DELETE FROM auth_tokens"))


async def _create_temp_user(email: str, password: str) -> str:
    """Insert a throwaway active reader user; return its id."""
    async with session_scope() as s:
        # Reuse the seed admin's team_id so the FK is satisfied without
        # us having to know the orgs schema.
        await s.execute(
            text("DELETE FROM users WHERE email = :e"), {"e": email}
        )
        row = (
            await s.execute(
                text(
                    """
                    INSERT INTO users (email, name, role, password_hash, is_active)
                    VALUES (:e, :n, 'reader', :h, TRUE)
                    RETURNING id
                    """
                ),
                {"e": email, "n": "Temp User", "h": hash_password(password)},
            )
        ).first()
        assert row is not None  # INSERT...RETURNING always emits one row
        await s.commit()
        return str(row[0])


async def _delete_user(email: str) -> None:
    async with session_scope() as s:
        # FK cascade: clear audit rows referencing this user first. The
        # login flow now writes auth.login / auth.login.failed audit rows,
        # so the seed-only DELETE here would trip audit_logs_user_id_fkey
        # whenever a test logged in as this throwaway user.
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


# ── send-verification ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_send_verification_returns_sent_true() -> None:
    async with await _client() as ac:
        r = await ac.post("/api/v1/auth/email/send-verification")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["sent"] is True

    # Token row created.
    async with session_scope() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT kind, used_at FROM auth_tokens "
                    "WHERE kind = 'email_verify'"
                )
            )
        ).all()
    assert len(rows) == 1
    assert rows[0][1] is None  # used_at NULL


@pytest.mark.asyncio
async def test_send_verification_idempotent_mints_multiple_tokens() -> None:
    async with await _client() as ac:
        await ac.post("/api/v1/auth/email/send-verification")
        await ac.post("/api/v1/auth/email/send-verification")
    async with session_scope() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT count(*) FROM auth_tokens WHERE kind = 'email_verify'"
                )
            )
        ).scalar_one()
    assert rows == 2


# ── verify (success + failure) ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_verify_email_success_sets_verified_at_and_consumes_token() -> None:
    """Drive the full happy path through the public API.

    We don't have direct access to the plaintext token after `_mint_token`
    persists it (only the argon2 hash is stored), so we mint a known
    plaintext via the same code path as the router by inserting a row
    whose hash matches a string we know.
    """
    from app.core.security import hash_password as _h

    plaintext = "verify-token-known-plaintext-1234567890"
    async with session_scope() as s:
        admin_id = (
            await s.execute(text("SELECT id FROM users WHERE email = 'admin@mx.local'"))
        ).scalar_one()
        await s.execute(
            text(
                """
                INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
                VALUES (CAST(:uid AS uuid), 'email_verify', :h,
                        NOW() + interval '1 hour')
                """
            ),
            {"uid": str(admin_id), "h": _h(plaintext)},
        )
        await s.commit()

    async with await _client() as ac:
        r = await ac.post("/api/v1/auth/email/verify", json={"token": plaintext})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["verified"] is True

    async with session_scope() as s:
        verified_at = (
            await s.execute(
                text("SELECT email_verified_at FROM users WHERE email = 'admin@mx.local'")
            )
        ).scalar_one()
        used_at = (
            await s.execute(
                text("SELECT used_at FROM auth_tokens WHERE kind = 'email_verify'")
            )
        ).scalar_one()
    assert verified_at is not None
    assert used_at is not None


@pytest.mark.asyncio
async def test_verify_email_token_cannot_be_reused() -> None:
    from app.core.security import hash_password as _h

    plaintext = "reuse-test-token-abc"
    async with session_scope() as s:
        admin_id = (
            await s.execute(text("SELECT id FROM users WHERE email = 'admin@mx.local'"))
        ).scalar_one()
        await s.execute(
            text(
                """
                INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
                VALUES (CAST(:uid AS uuid), 'email_verify', :h,
                        NOW() + interval '1 hour')
                """
            ),
            {"uid": str(admin_id), "h": _h(plaintext)},
        )
        await s.commit()

    async with await _client() as ac:
        r1 = await ac.post("/api/v1/auth/email/verify", json={"token": plaintext})
        r2 = await ac.post("/api/v1/auth/email/verify", json={"token": plaintext})
    assert r1.status_code == 200
    assert r2.status_code == 401


@pytest.mark.asyncio
async def test_verify_email_expired_token_rejected() -> None:
    from app.core.security import hash_password as _h

    plaintext = "expired-token-xyz"
    async with session_scope() as s:
        admin_id = (
            await s.execute(text("SELECT id FROM users WHERE email = 'admin@mx.local'"))
        ).scalar_one()
        await s.execute(
            text(
                """
                INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
                VALUES (CAST(:uid AS uuid), 'email_verify', :h,
                        NOW() - interval '1 minute')
                """
            ),
            {"uid": str(admin_id), "h": _h(plaintext)},
        )
        await s.commit()

    async with await _client() as ac:
        r = await ac.post("/api/v1/auth/email/verify", json={"token": plaintext})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_verify_email_unknown_token_rejected() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/auth/email/verify", json={"token": "no-such-token-blah"}
        )
    assert r.status_code == 401


# ── forgot-password (always-200 contract) ───────────────────────────────────


@pytest.mark.asyncio
async def test_forgot_password_always_returns_200_for_unknown_email() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/auth/password/forgot",
            json={"email": "nobody@example.com"},
        )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["sent"] is True

    # No token rows for unknown email.
    async with session_scope() as s:
        n = (
            await s.execute(
                text(
                    "SELECT count(*) FROM auth_tokens WHERE kind = 'password_reset'"
                )
            )
        ).scalar_one()
    assert n == 0


@pytest.mark.asyncio
async def test_forgot_password_for_known_user_mints_token() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/auth/password/forgot",
            json={"email": "admin@mx.local"},
        )
    assert r.status_code == 200
    async with session_scope() as s:
        n = (
            await s.execute(
                text(
                    "SELECT count(*) FROM auth_tokens WHERE kind = 'password_reset'"
                )
            )
        ).scalar_one()
    assert n == 1


# ── reset-password (round-trip on a throwaway user) ────────────────────────


@pytest.mark.asyncio
async def test_reset_password_rotates_password_and_invalidates_other_tokens() -> None:
    email = "reset-rt@mx.local"
    old_pw = "OldPass123!"
    new_pw = "BrandNewPass456!"
    await _create_temp_user(email, old_pw)
    try:
        from app.core.security import hash_password as _h

        plaintext = "reset-known-plaintext-zzz"
        plaintext_other = "reset-other-token-aaa"
        async with session_scope() as s:
            uid = (
                await s.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})
            ).scalar_one()
            for p in (plaintext, plaintext_other):
                await s.execute(
                    text(
                        """
                        INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
                        VALUES (CAST(:uid AS uuid), 'password_reset', :h,
                                NOW() + interval '15 minutes')
                        """
                    ),
                    {"uid": str(uid), "h": _h(p)},
                )
            await s.commit()

        async with await _client() as ac:
            # Old password works.
            r_login_old = await ac.post(
                "/api/v1/auth/login",
                json={"email": email, "password": old_pw},
            )
            assert r_login_old.status_code == 200, r_login_old.text

            # Reset with the known plaintext.
            r_reset = await ac.post(
                "/api/v1/auth/password/reset",
                json={"token": plaintext, "new_password": new_pw},
            )
            assert r_reset.status_code == 200, r_reset.text
            assert r_reset.json()["data"]["reset"] is True

            # Old password no longer works.
            r_old = await ac.post(
                "/api/v1/auth/login",
                json={"email": email, "password": old_pw},
            )
            assert r_old.status_code == 401

            # New password works.
            r_new = await ac.post(
                "/api/v1/auth/login",
                json={"email": email, "password": new_pw},
            )
            assert r_new.status_code == 200, r_new.text

            # The OTHER reset token for the same user is now invalidated.
            r_other = await ac.post(
                "/api/v1/auth/password/reset",
                json={"token": plaintext_other, "new_password": "AnotherPass789!"},
            )
            assert r_other.status_code == 401
    finally:
        await _delete_user(email)


@pytest.mark.asyncio
async def test_reset_password_short_password_rejected() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/auth/password/reset",
            json={"token": "anything-here", "new_password": "short"},
        )
    # Pydantic min_length kicks in first → 422.
    assert r.status_code in (400, 422)


@pytest.mark.asyncio
async def test_reset_password_unknown_token_rejected() -> None:
    async with await _client() as ac:
        r = await ac.post(
            "/api/v1/auth/password/reset",
            json={"token": "definitely-not-a-real-token-abcdefgh", "new_password": "validpass123"},
        )
    assert r.status_code == 401
