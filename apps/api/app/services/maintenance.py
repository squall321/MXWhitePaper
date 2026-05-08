"""백그라운드 housekeeping 서비스.

Cycle 11 — outstandingItems 의 두 항목을 닫는다:
  1) `images_pending` TTL sweeper — finalize 가 안 들어와도 만료된 행 정리.
  2) `document_versions` 압축 — Plan §11 보존 정책에 맞춰 오래된 버전 솎기.
  3) `audit_logs` 보존 (옵션) — 365일 이상 된 감사로그 삭제 (CLI --yes 필요).

모든 함수는 idempotent. 같은 세션에서 호출자가 commit 하지 않아도 함수
내부에서 commit 한다 (CLI/스케줄러 양쪽에서 단일 호출로 끝나도록).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── 1) images_pending TTL ─────────────────────────────────────────────
async def purge_expired_pending_uploads(s: AsyncSession) -> int:
    """`images_pending.expires_at < NOW()` 행을 삭제하고 수를 반환.

    upload_service.finalize_upload 가 opportunistic 하게 같은 일을 하지만,
    finalize 가 한 번도 호출되지 않은 인스턴스에서도 비울 수 있도록 별도 sweeper.
    """
    res = await s.execute(
        text("DELETE FROM images_pending WHERE expires_at < NOW() RETURNING upload_id")
    )
    deleted = len(res.fetchall())
    await s.commit()
    return deleted


# ── 2) document_versions retention ────────────────────────────────────
async def _list_doc_ids(s: AsyncSession) -> list[str]:
    rows = (await s.execute(text("SELECT id FROM documents"))).all()
    return [str(r[0]) for r in rows]


async def _list_versions_for_doc(
    s: AsyncSession, doc_id: str
) -> list[dict[str, Any]]:
    """버전 목록을 edited_at DESC 로 반환 — head 가 첫 항목이 되도록."""
    rows = (await s.execute(
        text("""
            SELECT id, version, edited_at
            FROM document_versions
            WHERE document_id = CAST(:d AS uuid)
            ORDER BY version DESC
        """),
        {"d": doc_id},
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append({
            "id": str(r[0]),
            "version": int(r[1]),
            "edited_at": r[2],
        })
    return out


def _select_versions_to_keep(
    versions: list[dict[str, Any]],
    *,
    now: datetime,
) -> set[str]:
    """보존 정책에 따라 keep 할 row id 의 set 을 계산.

    Plan §11 정책:
      - 24h 이내: 전부 보존
      - 24h~30d: 같은 캘린더 day 안에서는 가장 최신 1개만
      - 30d 이상: 같은 캘린더 month 안에서는 가장 최신 1개만
      - 항상 head (최신) 와 version=1 (seed) 는 보존
    """
    if not versions:
        return set()

    keep: set[str] = set()
    threshold_24h = now - timedelta(hours=24)
    threshold_30d = now - timedelta(days=30)

    # 항상 head + version=1
    head = max(versions, key=lambda v: v["version"])
    keep.add(head["id"])
    for v in versions:
        if v["version"] == 1:
            keep.add(v["id"])

    seen_day: set[tuple[int, int, int]] = set()
    seen_month: set[tuple[int, int]] = set()

    # 정렬: 최신 edited_at 부터 — 같은 day/month 의 첫 번째가 가장 최신.
    for v in sorted(versions, key=lambda x: x["edited_at"], reverse=True):
        edited = v["edited_at"]
        if edited.tzinfo is None:
            edited = edited.replace(tzinfo=timezone.utc)
        if edited >= threshold_24h:
            keep.add(v["id"])
            continue
        if edited >= threshold_30d:
            day_key = (edited.year, edited.month, edited.day)
            if day_key not in seen_day:
                seen_day.add(day_key)
                keep.add(v["id"])
            continue
        # > 30d
        month_key = (edited.year, edited.month)
        if month_key not in seen_month:
            seen_month.add(month_key)
            keep.add(v["id"])

    return keep


async def _compact_one_doc(
    s: AsyncSession, doc_id: str, *, now: datetime
) -> int:
    versions = await _list_versions_for_doc(s, doc_id)
    if len(versions) <= 1:
        return 0
    keep_ids = _select_versions_to_keep(versions, now=now)
    delete_ids = [v["id"] for v in versions if v["id"] not in keep_ids]
    if not delete_ids:
        return 0
    # 한 번에 IN(...) 으로 삭제
    from sqlalchemy import bindparam
    stmt = text(
        "DELETE FROM document_versions WHERE id IN :ids"
    ).bindparams(bindparam("ids", expanding=True))
    await s.execute(stmt, {"ids": delete_ids})
    return len(delete_ids)


async def compact_versions(
    s: AsyncSession, doc_id: str | None = None
) -> int:
    """버전 압축. 인자 없으면 전체 문서 순회. 삭제된 버전 수 반환.

    idempotent — 한 번 실행 후 즉시 재실행하면 추가 삭제 0건.
    """
    now = datetime.now(timezone.utc)
    total = 0
    if doc_id:
        total += await _compact_one_doc(s, doc_id, now=now)
    else:
        for did in await _list_doc_ids(s):
            total += await _compact_one_doc(s, did, now=now)
    await s.commit()
    return total


# ── 3) audit_logs retention (옵션) ────────────────────────────────────
async def purge_old_audit_logs(s: AsyncSession, days: int = 365) -> int:
    """`audit_logs.created_at < NOW() - days` 행 삭제. 디폴트 365일.

    CLI 기본값은 disabled — `maintenance.py --audit-days N` 명시 시에만 호출.
    """
    if days <= 0:
        raise ValueError("days must be positive")
    res = await s.execute(
        text(
            "DELETE FROM audit_logs "
            "WHERE created_at < NOW() - (:d || ' days')::interval "
            "RETURNING id"
        ),
        {"d": str(days)},
    )
    deleted = len(res.fetchall())
    await s.commit()
    return deleted
