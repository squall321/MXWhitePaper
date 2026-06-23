"""Image upload + read 라우터 (Sprint 5 + Sprint 6 RBAC).

엔드포인트:
  POST /api/v1/uploads/image/init      (editor+)
  POST /api/v1/uploads/image/finalize  (editor+)
  POST /api/v1/uploads/image/from-url  (editor+, SSRF-가드 원격 fetch)
  GET  /api/v1/images/{identifier}     (reader+, UUID/ULID 둘 다 허용)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_editor, require_reader
from app.core.db import get_db
from app.core.errors import ValidationFailed, envelope
from app.repos import document_repo
from app.services import upload_service

uploads_router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])
images_router = APIRouter(prefix="/api/v1/images", tags=["images"])


async def _resolve_actor(
    s: AsyncSession, x_mxwp_user: str | None, user: dict | None = None
) -> str:
    if x_mxwp_user:
        uid = await document_repo.fetch_user_by_email(s, x_mxwp_user)
        if uid:
            return uid
    if user and user.get("id"):
        return str(user["id"])
    return await document_repo.fetch_admin_owner_id(s)


@uploads_router.post("/image/init")
async def upload_image_init(
    payload: dict[str, Any],
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    result = await upload_service.init_upload(s, body=payload, actor_id=actor)
    return envelope(data=result)


@uploads_router.post("/image/finalize")
async def upload_image_finalize(
    payload: dict[str, Any],
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    upload_id = payload.get("uploadId") if isinstance(payload, dict) else None
    if not upload_id:
        raise ValidationFailed("uploadId required")
    actor = await _resolve_actor(s, x_mxwp_user, user)
    result = await upload_service.finalize_upload(
        s, upload_id=upload_id, actor_id=actor
    )
    return envelope(data=result)


@uploads_router.post("/image/from-url")
async def upload_image_from_url(
    payload: dict[str, Any],
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    url = payload.get("url") if isinstance(payload, dict) else None
    if not url:
        raise ValidationFailed("url required")
    filename = payload.get("filename") if isinstance(payload, dict) else None
    actor = await _resolve_actor(s, x_mxwp_user, user)
    result = await upload_service.fetch_and_store_image_from_url(
        s, url=url, actor_id=actor, filename=filename
    )
    return envelope(data=result)


@images_router.get("/{identifier}")
async def get_image(
    identifier: str,
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    data = await upload_service.get_image_or_404(s, identifier)
    return envelope(data=data)
