"""Snapshot management — full-server backup archives.

Endpoints (admin only):
  GET    /api/v1/snapshots              — list snapshots (newest first)
  GET    /api/v1/snapshots/{id}         — single snapshot metadata
  GET    /api/v1/snapshots/{id}/download— stream the .tar.gz body
  DELETE /api/v1/snapshots/{id}         — remove the archive + sha sidecar

Snapshots themselves are produced by `infra/scripts/snapshot.sh` on the
host (see `app/services/snapshots.py` for the reasoning behind keeping
creation off the API). The script writes archives to
`infra/backups/snapshots/`, which the API can read because the repo is
bind-mounted into the container at `/workspace`.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.core.auth import require_admin
from app.core.errors import NotFound, envelope
from app.services import snapshots as snapshots_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/snapshots", tags=["snapshots"])


@router.get(
    "",
    summary="전체 서버 스냅샷 목록",
    description=(
        "`infra/scripts/snapshot.sh` 로 생성된 .tar.gz 아카이브를 최신순으로 반환한다. "
        "각 항목은 manifest.json 의 created_at(초 정밀도), git_rev, 버킷별 "
        "객체수/사이즈, sha256 체크섬을 포함한다."
    ),
)
async def list_snapshots(
    _user: dict = Depends(require_admin),
) -> dict[str, Any]:
    items = snapshots_service.list_snapshots()
    return envelope(
        data={"items": items, "count": len(items)},
        meta={"dir": str(snapshots_service.snapshots_dir())},
    )


@router.get(
    "/{snapshot_id}",
    summary="단일 스냅샷 메타 조회",
)
async def get_snapshot(
    snapshot_id: str,
    _user: dict = Depends(require_admin),
) -> dict[str, Any]:
    try:
        item = snapshots_service.get_snapshot(snapshot_id)
    except ValueError as e:
        raise NotFound(str(e)) from e
    if not item:
        raise NotFound(f"snapshot not found: {snapshot_id}")
    return envelope(data=item)


@router.get(
    "/{snapshot_id}/download",
    summary="스냅샷 .tar.gz 다운로드",
    description=(
        "전체 스냅샷 아카이브 바이트를 스트리밍한다. 파일 크기는 수십~수백 MB "
        "수준이라 메모리에 통째로 올리지 않고 1 MB 청크로 흘려보낸다."
    ),
)
async def download_snapshot(
    snapshot_id: str,
    _user: dict = Depends(require_admin),
):
    item = snapshots_service.get_snapshot(snapshot_id)
    if not item:
        raise NotFound(f"snapshot not found: {snapshot_id}")
    try:
        stream = snapshots_service.iter_snapshot_bytes(snapshot_id)
    except ValueError as e:
        raise NotFound(str(e)) from e
    headers = {
        "Content-Disposition": (
            f'attachment; filename="{item["filename"]}"'
        ),
    }
    sha = item.get("sha256")
    if sha:
        headers["X-Snapshot-SHA256"] = sha
    size = item.get("size_bytes")
    if isinstance(size, int):
        headers["Content-Length"] = str(size)
    return StreamingResponse(
        stream,
        media_type="application/gzip",
        headers=headers,
    )


@router.delete(
    "/{snapshot_id}",
    status_code=204,
    summary="스냅샷 삭제",
    description="아카이브와 sidecar .sha256 파일을 함께 제거한다.",
)
async def delete_snapshot(
    snapshot_id: str,
    _user: dict = Depends(require_admin),
):
    try:
        removed = snapshots_service.delete_snapshot(snapshot_id)
    except ValueError as e:
        raise NotFound(str(e)) from e
    if not removed:
        raise NotFound(f"snapshot not found: {snapshot_id}")
    return None
