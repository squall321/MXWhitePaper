"""Document share-link router — public-link sharing with expiry/password.

Endpoints:

  - POST   /api/v1/documents/{slug}/share   (editor+) → create token + URL
  - GET    /api/v1/documents/{slug}/share   (editor+) → list active links
  - GET    /api/v1/share/{token}            (NO auth) → public document read
  - DELETE /api/v1/share/{token}            (creator|admin) → soft revoke

Tokens are `secrets.token_urlsafe(24)` strings (~32 chars). Optional
`password` is hashed with the existing argon2 helper (the project ships
argon2-cffi but no passlib/bcrypt — argon2 satisfies the "bcrypt-style hash"
requirement and avoids a new dep).

Expiry / revoked state translates to HTTP 410. Missing token → 404. Wrong or
missing password → 401. The public GET reuses the same envelope shape as
`GET /documents/{slug}` so the FE can dispatch the same renderer.
"""
from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import Forbidden, Gone, NotFound, Unauthorized, envelope
from app.core.security import hash_password, verify_password
from app.repos import document_repo
from app.services import document_service

router = APIRouter(prefix="/api/v1", tags=["sharing"])

# `secrets.token_urlsafe(24)` — 24 random bytes → 32 url-safe chars.
_TOKEN_BYTES = 24

# Crockford base32 alphabet — drops I, L, O, U so phone scans are unambiguous.
_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_SHORT_ID_LEN = 6  # 6 chars × 5 bits = 30 bits ≈ 1B values
_SHORT_ID_RETRIES = 10


def _gen_short_id() -> str:
    """Random 30-bit value → 6-char Crockford-base32 string."""
    n = secrets.randbits(_SHORT_ID_LEN * 5)
    out = []
    for _ in range(_SHORT_ID_LEN):
        out.append(_CROCKFORD[n & 0x1F])
        n >>= 5
    return "".join(reversed(out))


async def _alloc_unique_short_id(s: AsyncSession) -> str | None:
    """Try up to {_SHORT_ID_RETRIES} times to mint a fresh short_id. Returns
    `None` if every attempt collided — caller should still ship the token."""
    for _ in range(_SHORT_ID_RETRIES):
        candidate = _gen_short_id()
        row = (await s.execute(
            text("SELECT 1 FROM share_links WHERE short_id = :sid"),
            {"sid": candidate},
        )).first()
        if row is None:
            return candidate
    return None


class CreateShareIn(BaseModel):
    """Body for POST /documents/{slug}/share."""

    expires_at: datetime | None = Field(
        default=None,
        description="ISO datetime in UTC. Past values are rejected (422).",
    )
    password: str | None = Field(
        default=None,
        min_length=4,
        max_length=200,
        description="Optional password gate; hashed with argon2.",
    )
    notify_emails: list[str] = Field(
        default_factory=list,
        max_length=20,
        description=(
            "선택적으로 share-link 안내 메일을 보낼 수신자 목록. "
            "각 항목에 대해 best-effort SMTP 발송 — 실패해도 token 생성은 성공한다."
        ),
    )


def _public_share_url(token: str) -> str:
    """`/share/{token}` — relative path; FE prepends origin if needed."""
    return f"/share/{token}"


def _row_to_share_meta(row: Any) -> dict[str, Any]:
    """share_links row → public-safe dict (never includes the password hash).

    Row order matches the SELECT below: id, token, document_id, created_by,
    expires_at, password_hash, view_count, revoked_at, created_at, short_id.
    """
    short_id = row[9] if len(row) > 9 else None
    return {
        "id": str(row[0]),
        "token": row[1],
        "document_id": str(row[2]),
        "created_by": str(row[3]),
        "expires_at": row[4].isoformat() if row[4] else None,
        "has_password": row[5] is not None and row[5] != "",
        "view_count": int(row[6] or 0),
        "revoked_at": row[7].isoformat() if row[7] else None,
        "created_at": row[8].isoformat() if row[8] else None,
        "short_id": short_id,
        "short_url": f"/share/short/{short_id}" if short_id else None,
        "url": _public_share_url(row[1]),
    }


# ── Editor-side endpoints ───────────────────────────────────────────────


@router.post(
    "/documents/{slug}/share",
    status_code=201,
    summary="공개 공유 링크 생성 (editor+)",
    description=(
        "문서 slug 에 대한 새 share token 을 발급한다. `expires_at` 미지정 시 무기한, "
        "`password` 지정 시 argon2 해시로 저장되며 공개 GET 에서 반드시 일치해야 한다."
    ),
)
async def create_share_link(
    slug: str,
    body: CreateShareIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc or doc.get("status") == "archived":
        raise NotFound(f"document not found: {slug}")

    if body.expires_at is not None:
        # Normalise naive → UTC; reject past timestamps so revoked links
        # aren't created accidentally.
        ea = body.expires_at
        if ea.tzinfo is None:
            ea = ea.replace(tzinfo=UTC)
        if ea <= datetime.now(UTC):
            from app.core.errors import ValidationFailed

            raise ValidationFailed(
                "expires_at must be in the future",
                details={"got": body.expires_at.isoformat()},
            )
        expires_at = ea
    else:
        expires_at = None

    pwd_hash = hash_password(body.password) if body.password else None
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    short_id = await _alloc_unique_short_id(s)

    row = (await s.execute(
        text("""
            INSERT INTO share_links (
              token, document_id, created_by, expires_at, password_hash, short_id
            ) VALUES (
              :tok, CAST(:doc AS uuid), CAST(:u AS uuid), :ea, :ph, :sid
            )
            RETURNING id, token, document_id, created_by, expires_at,
                      password_hash, view_count, revoked_at, created_at, short_id
        """),
        {
            "tok": token,
            "doc": doc["id"],
            "u": user["id"],
            "ea": expires_at,
            "ph": pwd_hash,
            "sid": short_id,
        },
    )).first()
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="share.create",
        target=f"document:{slug}",
        payload={
            "token": token,
            "expires_at": expires_at.isoformat() if expires_at else None,
            "has_password": pwd_hash is not None,
        },
    )
    await s.commit()

    meta = _row_to_share_meta(row)

    # Best-effort share-link emails. Never undo the share creation on failure.
    notified: list[str] = []
    if body.notify_emails:
        try:
            from app.services.email import send_email, share_link_email

            sender_name = user.get("name") or user.get("email") or "MX 백서"
            for raw in body.notify_emails:
                if not isinstance(raw, str):
                    continue
                addr = raw.strip()
                if not addr or "@" not in addr:
                    continue
                subject, body_text = share_link_email(
                    recipient=addr,
                    sender_name=sender_name,
                    doc_title=doc["title"],
                    share_url=meta["url"],
                )
                ok = await send_email(addr, subject, body_text)
                if ok:
                    notified.append(addr)
        except Exception:  # noqa: BLE001
            import logging as _logging

            _logging.getLogger(__name__).exception(
                "share-link email dispatch failed for slug=%s", slug
            )

    return envelope(
        data={
            "token": meta["token"],
            "url": meta["url"],
            "expires_at": meta["expires_at"],
            "has_password": meta["has_password"],
            "short_id": meta["short_id"],
            "short_url": meta["short_url"],
            "notified_emails": notified,
        },
        meta={"share_id": meta["id"]},
    )


@router.get(
    "/documents/{slug}/share",
    summary="활성 공유 링크 목록 (editor+)",
    description="revoked_at IS NULL 인 항목만 반환. view_count, expires_at 포함.",
)
async def list_share_links(
    slug: str,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc or doc.get("status") == "archived":
        raise NotFound(f"document not found: {slug}")

    rows = (await s.execute(
        text("""
            SELECT id, token, document_id, created_by, expires_at,
                   password_hash, view_count, revoked_at, created_at, short_id
            FROM share_links
            WHERE document_id = CAST(:doc AS uuid) AND revoked_at IS NULL
            ORDER BY created_at DESC
        """),
        {"doc": doc["id"]},
    )).all()
    items = [_row_to_share_meta(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


# ── Public + management endpoints ──────────────────────────────────────


def _is_expired(row_expires_at: Any) -> bool:
    if row_expires_at is None:
        return False
    # asyncpg returns timezone-aware datetime for TIMESTAMPTZ.
    return row_expires_at <= datetime.now(UTC)


@router.get(
    "/share/{token}",
    summary="공개 공유 링크로 문서 조회 (인증 불필요)",
    description=(
        "토큰이 유효하면 `GET /documents/{slug}` 와 동일한 envelope 을 반환한다. "
        "비밀번호가 설정된 링크는 `password` 헤더 또는 쿼리로 평문을 함께 보내야 한다.\n\n"
        "- 404: 토큰이 존재하지 않음\n"
        "- 410: 만료(expires_at) 또는 revoke 됨\n"
        "- 401: 비밀번호가 설정된 링크인데 누락/불일치\n"
        "- 200: 성공 시 `view_count` 가 1 증가"
    ),
)
async def read_shared_document(
    token: str,
    response: Response,
    password: str | None = Query(default=None, max_length=200),
    x_share_password: str | None = Header(
        default=None, alias="X-Share-Password"
    ),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    row = (await s.execute(
        text("""
            SELECT id, token, document_id, created_by, expires_at,
                   password_hash, view_count, revoked_at, created_at, short_id
            FROM share_links
            WHERE token = :tok
        """),
        {"tok": token},
    )).first()
    if not row:
        raise NotFound("share link not found")

    if row[7] is not None:
        raise Gone("share link has been revoked")
    if _is_expired(row[4]):
        raise Gone("share link has expired")

    # Password gate.
    pwd_hash = row[5]
    if pwd_hash:
        provided = x_share_password or password
        if not provided:
            raise Unauthorized("password required for this share link")
        if not verify_password(provided, pwd_hash):
            raise Unauthorized("invalid share password")

    doc = await document_repo.find_by_id(s, str(row[2]))
    if not doc or doc.get("status") == "archived":
        # The doc was hard/soft deleted. Treat as gone so the FE can show a
        # consistent "더 이상 사용할 수 없는 링크" message.
        raise Gone("document no longer available")

    # Bump view_count (best-effort; commit before responding).
    await s.execute(
        text(
            """
            UPDATE share_links SET view_count = view_count + 1
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": str(row[0])},
    )
    await s.commit()

    settings = get_settings()
    _ = settings  # placeholder for future signed-URL embellishments

    etag = document_service.make_etag(doc["id"], doc["version"])
    response.headers["Cache-Control"] = "private, no-store"
    share_meta = _row_to_share_meta(row)
    # The response intentionally hides created_by/document_id from the public
    # consumer — they only need expires_at/has_password/view_count to render
    # the banner.
    public_share_meta = {
        "token": share_meta["token"],
        "url": share_meta["url"],
        "expires_at": share_meta["expires_at"],
        "has_password": share_meta["has_password"],
        "view_count": share_meta["view_count"] + 1,
        "short_id": share_meta["short_id"],
        "short_url": share_meta["short_url"],
    }
    # Public share links never get to see admin/editor-permissioned blocks —
    # always scrub at the lowest tier ('reader'), regardless of who created
    # the share. This protects against an admin accidentally embedding
    # restricted content in an externally-shareable link.
    scrubbed_content = document_service.scrub_for_response(
        doc["content_json"], role="reader"
    )
    document_row = {
        "id": doc["id"],
        "slug": doc["slug"],
        "title": doc["title"],
        "summary": doc["summary"],
        "status": doc["status"],
        "version": doc["version"],
        "schema_ver": doc["schema_ver"],
        "owner_id": doc["owner_id"],
        "part_id": doc["part_id"],
        "created_at": doc["created_at"],
        "updated_at": doc["updated_at"],
        "content": scrubbed_content,
    }
    return envelope(
        data={
            "document": scrubbed_content,
            "row": document_row,
            "share_meta": public_share_meta,
        },
        meta={"etag": etag},
    )


@router.get(
    "/share/short/{short_id}",
    summary="짧은 alias 로 share token 해석 (302)",
    description=(
        "QR/모바일 친화 6자리 Crockford-base32 alias 를 token 으로 변환해 "
        "`/share/{token}` 으로 302 리다이렉트한다. revoked/expired 여부는 "
        "후속 GET /share/{token} 에서 410 으로 처리된다."
    ),
    status_code=307,
)
async def resolve_short_share_id(
    short_id: str,
    s: AsyncSession = Depends(get_db),
) -> Response:
    row = (await s.execute(
        text("SELECT token FROM share_links WHERE short_id = :sid"),
        {"sid": short_id.upper()},
    )).first()
    if not row:
        raise NotFound("short share id not found")
    return RedirectResponse(url=f"/share/{row[0]}", status_code=302)


@router.delete(
    "/share/{token}",
    status_code=204,
    summary="공유 링크 revoke (creator 또는 admin)",
)
async def revoke_share_link(
    token: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> Response:
    row = (await s.execute(
        text("""
            SELECT id, created_by, revoked_at, document_id
            FROM share_links WHERE token = :tok
        """),
        {"tok": token},
    )).first()
    if not row:
        raise NotFound("share link not found")
    if str(row[1]) != user["id"] and user.get("role") != "admin":
        raise Forbidden("only the creator or admin may revoke a share link")
    if row[2] is not None:
        # Already revoked — idempotent 204.
        return Response(status_code=204)

    await s.execute(
        text(
            """
            UPDATE share_links SET revoked_at = NOW()
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"id": str(row[0])},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="share.revoke",
        target=f"share_link:{token}",
        payload={"document_id": str(row[3])},
    )
    await s.commit()
    return Response(status_code=204)
