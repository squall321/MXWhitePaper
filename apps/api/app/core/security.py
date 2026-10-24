"""JWT + password hashing utilities (skeleton for Sprint 6)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import JWTError, jwt

from .config import get_settings

_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False


def make_access_token(sub: str, extra: dict[str, Any] | None = None) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=s.jwt_access_ttl_seconds)).timestamp()),
        "typ": "access",
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def make_refresh_token(sub: str, ttl_seconds: int | None = None) -> str:
    s = get_settings()
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": sub,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds or s.jwt_refresh_ttl_seconds)).timestamp()),
        "typ": "refresh",
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def make_delegated_token(
    sub: str, *, client: str, generation: int, email: str, secret_tag: str, ttl_seconds: int,
) -> str:
    """게이트웨이 · 포털 위임 토큰(typ=delegated) — 그 사람 명의 · 범위 read + write.

    검증은 core/auth `_resolve_delegated` — 세대(`gen`)가 sso_delegations 와 같고 위임 비밀 지문(`sk`)이 지금 비밀과 같을 때만
    산다. `eml` 은 게이트웨이가 발급 때 실은 이메일 글자 그대로다(소속 · 플랫폼 증명의 서명 대상).
    """
    s = get_settings()
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": sub,
        "typ": "delegated",
        "cli": client,
        "gen": generation,
        "eml": email,
        "sk": secret_tag,
        "scope": ["read", "write"],
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    s = get_settings()
    try:
        return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])
    except JWTError as e:
        raise ValueError(f"invalid token: {e}") from e
