"""glossary 테스트 공용 fixture/helper.

prod DB 오염 방지를 위해 생성/삭제는 항상 try/finally 로 cleanup.
"""
from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password, make_access_token


async def ensure_user(email: str, role: str) -> str:
    """idempotent: 해당 email 가진 user 가 없으면 만들고, JWT 반환."""
    async with session_scope() as s:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e"), {"e": email}
        )).first()
        if row is None:
            await s.execute(
                text(
                    "INSERT INTO users (email, name, password_hash, role) "
                    "VALUES (:e, :n, :pw, :r)"
                ),
                {"e": email, "n": email, "pw": hash_password("test1234!"), "r": role},
            )
            await s.commit()
            row = (await s.execute(
                text("SELECT id FROM users WHERE email = :e"), {"e": email}
            )).first()
        assert row is not None
        return make_access_token(str(row[0]))


async def login_admin(ac: AsyncClient) -> str:
    """seed 가 깔린 admin@mx.local 로 로그인."""
    r = await ac.post(
        "/api/v1/auth/login",
        json={"email": "admin@mx.local", "password": "admin1234!"},
    )
    assert r.status_code == 200, r.text
    return r.json()["data"]["access_token"]


async def cleanup_term_text(term: str) -> None:
    async with session_scope() as s:
        await s.execute(text("DELETE FROM terms WHERE term = :t"), {"t": term})
        await s.commit()


async def cleanup_term_id(term_id: str) -> None:
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM terms WHERE id = CAST(:id AS uuid)"),
            {"id": term_id},
        )
        await s.commit()


def unique_term(prefix: str = "gl") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


async def cleanup_terms_starting(prefix: str) -> None:
    async with session_scope() as s:
        await s.execute(
            text("DELETE FROM terms WHERE term LIKE :p"), {"p": f"{prefix}%"}
        )
        await s.commit()


async def cleanup_domain(slug: str) -> None:
    async with session_scope() as s:
        await s.execute(text("DELETE FROM term_domains WHERE slug = :s"), {"s": slug})
        await s.commit()
