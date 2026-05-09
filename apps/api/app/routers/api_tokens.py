"""Personal API tokens 라우터 (Cycle 0023).

각 사용자가 스크립트/CI 에서 API 를 호출하기 위해 발급하는 *personal access
token* 을 관리한다. 토큰 형식은 `mxwp_` + 26자 base32. 평문 토큰은 *생성 직후
1회* 만 응답에 노출되고 이후 모든 read 응답은 prefix 만 보여 준다.

엔드포인트 (모두 prefix `/api/v1`):
  - POST   /me/api-tokens               reader+ — body: {name, scopes?, expires_at?}
  - GET    /me/api-tokens               reader+ — list (masked)
  - DELETE /me/api-tokens/:id           owner   — soft revoke (revoked_at = NOW)
  - POST   /me/api-tokens/:id/rotate    owner   — revoke 후 같은 name/scopes 로 재발급

Scopes 는 ['read', 'write', 'admin'] 의 부분집합으로 저장만 한다 (v1 enforcement
deferred). 미들웨어에서의 scope 체크는 추후 작업 — 우선은 토큰의 user role 이
그대로 적용된다.
"""
from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Path, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_reader
from app.core.db import get_db
from app.core.errors import APIError, Forbidden, NotFound, envelope
from app.core.security import hash_password
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["api_tokens"])


TOKEN_NAMESPACE = "mxwp_"
TOKEN_PREFIX_LEN = 8
# 26-char base32 (Crockford) → 130 bits of entropy. crockford alphabet drops
# I/L/O/U so manual transcription stays unambiguous.
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
TOKEN_BODY_LEN = 26
VALID_SCOPES: set[str] = {"read", "write", "admin"}


class TokenValidationError(APIError):
    code = "VALIDATION_ERROR"
    http_status = 422


class TokenCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    scopes: list[str] = Field(default_factory=lambda: ["read"], max_length=10)
    expires_at: str | None = Field(default=None)  # ISO-8601 or null


def _gen_token() -> tuple[str, str]:
    """Returns (full_token, prefix). prefix is the first 8 chars after `mxwp_`."""
    body = "".join(secrets.choice(_CROCKFORD) for _ in range(TOKEN_BODY_LEN))
    return f"{TOKEN_NAMESPACE}{body}", body[:TOKEN_PREFIX_LEN]


def _validate_scopes(scopes: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for s in scopes or []:
        if not isinstance(s, str):
            continue
        v = s.strip().lower()
        if not v or v in seen:
            continue
        if v not in VALID_SCOPES:
            raise TokenValidationError(
                f"unknown scope '{v}' — allowed: {sorted(VALID_SCOPES)}",
                details={"got": v, "allowed": sorted(VALID_SCOPES)},
            )
        seen.add(v)
        cleaned.append(v)
    return cleaned or ["read"]


def _parse_expires_at(raw: str | None) -> datetime | None:
    if raw is None or raw == "":
        return None
    try:
        # accept "2026-12-31T00:00:00Z" or any ISO-8601 with offset
        s = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
    except ValueError as e:
        raise TokenValidationError(
            "expires_at must be an ISO-8601 timestamp",
            details={"got": raw},
        ) from e
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    if dt <= datetime.now(UTC):
        raise TokenValidationError(
            "expires_at must be in the future", details={"got": raw}
        )
    return dt


def _row_to_dict(row: Any) -> dict[str, Any]:
    scopes = row[5]
    if isinstance(scopes, str):
        try:
            scopes = json.loads(scopes)
        except json.JSONDecodeError:
            scopes = []
    if not isinstance(scopes, list):
        scopes = []
    return {
        "id": str(row[0]),
        "user_id": str(row[1]),
        "name": row[2],
        "token_prefix": row[3],
        "scopes": scopes,
        "last_used_at": row[6].isoformat() if row[6] else None,
        "expires_at": row[7].isoformat() if row[7] else None,
        "revoked_at": row[8].isoformat() if row[8] else None,
        "created_at": row[9].isoformat() if row[9] else None,
        "masked_token": f"{TOKEN_NAMESPACE}{row[3]}…",
    }


_SELECT_COLS = """
    SELECT id, user_id, name, token_prefix, token_hash,
           scopes, last_used_at, expires_at, revoked_at, created_at
    FROM api_tokens
"""


async def _fetch_one(s: AsyncSession, token_id: str) -> Any | None:
    return (await s.execute(
        text(f"{_SELECT_COLS} WHERE id = CAST(:id AS uuid)"),
        {"id": token_id},
    )).first()


# ── endpoints ─────────────────────────────────────────────────────────────


@router.post(
    "/me/api-tokens",
    status_code=201,
    summary="개인 API 토큰 발급 (full token 1회 노출)",
)
async def create_api_token(
    body: TokenCreate,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    scopes = _validate_scopes(body.scopes)
    expires_at = _parse_expires_at(body.expires_at)
    full_token, prefix = _gen_token()
    token_hash = hash_password(full_token)

    # UNIQUE (user_id, name) — surface friendly error on dup
    dup = (await s.execute(
        text(
            "SELECT 1 FROM api_tokens "
            "WHERE user_id = CAST(:u AS uuid) AND name = :n"
        ),
        {"u": user["id"], "n": body.name},
    )).first()
    if dup:
        raise TokenValidationError(
            f"a token named '{body.name}' already exists for this user",
            details={"name": body.name},
        )

    row = (await s.execute(
        text("""
            INSERT INTO api_tokens
                (user_id, name, token_prefix, token_hash, scopes, expires_at)
            VALUES
                (CAST(:u AS uuid), :n, :p, :h, CAST(:sc AS jsonb), :e)
            RETURNING id
        """),
        {
            "u": user["id"],
            "n": body.name,
            "p": prefix,
            "h": token_hash,
            "sc": json.dumps(scopes),
            "e": expires_at,
        },
    )).first()
    new_id = str(row[0])

    await document_repo.insert_audit(
        s, user_id=user["id"], action="api_token.create",
        target=f"api_token:{new_id}",
        payload={"name": body.name, "scopes": scopes},
    )
    await s.commit()

    fresh = await _fetch_one(s, new_id)
    if fresh is None:
        raise NotFound("api token just created vanished")  # defensive
    out = _row_to_dict(fresh)
    return envelope(data={**out, "token": full_token})


@router.get("/me/api-tokens", summary="내 API 토큰 목록 (마스킹)")
async def list_api_tokens(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text(f"""
            {_SELECT_COLS}
            WHERE user_id = CAST(:u AS uuid)
            ORDER BY created_at DESC
        """),
        {"u": user["id"]},
    )).all()
    items = [_row_to_dict(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.delete(
    "/me/api-tokens/{token_id}",
    status_code=204,
    summary="API 토큰 폐기 (soft — revoked_at = NOW)",
)
async def revoke_api_token(
    token_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> Response:
    row = await _fetch_one(s, token_id)
    if row is None:
        raise NotFound("api token not found")
    if str(row[1]) != user["id"]:
        raise Forbidden("only the owner may revoke this token")
    if row[8] is not None:
        # already revoked — idempotent 204
        return Response(status_code=204)
    await s.execute(
        text(
            "UPDATE api_tokens SET revoked_at = NOW() "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": token_id},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="api_token.revoke",
        target=f"api_token:{token_id}",
        payload={},
    )
    await s.commit()
    return Response(status_code=204)


@router.post(
    "/me/api-tokens/{token_id}/rotate",
    summary="API 토큰 재발급 (기존 폐기 + 같은 이름/scope 로 신규 발급)",
)
async def rotate_api_token(
    token_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    row = await _fetch_one(s, token_id)
    if row is None:
        raise NotFound("api token not found")
    if str(row[1]) != user["id"]:
        raise Forbidden("only the owner may rotate this token")
    if row[8] is not None:
        raise TokenValidationError(
            "token already revoked — create a new one instead",
            details={"id": token_id},
        )

    old = _row_to_dict(row)
    name = old["name"]
    scopes = old["scopes"] or ["read"]
    expires_at_iso = old["expires_at"]
    expires_at = (
        datetime.fromisoformat(expires_at_iso.replace("Z", "+00:00"))
        if expires_at_iso else None
    )

    full_token, prefix = _gen_token()
    token_hash = hash_password(full_token)

    # 1) revoke the old row
    await s.execute(
        text(
            "UPDATE api_tokens SET revoked_at = NOW() "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": token_id},
    )
    # 2) free up the unique (user_id, name) slot by tagging the old row's
    #    name with a suffix — the user-visible name now belongs to the new
    #    row. Keeps the audit trail intact (id is preserved).
    await s.execute(
        text(
            "UPDATE api_tokens SET name = name || '#rev' || extract(epoch from NOW())::bigint "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"id": token_id},
    )
    # 3) mint the new row
    new_row = (await s.execute(
        text("""
            INSERT INTO api_tokens
                (user_id, name, token_prefix, token_hash, scopes, expires_at)
            VALUES
                (CAST(:u AS uuid), :n, :p, :h, CAST(:sc AS jsonb), :e)
            RETURNING id
        """),
        {
            "u": user["id"],
            "n": name,
            "p": prefix,
            "h": token_hash,
            "sc": json.dumps(scopes),
            "e": expires_at,
        },
    )).first()
    new_id = str(new_row[0])

    await document_repo.insert_audit(
        s, user_id=user["id"], action="api_token.rotate",
        target=f"api_token:{new_id}",
        payload={"replaced": token_id, "name": name, "scopes": scopes},
    )
    await s.commit()

    fresh = await _fetch_one(s, new_id)
    if fresh is None:
        raise NotFound("api token just created vanished")  # defensive
    out = _row_to_dict(fresh)
    return envelope(data={**out, "token": full_token, "replaced_id": token_id})
