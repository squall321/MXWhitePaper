"""Generic file upload + download 라우터.

이미지 파이프라인과 동일한 2-phase presigned-PUT 패턴을 따르되, EXIF
strip / WebP 트랜스코드는 없다. (이미지는 /uploads/image/* 로 별도 처리.)

엔드포인트:
  POST /api/v1/files/presign-put          (editor+, rate-limited 30/min/user)
  POST /api/v1/files/finalize             (editor+)
  GET  /api/v1/files/{file_id}/download   (reader+, 302 → presigned GET)

MIME 정책 — `_BLOCKED_MIMES` 와 `_ALLOWED_APPLICATION_PREFIXES` 참조.
실행 가능 바이너리/스크립트류는 거부, image/* 는 거부 후 /uploads/image/init
사용을 안내한다.
"""
from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, Header
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_editor, require_reader
from app.core.db import get_db
from app.core.errors import envelope
from app.repos import document_repo
from app.services import file_service

router = APIRouter(prefix="/api/v1/files", tags=["files"])


# ── 30/min/user 단순 in-process 레이트 리밋 ──────────────────────────
# search_audit.py 의 dict 기반 패턴을 따라간다 — 단일 프로세스 가정.
_RATE_WINDOW_SECONDS = 60.0
_RATE_LIMIT_PER_WINDOW = 30
# user_id → list[float] (recent presign timestamps within window)
_presign_history: dict[str, list[float]] = {}


def _check_rate_limit(user_id: str) -> bool:
    """presign-put 한정 rate-limit. True == 허용."""
    now = time.monotonic()
    cutoff = now - _RATE_WINDOW_SECONDS
    hist = [t for t in _presign_history.get(user_id, []) if t >= cutoff]
    if len(hist) >= _RATE_LIMIT_PER_WINDOW:
        _presign_history[user_id] = hist
        return False
    hist.append(now)
    _presign_history[user_id] = hist
    return True


def _reset_rate_limit_for_tests() -> None:
    _presign_history.clear()


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


@router.post("/presign-put")
async def files_presign_put(
    payload: dict[str, Any],
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    file_service.enforce_rate_limit(_check_rate_limit, actor)
    result = file_service.presign_put(body=payload, actor_id=actor)
    return envelope(data=result)


@router.post("/finalize")
async def files_finalize(
    payload: dict[str, Any],
    x_mxwp_user: str | None = Header(default=None, alias="X-MXWP-User"),
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_editor),
) -> dict[str, Any]:
    actor = await _resolve_actor(s, x_mxwp_user, user)
    result = await file_service.finalize(s, body=payload, actor_id=actor)
    return envelope(data=result)


@router.get("/{file_id}/download")
async def files_download(
    file_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict = Depends(require_reader),
) -> RedirectResponse:
    """Issue a fresh 1-day presigned GET URL and 302-redirect.

    Authz: the requester must either own the file OR have read access to at
    least one non-archived document that references it (lazy walk via
    `jsonb_path_exists`). The reader+ role check above is necessary but
    insufficient — without the per-document check, any authenticated reader
    could download an unattached / orphaned file by guessing a ULID.
    """
    requester_id = str(user.get("id")) if user.get("id") else None
    url = await file_service.issue_download_url(
        s, file_id=file_id, requester_user_id=requester_id
    )
    return RedirectResponse(url=url, status_code=302)
