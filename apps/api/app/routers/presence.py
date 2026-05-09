"""Presence router — real-time "who is viewing this doc" indicator.

In-memory only — there's no DB-backed presence table. Presence is by nature
ephemeral, and persisting it would just create stale rows that we'd have to
prune anyway. Process-local state means this is single-replica only; in a
multi-worker prod deploy we'd swap the dict for Redis.

Endpoints (all prefixed `/api/v1`):

  - POST   /presence/{slug}/heartbeat    (reader+) — record/refresh presence.
        Body: { anchor_block_id?: str | null }
        Returns the current registry for this doc (after pruning).

  - GET    /presence/{slug}              (reader+) — list current presence,
        prunes stale entries (>30s) on access.

  - DELETE /presence/{slug}              (reader+) — explicit leave.

  - GET    /presence/{slug}/stream       (reader+) — SSE; pushes one
        `presence` event every 5 seconds. Each chunk is the same shape as
        the GET response.
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.auth import require_reader

router = APIRouter(prefix="/api/v1", tags=["presence"])

# Module-level registry: doc_id (slug) -> {user_id: {name, last_seen,
# anchor_block_id?}}. We key on slug because that's what the FE uses.
PRESENCE: dict[str, dict[str, dict[str, Any]]] = {}
PRESENCE_TTL_SEC = 30
SSE_INTERVAL_SEC = 5


class HeartbeatIn(BaseModel):
    anchor_block_id: str | None = Field(default=None, max_length=200)


def _prune(slug: str) -> dict[str, dict[str, Any]]:
    """Drop entries older than PRESENCE_TTL_SEC. Returns the live bucket."""
    bucket = PRESENCE.get(slug)
    if not bucket:
        return {}
    cutoff = time.time() - PRESENCE_TTL_SEC
    stale = [uid for uid, e in bucket.items() if e.get("last_seen", 0) < cutoff]
    for uid in stale:
        bucket.pop(uid, None)
    if not bucket:
        PRESENCE.pop(slug, None)
        return {}
    return bucket


def _serialize(bucket: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Render the bucket as a list of `{user_id, name, last_seen, ...}`."""
    return [
        {
            "user_id": uid,
            "name": entry.get("name") or "",
            "anchor_block_id": entry.get("anchor_block_id"),
            "last_seen": entry.get("last_seen", 0),
        }
        for uid, entry in bucket.items()
    ]


@router.post(
    "/presence/{slug}/heartbeat",
    summary="presence heartbeat (reader+)",
)
async def heartbeat(
    slug: str,
    body: HeartbeatIn | None = None,
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    bucket = PRESENCE.setdefault(slug, {})
    bucket[user["id"]] = {
        "name": user.get("name") or user.get("email") or "",
        "last_seen": time.time(),
        "anchor_block_id": (body.anchor_block_id if body else None),
    }
    bucket = _prune(slug)
    return {
        "data": {
            "slug": slug,
            "items": _serialize(bucket),
        },
        "meta": {"count": len(bucket), "ttl_sec": PRESENCE_TTL_SEC},
        "error": None,
    }


@router.get(
    "/presence/{slug}",
    summary="presence list (reader+)",
)
async def list_presence(
    slug: str,
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    bucket = _prune(slug)
    return {
        "data": {"slug": slug, "items": _serialize(bucket)},
        "meta": {"count": len(bucket), "ttl_sec": PRESENCE_TTL_SEC},
        "error": None,
    }


@router.delete(
    "/presence/{slug}",
    status_code=204,
    summary="explicit leave (reader+)",
)
async def leave_presence(
    slug: str,
    user: dict[str, Any] = Depends(require_reader),
) -> Response:
    bucket = PRESENCE.get(slug)
    if bucket:
        bucket.pop(user["id"], None)
        if not bucket:
            PRESENCE.pop(slug, None)
    return Response(status_code=204)


@router.get(
    "/presence/{slug}/stream",
    summary="presence SSE stream (reader+)",
)
async def stream_presence(
    slug: str,
    _user: dict[str, Any] = Depends(require_reader),
) -> StreamingResponse:
    """Server-Sent Events: emit a `presence` event every SSE_INTERVAL_SEC."""

    async def gen():
        # Emit one frame immediately so the client doesn't wait 5s for the
        # first paint, then loop.
        while True:
            bucket = _prune(slug)
            payload = {
                "slug": slug,
                "items": _serialize(bucket),
                "ttl_sec": PRESENCE_TTL_SEC,
            }
            yield f"event: presence\ndata: {json.dumps(payload)}\n\n"
            await asyncio.sleep(SSE_INTERVAL_SEC)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
