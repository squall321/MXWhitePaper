"""Activity feed router — aggregated stream of events across the wiki.

Endpoints (all prefixed `/api/v1`):

  - GET /activity?since=ISO&limit=50&kind=...
        Aggregated stream of events for the dashboard / activity feed.
        Supported kinds (filter via ?kind=, comma-separated allowed):
          - doc_edited         (document_versions, version > 1)
          - doc_created        (document_versions, version == 1)
          - comment_added      (comments, status='visible')
          - share_link_created (share_links)
          - bookmark_added     (bookmarks)
          - review_requested   (document_reviewers, status='pending')
          - review_decided     (document_reviewers, status != 'pending'
                                AND reviewed_at IS NOT NULL)
          - snippet_created    (snippets)

  - GET /activity/me
        Same shape, filtered to events that involve the current user
        (target.author = me OR I'm a reviewer OR I created the source row).

Implementation: each source table is queried separately with a small SQL
projection. Rows are merged in Python by timestamp DESC. This keeps the
SQL simple — a single UNION view would push complexity into a migration
and would still need per-kind branching for `summary` text. The merge
runs over a capped per-source limit (50), so the cost is bounded.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.db import get_db
from app.core.errors import envelope

router = APIRouter(prefix="/api/v1", tags=["activity"])


ALL_KINDS: tuple[str, ...] = (
    "doc_edited",
    "doc_created",
    "comment_added",
    "share_link_created",
    "bookmark_added",
    "review_requested",
    "review_decided",
    "snippet_created",
)


def _parse_since(since: str | None) -> datetime | None:
    if not since:
        return None
    try:
        # Accept both `Z` suffix and offset.
        s = since.replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _parse_kinds(kind: str | None) -> set[str]:
    if not kind:
        return set(ALL_KINDS)
    requested = {k.strip() for k in kind.split(",") if k.strip()}
    return requested & set(ALL_KINDS) or set(ALL_KINDS)


def _ts_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _actor(user_id: Any, name: Any, email: Any) -> dict[str, Any]:
    return {
        "user_id": str(user_id) if user_id else None,
        "name": name or (email.split("@")[0] if email else None) or "알 수 없음",
    }


def _build_summary(kind: str, actor_name: str, title: str | None) -> str:
    title_label = title or "(제목 없음)"
    if kind == "doc_edited":
        return f"{actor_name}이(가) '{title_label}'을(를) 편집했습니다"
    if kind == "doc_created":
        return f"{actor_name}이(가) '{title_label}'을(를) 만들었습니다"
    if kind == "comment_added":
        return f"{actor_name}이(가) '{title_label}'에 댓글을 남겼습니다"
    if kind == "share_link_created":
        return f"{actor_name}이(가) '{title_label}'의 공유 링크를 만들었습니다"
    if kind == "bookmark_added":
        return f"{actor_name}이(가) '{title_label}'을(를) 책갈피에 추가했습니다"
    if kind == "review_requested":
        return f"{actor_name}에게 '{title_label}'의 리뷰가 요청되었습니다"
    if kind == "review_decided":
        return f"{actor_name}이(가) '{title_label}'의 리뷰를 마쳤습니다"
    if kind == "snippet_created":
        return f"{actor_name}이(가) 스니펫 '{title_label}'을(를) 만들었습니다"
    return f"{actor_name}: {title_label}"


# ── per-source loaders ─────────────────────────────────────────────────


async def _load_doc_versions(
    s: AsyncSession,
    *,
    since: datetime | None,
    limit: int,
    me_id: str | None = None,
) -> list[dict[str, Any]]:
    """Yield doc_edited (version>1) and doc_created (version=1) rows."""
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit}
    if since:
        where.append("v.edited_at >= :since")
        params["since"] = since
    if me_id:
        where.append(
            "(v.edited_by = CAST(:me AS uuid) OR d.owner_id = CAST(:me AS uuid))"
        )
        params["me"] = me_id
    rows = (await s.execute(
        text(f"""
            SELECT
              v.id, v.document_id, v.version, v.edited_at, v.change_log,
              v.edited_by, u.name, u.email,
              d.slug, d.title
            FROM document_versions v
            JOIN documents d ON d.id = v.document_id
            LEFT JOIN users u ON u.id = v.edited_by
            WHERE {' AND '.join(where)}
            ORDER BY v.edited_at DESC
            LIMIT :lim
        """),
        params,
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        kind = "doc_created" if int(r[2]) == 1 else "doc_edited"
        actor = _actor(r[5], r[6], r[7])
        ts = _ts_iso(r[3])
        out.append({
            "id": f"version:{r[0]}",
            "kind": kind,
            "actor": actor,
            "target": {
                "document_id": str(r[1]) if r[1] else None,
                "slug": r[8],
                "title": r[9],
            },
            "timestamp": ts,
            "summary": _build_summary(kind, actor["name"], r[9]),
            "metadata": {
                "version": int(r[2]),
                "change_log": r[4],
            },
        })
    return out


async def _load_comments(
    s: AsyncSession,
    *,
    since: datetime | None,
    limit: int,
    me_id: str | None = None,
) -> list[dict[str, Any]]:
    where = ["c.status = 'visible'"]
    params: dict[str, Any] = {"lim": limit}
    if since:
        where.append("c.created_at >= :since")
        params["since"] = since
    if me_id:
        where.append(
            "(c.author_id = CAST(:me AS uuid) OR d.owner_id = CAST(:me AS uuid))"
        )
        params["me"] = me_id
    rows = (await s.execute(
        text(f"""
            SELECT
              c.id, c.document_id, c.created_at, c.author_id,
              u.name, u.email,
              d.slug, d.title,
              c.anchor_kind, c.anchor_id
            FROM comments c
            JOIN documents d ON d.id = c.document_id
            LEFT JOIN users u ON u.id = c.author_id
            WHERE {' AND '.join(where)}
            ORDER BY c.created_at DESC
            LIMIT :lim
        """),
        params,
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        actor = _actor(r[3], r[4], r[5])
        ts = _ts_iso(r[2])
        out.append({
            "id": f"comment:{r[0]}",
            "kind": "comment_added",
            "actor": actor,
            "target": {
                "document_id": str(r[1]) if r[1] else None,
                "slug": r[6],
                "title": r[7],
            },
            "timestamp": ts,
            "summary": _build_summary("comment_added", actor["name"], r[7]),
            "metadata": {
                "anchor_kind": r[8],
                "anchor_id": r[9],
            },
        })
    return out


async def _load_share_links(
    s: AsyncSession,
    *,
    since: datetime | None,
    limit: int,
    me_id: str | None = None,
) -> list[dict[str, Any]]:
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit}
    if since:
        where.append("sl.created_at >= :since")
        params["since"] = since
    if me_id:
        where.append(
            "(sl.created_by = CAST(:me AS uuid) OR d.owner_id = CAST(:me AS uuid))"
        )
        params["me"] = me_id
    rows = (await s.execute(
        text(f"""
            SELECT
              sl.id, sl.document_id, sl.created_at, sl.created_by,
              u.name, u.email,
              d.slug, d.title
            FROM share_links sl
            JOIN documents d ON d.id = sl.document_id
            LEFT JOIN users u ON u.id = sl.created_by
            WHERE {' AND '.join(where)}
            ORDER BY sl.created_at DESC
            LIMIT :lim
        """),
        params,
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        actor = _actor(r[3], r[4], r[5])
        ts = _ts_iso(r[2])
        out.append({
            "id": f"share:{r[0]}",
            "kind": "share_link_created",
            "actor": actor,
            "target": {
                "document_id": str(r[1]) if r[1] else None,
                "slug": r[6],
                "title": r[7],
            },
            "timestamp": ts,
            "summary": _build_summary("share_link_created", actor["name"], r[7]),
            "metadata": {},
        })
    return out


async def _load_bookmarks(
    s: AsyncSession,
    *,
    since: datetime | None,
    limit: int,
    me_id: str | None = None,
) -> list[dict[str, Any]]:
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit}
    if since:
        where.append("b.created_at >= :since")
        params["since"] = since
    if me_id:
        where.append(
            "(b.user_id = CAST(:me AS uuid) OR d.owner_id = CAST(:me AS uuid))"
        )
        params["me"] = me_id
    rows = (await s.execute(
        text(f"""
            SELECT
              b.id, b.document_id, b.created_at, b.user_id,
              u.name, u.email,
              d.slug, d.title, b.folder
            FROM bookmarks b
            JOIN documents d ON d.id = b.document_id
            LEFT JOIN users u ON u.id = b.user_id
            WHERE {' AND '.join(where)}
            ORDER BY b.created_at DESC
            LIMIT :lim
        """),
        params,
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        actor = _actor(r[3], r[4], r[5])
        ts = _ts_iso(r[2])
        out.append({
            "id": f"bookmark:{r[0]}",
            "kind": "bookmark_added",
            "actor": actor,
            "target": {
                "document_id": str(r[1]) if r[1] else None,
                "slug": r[6],
                "title": r[7],
            },
            "timestamp": ts,
            "summary": _build_summary("bookmark_added", actor["name"], r[7]),
            "metadata": {"folder": r[8]},
        })
    return out


async def _load_reviewers(
    s: AsyncSession,
    *,
    since: datetime | None,
    limit: int,
    me_id: str | None = None,
) -> list[dict[str, Any]]:
    """Returns review_requested + review_decided rows."""
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit}
    # Use the most recent of (added_at, reviewed_at) as the row's effective ts.
    # Pending → added_at, decided → reviewed_at.
    if since:
        where.append("COALESCE(r.reviewed_at, r.added_at) >= :since")
        params["since"] = since
    if me_id:
        where.append(
            "(r.reviewer_user_id = CAST(:me AS uuid) "
            "OR d.owner_id = CAST(:me AS uuid))"
        )
        params["me"] = me_id
    rows = (await s.execute(
        text(f"""
            SELECT
              r.id, r.document_id, r.status, r.reviewed_at, r.added_at,
              r.reviewer_user_id, u.name, u.email,
              d.slug, d.title, r.comment
            FROM document_reviewers r
            JOIN documents d ON d.id = r.document_id
            LEFT JOIN users u ON u.id = r.reviewer_user_id
            WHERE {' AND '.join(where)}
            ORDER BY COALESCE(r.reviewed_at, r.added_at) DESC
            LIMIT :lim
        """),
        params,
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        status = r[2]
        actor = _actor(r[5], r[6], r[7])
        if status == "pending":
            kind = "review_requested"
            ts = _ts_iso(r[4])
        else:
            kind = "review_decided"
            ts = _ts_iso(r[3] or r[4])
        out.append({
            "id": f"review:{r[0]}:{status}",
            "kind": kind,
            "actor": actor,
            "target": {
                "document_id": str(r[1]) if r[1] else None,
                "slug": r[8],
                "title": r[9],
            },
            "timestamp": ts,
            "summary": _build_summary(kind, actor["name"], r[9]),
            "metadata": {
                "status": status,
                "comment": r[10],
            },
        })
    return out


async def _load_snippets(
    s: AsyncSession,
    *,
    since: datetime | None,
    limit: int,
    me_id: str | None = None,
) -> list[dict[str, Any]]:
    where = ["1=1"]
    params: dict[str, Any] = {"lim": limit}
    if since:
        where.append("sn.created_at >= :since")
        params["since"] = since
    if me_id:
        where.append("sn.owner_user_id = CAST(:me AS uuid)")
        params["me"] = me_id
    rows = (await s.execute(
        text(f"""
            SELECT
              sn.id, sn.created_at, sn.owner_user_id,
              u.name, u.email, sn.name, sn.scope
            FROM snippets sn
            LEFT JOIN users u ON u.id = sn.owner_user_id
            WHERE {' AND '.join(where)}
            ORDER BY sn.created_at DESC
            LIMIT :lim
        """),
        params,
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        actor = _actor(r[2], r[3], r[4])
        ts = _ts_iso(r[1])
        out.append({
            "id": f"snippet:{r[0]}",
            "kind": "snippet_created",
            "actor": actor,
            "target": {
                "document_id": None,
                "slug": None,
                "title": r[5],
            },
            "timestamp": ts,
            "summary": _build_summary("snippet_created", actor["name"], r[5]),
            "metadata": {"scope": r[6]},
        })
    return out


# ── public endpoints ───────────────────────────────────────────────────


async def _aggregate(
    s: AsyncSession,
    *,
    kinds: set[str],
    since: datetime | None,
    limit: int,
    me_id: str | None = None,
) -> list[dict[str, Any]]:
    """Run only the loaders we need, merge by timestamp DESC, return top N."""
    # Per-source pull caps at the requested limit so the merge is bounded.
    per = max(limit, 1)
    bucket: list[dict[str, Any]] = []

    if "doc_edited" in kinds or "doc_created" in kinds:
        rows = await _load_doc_versions(s, since=since, limit=per, me_id=me_id)
        bucket.extend(r for r in rows if r["kind"] in kinds)

    if "comment_added" in kinds:
        bucket.extend(
            await _load_comments(s, since=since, limit=per, me_id=me_id)
        )

    if "share_link_created" in kinds:
        bucket.extend(
            await _load_share_links(s, since=since, limit=per, me_id=me_id)
        )

    if "bookmark_added" in kinds:
        bucket.extend(
            await _load_bookmarks(s, since=since, limit=per, me_id=me_id)
        )

    if "review_requested" in kinds or "review_decided" in kinds:
        rows = await _load_reviewers(s, since=since, limit=per, me_id=me_id)
        bucket.extend(r for r in rows if r["kind"] in kinds)

    if "snippet_created" in kinds:
        bucket.extend(
            await _load_snippets(s, since=since, limit=per, me_id=me_id)
        )

    # Sort by timestamp DESC. Missing timestamps sink to the bottom.
    bucket.sort(key=lambda e: e.get("timestamp") or "", reverse=True)
    return bucket[:limit]


@router.get(
    "/activity",
    summary="활동 피드 — 다양한 출처를 합쳐 최신순 반환",
)
async def list_activity(
    since: str | None = Query(default=None, description="ISO 시각 — 이 시각 이후만"),
    limit: int = Query(default=50, ge=1, le=200),
    kind: str | None = Query(
        default=None,
        description=(
            "comma-separated list of kinds. allowed: "
            + ", ".join(ALL_KINDS)
        ),
    ),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    kinds = _parse_kinds(kind)
    since_dt = _parse_since(since)
    items = await _aggregate(s, kinds=kinds, since=since_dt, limit=limit)
    return envelope(
        data={"items": items},
        meta={"count": len(items), "kinds": sorted(kinds)},
    )


@router.get(
    "/activity/me",
    summary="내가 관여한 활동 피드 — 작성자/리뷰어/오너 기준",
)
async def list_my_activity(
    since: str | None = Query(default=None, description="ISO 시각 — 이 시각 이후만"),
    limit: int = Query(default=50, ge=1, le=200),
    kind: str | None = Query(default=None),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    kinds = _parse_kinds(kind)
    since_dt = _parse_since(since)
    items = await _aggregate(
        s,
        kinds=kinds,
        since=since_dt,
        limit=limit,
        me_id=user["id"],
    )
    return envelope(
        data={"items": items},
        meta={"count": len(items), "kinds": sorted(kinds)},
    )
