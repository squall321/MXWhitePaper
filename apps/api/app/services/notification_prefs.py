"""Per-user notification preferences (Cycle 0019).

Stored in `users.notification_prefs` (JSONB). Five event kinds × two channels:

  - kinds:    comment_mention, review_request, review_decision,
              subscription_event, subscription_digest
  - channels: in_app  → controls whether a `notifications` row is inserted
              email   → controls whether an outbound email is dispatched

`{}` is treated as "use defaults". Missing kind / channel inside a populated
prefs blob also falls through to the default for that key — that way the FE
can PUT only the kinds the user actually changed without erasing the rest.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Allowed kinds. Any other key in a PUT body is rejected by the router; here
# we just accept whatever the DB has and ignore unknowns at lookup time.
KINDS: tuple[str, ...] = (
    "comment_mention",
    "review_request",
    "review_decision",
    "subscription_event",
    "subscription_digest",
)

CHANNELS: tuple[str, ...] = ("in_app", "email")

# Default prefs matrix — mirrors apps/web/src/features/settings/store.ts.
DEFAULTS: dict[str, dict[str, bool]] = {
    "comment_mention": {"in_app": True, "email": True},
    "review_request": {"in_app": True, "email": True},
    "review_decision": {"in_app": True, "email": False},
    "subscription_event": {"in_app": True, "email": False},
    "subscription_digest": {"in_app": True, "email": True},
}


def defaults() -> dict[str, dict[str, bool]]:
    """Fresh copy of the defaults matrix (so callers can mutate safely)."""
    return {k: dict(v) for k, v in DEFAULTS.items()}


def merge_with_defaults(stored: Any) -> dict[str, dict[str, bool]]:
    """Coerce a potentially-empty / partial JSONB blob into a full prefs map.

    `stored` may be None, str (JSON-encoded), or dict. Unknown keys are dropped;
    missing keys / channels fall through to DEFAULTS.
    """
    if stored is None:
        return defaults()
    if isinstance(stored, str):
        try:
            stored = json.loads(stored)
        except json.JSONDecodeError:
            return defaults()
    if not isinstance(stored, dict):
        return defaults()
    out = defaults()
    for kind in KINDS:
        kv = stored.get(kind)
        if not isinstance(kv, dict):
            continue
        for ch in CHANNELS:
            v = kv.get(ch)
            if isinstance(v, bool):
                out[kind][ch] = v
    return out


async def load_for_user(
    s: AsyncSession, user_id: str
) -> dict[str, dict[str, bool]]:
    """Read + merge prefs for a single user. Falls back to defaults on any
    error — this is on the dispatch hot-path so we never raise."""
    try:
        row = (await s.execute(
            text(
                "SELECT notification_prefs FROM users "
                "WHERE id = CAST(:u AS uuid)"
            ),
            {"u": user_id},
        )).first()
    except Exception:  # noqa: BLE001
        logger.exception("notification_prefs lookup failed for user=%s", user_id)
        return defaults()
    if not row:
        return defaults()
    return merge_with_defaults(row[0])


async def is_channel_enabled(
    s: AsyncSession, *, user_id: str, kind: str, channel: str
) -> bool:
    """Convenience wrapper for dispatcher hot-path. Defaults to True for an
    unknown kind/channel so brand-new event types don't get silently dropped
    until prefs migrate."""
    if kind not in KINDS or channel not in CHANNELS:
        return True
    prefs = await load_for_user(s, user_id)
    return bool(prefs.get(kind, {}).get(channel, True))


def validate_put_body(body: Any) -> dict[str, dict[str, bool]]:
    """Validate + coerce a PUT body into a clean prefs blob.

    Raises ValueError on bad shape so the router can surface a 422.
    """
    if not isinstance(body, dict):
        raise ValueError("body must be an object")
    cleaned: dict[str, dict[str, bool]] = {}
    for kind, kv in body.items():
        if kind not in KINDS:
            raise ValueError(f"unknown kind: {kind}")
        if not isinstance(kv, dict):
            raise ValueError(f"{kind} must be an object")
        bucket: dict[str, bool] = {}
        for ch, v in kv.items():
            if ch not in CHANNELS:
                raise ValueError(f"{kind}.{ch} is not a valid channel")
            if not isinstance(v, bool):
                raise ValueError(f"{kind}.{ch} must be a boolean")
            bucket[ch] = v
        cleaned[kind] = bucket
    return cleaned
