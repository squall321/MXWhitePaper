"""Notification preferences router (Cycle 0019).

  - GET  /api/v1/me/notification-prefs   (reader+) → merged prefs (defaults
                                                      filled in for missing keys)
  - PUT  /api/v1/me/notification-prefs   (reader+) → upsert + return merged

Body shape (PUT):
    {
      "comment_mention": {"in_app": true, "email": true},
      "review_request":  {"in_app": true, "email": false},
      ...
    }

Unknown kinds / channels → 422. Partial bodies are accepted; missing keys keep
their existing stored value (or the default if never set).
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Body, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.db import get_db
from app.core.errors import ValidationFailed, envelope
from app.services import notification_prefs as prefs_svc

router = APIRouter(prefix="/api/v1/me", tags=["notification_prefs"])


@router.get(
    "/notification-prefs",
    summary="내 알림 채널 환경설정 조회 (defaults 가 비어있는 키 채움)",
)
async def get_my_notification_prefs(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    prefs = await prefs_svc.load_for_user(s, user["id"])
    return envelope(data={"prefs": prefs})


@router.put(
    "/notification-prefs",
    summary="내 알림 채널 환경설정 저장 (부분 갱신 + defaults merge)",
)
async def put_my_notification_prefs(
    body: dict[str, Any] = Body(default_factory=dict),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    try:
        clean = prefs_svc.validate_put_body(body)
    except ValueError as e:
        raise ValidationFailed(str(e)) from e

    # Merge with what's currently stored so a partial PUT doesn't wipe other
    # kinds. We then store the *full* merged blob so future GETs are stable.
    current = await prefs_svc.load_for_user(s, user["id"])
    merged = {k: dict(v) for k, v in current.items()}
    for kind, kv in clean.items():
        merged.setdefault(kind, {})
        for ch, v in kv.items():
            merged[kind][ch] = v

    await s.execute(
        text(
            "UPDATE users SET notification_prefs = CAST(:p AS jsonb) "
            "WHERE id = CAST(:u AS uuid)"
        ),
        {"p": json.dumps(merged), "u": user["id"]},
    )
    await s.commit()
    return envelope(data={"prefs": merged})
