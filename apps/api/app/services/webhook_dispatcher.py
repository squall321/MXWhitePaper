"""Webhook 디스패처 — 등록된 webhook 엔드포인트로 이벤트 본문 POST.

설계:
  - `dispatch(event_kind, payload, *, target_part_id=None)` 하나로 문서/댓글/
    리뷰 라우터에서 호출. 실패해도 호출자의 트랜잭션을 깨뜨리지 않는다 —
    내부에서 try/except 로 모두 흡수하고 로그만 남긴다.
  - HMAC-SHA256(secret, body_bytes) 서명을 `X-MXWP-Signature` 헤더로 보낸다.
    프리픽스 `sha256=` 사용. 수신측은 동일한 키로 서명 비교.
  - 5xx / timeout 시 한 번만 재시도. `asyncio.create_task` 로 background fire-and-
    forget. 실패해도 ok — 다음 이벤트가 또 도착하면 다시 시도된다.

Test 환경에선 `MXWP_SKIP_WEBHOOKS=1` 로 outbound HTTP 를 스킵하면서도 DB
상태(last_status, deliveries 행) 는 정상 갱신할 수 있다 — `httpx.AsyncClient`
를 mock 으로 주입할 수 있도록 `_post` 만 분리해 두었다.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_factory

logger = logging.getLogger(__name__)

USER_AGENT = "mx-white-paper-webhook"
TIMEOUT_SECONDS = 10.0
RETRY_DELAY_SECONDS = 60.0
RESPONSE_BODY_SNIPPET = 1024  # truncation budget for stored response_body


def sign_payload(secret: str, body: bytes) -> str:
    """HMAC-SHA256 → `sha256=<hex>` 형식. 수신자는 동일 키로 검증."""
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def _classify(status: int | None, *, timed_out: bool) -> str:
    if timed_out:
        return "timeout"
    if status is None:
        return "timeout"
    if 200 <= status < 300:
        return "ok"
    if 400 <= status < 500:
        return "4xx"
    if 500 <= status < 600:
        return "5xx"
    return "5xx"


async def _list_matching_webhooks(
    s: AsyncSession,
    *,
    event_kind: str,
    target_part_id: str | None,
) -> list[dict[str, Any]]:
    """events 배열에 event_kind 가 들어 있고 enabled 인 row 만.

    filter_part_ids 가 비어 있으면 모든 part 매칭. 비어있지 않으면 list 안에
    target_part_id 가 있을 때만 매칭. target_part_id 가 None 이면 필터 통과.
    """
    rows = (await s.execute(
        text("""
            SELECT id, owner_user_id, scope, url, secret,
                   events, filter_part_ids
            FROM webhooks
            WHERE enabled = TRUE
              AND events @> CAST(:k AS jsonb)
        """),
        {"k": json.dumps([event_kind])},
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        filt = r[6]
        if isinstance(filt, str):
            try:
                filt = json.loads(filt)
            except json.JSONDecodeError:
                filt = []
        if not isinstance(filt, list):
            filt = []
        if filt and target_part_id is not None and target_part_id not in filt:
            continue
        out.append({
            "id": str(r[0]),
            "owner_user_id": str(r[1]),
            "scope": r[2],
            "url": r[3],
            "secret": r[4],
        })
    return out


async def _post(
    client: httpx.AsyncClient,
    url: str,
    body: bytes,
    signature: str,
) -> tuple[int | None, str, bool]:
    """단일 POST. 반환 (status, response_text, timed_out).

    예외(connect/read timeout 포함) → (None, msg, True).
    """
    try:
        resp = await client.post(
            url,
            content=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": USER_AGENT,
                "X-MXWP-Signature": signature,
            },
            timeout=TIMEOUT_SECONDS,
        )
        snippet = resp.text or ""
        if len(snippet) > RESPONSE_BODY_SNIPPET:
            snippet = snippet[:RESPONSE_BODY_SNIPPET]
        return resp.status_code, snippet, False
    except httpx.TimeoutException as e:
        return None, f"timeout: {e}", True
    except httpx.HTTPError as e:
        # connect refused 등은 'timeout' 카테고리로 묶는다 — last_status='timeout'.
        return None, f"http_error: {e}", True


async def _record_delivery(
    s: AsyncSession,
    *,
    webhook_id: str,
    event_kind: str,
    payload: dict[str, Any],
    http_status: int | None,
    response_body: str,
    retry_count: int,
    last_status: str,
) -> None:
    await s.execute(
        text("""
            INSERT INTO webhook_deliveries
                (webhook_id, event_kind, payload, http_status,
                 response_body, retry_count)
            VALUES
                (CAST(:wid AS uuid), :ek, CAST(:p AS jsonb),
                 :hs, :rb, :rc)
        """),
        {
            "wid": webhook_id,
            "ek": event_kind,
            "p": json.dumps(payload, ensure_ascii=False),
            "hs": http_status,
            "rb": response_body,
            "rc": retry_count,
        },
    )
    await s.execute(
        text("""
            UPDATE webhooks
            SET last_status = :ls, last_attempted_at = NOW()
            WHERE id = CAST(:wid AS uuid)
        """),
        {"ls": last_status, "wid": webhook_id},
    )
    await s.commit()


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient()


# Hook seam for tests — replace with a callable returning AsyncClient mock.
_client_factory = _make_client


def set_client_factory(factory: Any) -> None:
    """Tests inject a fake httpx.AsyncClient factory."""
    global _client_factory
    _client_factory = factory


def reset_client_factory() -> None:
    global _client_factory
    _client_factory = _make_client


async def _deliver_one(
    webhook: dict[str, Any],
    event_kind: str,
    payload: dict[str, Any],
) -> None:
    """단일 webhook 전송 + 5xx/timeout 시 1회 재시도. 자체 세션 사용."""
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    signature = sign_payload(webhook["secret"], body)
    factory = _client_factory

    async with factory() as client:
        status, snippet, timed_out = await _post(
            client, webhook["url"], body, signature,
        )
    last_status = _classify(status, timed_out=timed_out)

    sf = session_factory()
    async with sf() as s:
        await _record_delivery(
            s,
            webhook_id=webhook["id"],
            event_kind=event_kind,
            payload=payload,
            http_status=status,
            response_body=snippet,
            retry_count=0,
            last_status=last_status,
        )

    if last_status in ("5xx", "timeout"):
        await asyncio.sleep(RETRY_DELAY_SECONDS)
        async with factory() as client:
            status2, snippet2, timed_out2 = await _post(
                client, webhook["url"], body, signature,
            )
        last_status2 = _classify(status2, timed_out=timed_out2)
        sf = session_factory()
        async with sf() as s:
            await _record_delivery(
                s,
                webhook_id=webhook["id"],
                event_kind=event_kind,
                payload=payload,
                http_status=status2,
                response_body=snippet2,
                retry_count=1,
                last_status=last_status2,
            )


async def dispatch(
    event_kind: str,
    payload: dict[str, Any],
    *,
    target_part_id: str | None = None,
) -> int:
    """이벤트가 발생한 직후 호출. enqueued count 를 반환 (테스트용).

    호출자 트랜잭션과 분리된 자체 세션을 만들어 lookup/persist 를 수행.
    실패해도 호출자에게 전파하지 않는다.

    `MXWP_SKIP_WEBHOOKS=1` 일 때는 no-op (테스트 격리).
    """
    if os.environ.get("MXWP_SKIP_WEBHOOKS") == "1":
        return 0
    try:
        sf2 = session_factory()
        async with sf2() as s:
            matches = await _list_matching_webhooks(
                s,
                event_kind=event_kind,
                target_part_id=target_part_id,
            )
    except Exception as e:
        logger.warning("webhook lookup failed: %s", e)
        return 0

    enqueued = 0
    for hook in matches:
        try:
            asyncio.create_task(_deliver_one(hook, event_kind, payload))
            enqueued += 1
        except Exception as e:
            logger.warning(
                "webhook task spawn failed (id=%s): %s", hook["id"], e,
            )
    return enqueued


async def deliver_sync(
    webhook: dict[str, Any],
    event_kind: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """`POST /webhooks/:id/test` 가 사용하는 동기 전송 — retry 없음.

    반환: { http_status, last_status, response_body }
    """
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    signature = sign_payload(webhook["secret"], body)
    factory = _client_factory
    async with factory() as client:
        status, snippet, timed_out = await _post(
            client, webhook["url"], body, signature,
        )
    last_status = _classify(status, timed_out=timed_out)
    sf = session_factory()
    async with sf() as s:
        await _record_delivery(
            s,
            webhook_id=webhook["id"],
            event_kind=event_kind,
            payload=payload,
            http_status=status,
            response_body=snippet,
            retry_count=0,
            last_status=last_status,
        )
    return {
        "http_status": status,
        "last_status": last_status,
        "response_body": snippet,
    }
