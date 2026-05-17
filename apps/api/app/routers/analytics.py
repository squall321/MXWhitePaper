"""사용량 분석 라우터 (Tier 2D + Cycle 0016).

reader+ 누구나 접근 가능. 데이터는 audit_logs / links / documents / document_reads /
anchor_samples 테이블에서 추정값으로 집계한다.

  - GET /api/v1/analytics/overview      MAU, total_docs/links, avg_backlinks,
                                        top_searches, top_viewed_docs
  - GET /api/v1/analytics/daily?days=N  일별 active_users / writes / reads / search
  - GET /api/v1/analytics/top-views?days=N  최근 N일 동안 가장 많이 조회된 문서 top 10

Cycle 0016 — 문서 단위 분석 + 조직 분석 추가:
  - GET /api/v1/analytics/documents/{slug}  per-doc detail (editor+ for that doc)
  - GET /api/v1/analytics/inactive-docs     장기 미열람/미수정 문서 (admin)
  - GET /api/v1/analytics/top-docs          조직 단위 인기 문서 (reader+)
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_admin, require_reader
from app.core.db import get_db
from app.core.errors import Forbidden, NotFound, envelope

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


@router.get("/overview", summary="대시보드 오버뷰")
async def overview(
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    mau = int((await s.execute(
        text(
            "SELECT COUNT(DISTINCT user_id) FROM audit_logs "
            "WHERE user_id IS NOT NULL "
            "AND created_at >= NOW() - INTERVAL '30 days'"
        )
    )).scalar() or 0)

    total_docs = int((await s.execute(
        text("SELECT COUNT(*) FROM documents WHERE status != 'archived'")
    )).scalar() or 0)

    total_links = int((await s.execute(text("SELECT COUNT(*) FROM links"))).scalar() or 0)

    avg_backlinks = 0.0
    if total_docs > 0:
        avg_backlinks = float((await s.execute(text(
            "SELECT COALESCE(AVG(c), 0)::float FROM ("
            "  SELECT COUNT(*) AS c FROM links GROUP BY target_doc_id"
            ") sub"
        ))).scalar() or 0.0)

    top_searches_rows = (await s.execute(text("""
        SELECT target, COUNT(*) AS n
        FROM audit_logs
        WHERE action = 'search' AND target IS NOT NULL AND target != ''
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY target
        ORDER BY n DESC
        LIMIT 10
    """))).all()
    top_searches = [{"q": r[0], "count": int(r[1])} for r in top_searches_rows]

    top_viewed_rows = (await s.execute(text("""
        SELECT a.target, COUNT(*) AS n,
               COALESCE(d.title, a.target) AS title
        FROM audit_logs a
        LEFT JOIN documents d ON ('document:' || d.slug) = a.target
        WHERE a.action = 'document.view'
          AND a.created_at >= NOW() - INTERVAL '30 days'
        GROUP BY a.target, d.title
        ORDER BY n DESC
        LIMIT 10
    """))).all()
    top_viewed_docs = [
        {
            "target": r[0],
            "slug": (r[0] or "").removeprefix("document:"),
            "title": r[2],
            "count": int(r[1]),
        }
        for r in top_viewed_rows
    ]

    return envelope(data={
        "mau": mau,
        "total_docs": total_docs,
        "total_links": total_links,
        "avg_backlinks": round(avg_backlinks, 2),
        "top_searches": top_searches,
        "top_viewed_docs": top_viewed_docs,
    })


@router.get("/daily", summary="일별 활성 / 쓰기 / 읽기 / 검색 카운트")
async def daily(
    days: int = Query(default=30, ge=1, le=180),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    sql = """
        WITH d AS (
            SELECT generate_series(
                date_trunc('day', NOW() - (:days_minus_1 || ' days')::interval),
                date_trunc('day', NOW()),
                '1 day'::interval
            )::date AS day
        ),
        agg AS (
            SELECT date_trunc('day', created_at)::date AS day,
                   COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS active_users,
                   COUNT(*) FILTER (WHERE action LIKE 'document.create'
                                       OR action LIKE 'document.update'
                                       OR action LIKE 'document.patch') AS doc_writes,
                   COUNT(*) FILTER (WHERE action = 'document.view') AS doc_reads,
                   COUNT(*) FILTER (WHERE action = 'search') AS search_count
            FROM audit_logs
            WHERE created_at >= NOW() - (:days_minus_1 || ' days')::interval
            GROUP BY 1
        )
        SELECT d.day,
               COALESCE(agg.active_users, 0) AS active_users,
               COALESCE(agg.doc_writes, 0) AS doc_writes,
               COALESCE(agg.doc_reads, 0) AS doc_reads,
               COALESCE(agg.search_count, 0) AS search_count
        FROM d LEFT JOIN agg ON agg.day = d.day
        ORDER BY d.day
    """
    rows = (await s.execute(text(sql), {"days_minus_1": str(days - 1)})).all()
    items = [
        {
            "date": r[0].isoformat() if r[0] else None,
            "active_users": int(r[1]),
            "doc_writes": int(r[2]),
            "doc_reads": int(r[3]),
            "search_count": int(r[4]),
        }
        for r in rows
    ]
    return envelope(data=items, meta={"count": len(items), "days": days})


@router.get("/top-views", summary="최근 N일 가장 많이 조회된 문서 top 10")
async def top_views(
    days: int = Query(default=7, ge=1, le=180),
    limit: int = Query(default=10, ge=1, le=50),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT a.target, COUNT(*) AS n,
                   COALESCE(d.title, a.target) AS title,
                   d.slug
            FROM audit_logs a
            LEFT JOIN documents d ON ('document:' || d.slug) = a.target
            WHERE a.action = 'document.view'
              AND a.created_at >= NOW() - (:d || ' days')::interval
            GROUP BY a.target, d.title, d.slug
            ORDER BY n DESC
            LIMIT :lim
        """),
        {"d": str(days), "lim": limit},
    )).all()
    items = [
        {
            "target": r[0],
            "slug": r[3] if r[3] else (r[0] or "").removeprefix("document:"),
            "title": r[2],
            "count": int(r[1]),
        }
        for r in rows
    ]
    return envelope(data=items, meta={"count": len(items), "days": days})


# ── Cycle 0016 — per-doc detail + inactive + org top-docs ────────────────


def _can_view_doc_analytics(user: dict[str, Any], owner_id: str | None) -> bool:
    """admin/owner 본인이거나 editor 역할 이상이면 허용."""
    role = user.get("role", "")
    if role == "admin":
        return True
    if owner_id and str(owner_id) == str(user.get("id")):
        return True
    return role in {"editor", "owner"}


async def _resolve_section_titles(
    s: AsyncSession, document_id: str
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    """anchor_samples 의 (section_id, block_id) 쌍을 사람이 읽을 수 있는
    섹션 제목으로 매핑. content_json 에서 sections 트리를 1번만 읽고
    (section_lookup, block_to_section) 두 사전을 만들어 반환한다.
    """
    row = (await s.execute(
        text("SELECT content_json FROM documents WHERE id = CAST(:id AS uuid)"),
        {"id": document_id},
    )).first()
    if not row:
        return ({}, {})
    content = row[0] or {}
    sections = content.get("sections") or []

    out: dict[str, dict[str, Any]] = {}
    block_to_section: dict[str, str] = {}

    def walk(sec: dict[str, Any]) -> None:
        sid = sec.get("id")
        if sid:
            number = sec.get("number")
            title = sec.get("title") or ""
            label = f"{number} {title}".strip() if number else title
            out[sid] = {"title": label or sid}
        for block in (sec.get("blocks") or []):
            bid = block.get("id") if isinstance(block, dict) else None
            if bid and sid:
                block_to_section[bid] = sid
        for sub in (sec.get("subsections") or []):
            if isinstance(sub, dict):
                walk(sub)

    for sec in sections:
        if isinstance(sec, dict):
            walk(sec)

    return (out, block_to_section)


@router.get(
    "/documents/{slug}",
    summary="문서별 상세 분석 (editor+ or doc owner)",
)
async def document_analytics(
    slug: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    # 1) Resolve doc id + ownership
    doc = (await s.execute(
        text("""
            SELECT id, owner_id, title, status
            FROM documents WHERE slug = :slug
        """),
        {"slug": slug},
    )).first()
    if not doc:
        raise NotFound(f"document '{slug}' not found")
    doc_id = str(doc[0])
    owner_id = str(doc[1]) if doc[1] else None
    if not _can_view_doc_analytics(user, owner_id):
        raise Forbidden("editor 권한 또는 문서 소유자만 분석을 조회할 수 있습니다")

    # 2) Aggregates over document_reads. unique_readers + view counts come
    #    from audit_logs (every page hit), avg/median time-on-doc come
    #    from document_reads (cumulative).
    summary_row = (await s.execute(
        text("""
            SELECT
              (SELECT COUNT(*) FROM audit_logs
                WHERE action = 'document.view'
                  AND target = :tgt) AS total_views,
              (SELECT COUNT(DISTINCT user_id) FROM document_reads
                WHERE document_id = CAST(:d AS uuid)) AS unique_readers,
              (SELECT COALESCE(AVG(read_seconds), 0)::float FROM document_reads
                WHERE document_id = CAST(:d AS uuid)) AS avg_seconds,
              (SELECT COALESCE(
                 PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY read_seconds),
                 0
               )::float FROM document_reads
                WHERE document_id = CAST(:d AS uuid)) AS median_seconds
        """),
        {"tgt": f"document:{slug}", "d": doc_id},
    )).first()

    total_views = int(summary_row[0] or 0) if summary_row else 0
    unique_readers = int(summary_row[1] or 0) if summary_row else 0
    avg_seconds = round(float(summary_row[2] or 0)) if summary_row else 0
    median_seconds = round(float(summary_row[3] or 0)) if summary_row else 0

    # 3) Last 30 days view buckets (gap-filled).
    daily_rows = (await s.execute(
        text("""
            WITH d AS (
              SELECT generate_series(
                date_trunc('day', NOW() - INTERVAL '29 days'),
                date_trunc('day', NOW()),
                '1 day'::interval
              )::date AS day
            ),
            agg AS (
              SELECT date_trunc('day', created_at)::date AS day, COUNT(*) AS n
              FROM audit_logs
              WHERE action = 'document.view'
                AND target = :tgt
                AND created_at >= NOW() - INTERVAL '29 days'
              GROUP BY 1
            )
            SELECT d.day, COALESCE(agg.n, 0) AS n
            FROM d LEFT JOIN agg ON agg.day = d.day
            ORDER BY d.day
        """),
        {"tgt": f"document:{slug}"},
    )).all()
    last_30_days = [
        {"date": r[0].isoformat() if r[0] else None, "views": int(r[1])}
        for r in daily_rows
    ]

    # 4) Top referrers — best-effort from audit_logs payload.referrer_kind.
    #    Falls back to 'direct' if we don't know.
    ref_rows = (await s.execute(
        text("""
            SELECT
              COALESCE(NULLIF(payload->>'referrer_kind', ''), 'direct') AS kind,
              COUNT(*) AS n
            FROM audit_logs
            WHERE action = 'document.view'
              AND target = :tgt
              AND created_at >= NOW() - INTERVAL '30 days'
            GROUP BY 1
            ORDER BY n DESC
            LIMIT 10
        """),
        {"tgt": f"document:{slug}"},
    )).all()
    top_referrers = [{"kind": r[0], "count": int(r[1])} for r in ref_rows]

    # 5) Section attention heat-map: derive seconds-per-section by counting
    #    consecutive samples per (user, section). Each consecutive sample
    #    represents ~30s of dwell. Average over distinct visitors.
    section_lookup, block_to_section = await _resolve_section_titles(s, doc_id)

    sample_rows = (await s.execute(
        text("""
            SELECT user_id, section_id, block_id
            FROM anchor_samples
            WHERE document_id = CAST(:d AS uuid)
              AND sampled_at >= NOW() - INTERVAL '30 days'
            ORDER BY user_id, sampled_at
        """),
        {"d": doc_id},
    )).all()

    # Group: section_id -> {user_id -> consecutive sample count}
    per_section: dict[str, dict[str, int]] = {}
    for r in sample_rows:
        uid = str(r[0])
        sid = r[1]
        bid = r[2]
        # Map block -> section via doc tree if FE didn't send section_id.
        if not sid and bid:
            sid = block_to_section.get(bid)
        if not sid:
            continue
        bucket = per_section.setdefault(sid, {})
        bucket[uid] = bucket.get(uid, 0) + 1

    # SAMPLE_INTERVAL_SECONDS — must match useReadingTimeTracker flush cadence.
    sample_interval = 30
    section_attention: list[dict[str, Any]] = []
    for sid, users_counts in per_section.items():
        meta = section_lookup.get(sid) or {"title": sid}
        if not users_counts:
            continue
        avg_samples = sum(users_counts.values()) / len(users_counts)
        section_attention.append({
            "section_id": sid,
            "section_title": meta["title"],
            "est_seconds_per_visitor": round(avg_samples * sample_interval),
        })
    section_attention.sort(
        key=lambda x: x["est_seconds_per_visitor"], reverse=True,
    )

    return envelope(data={
        "slug": slug,
        "title": doc[2],
        "total_views": total_views,
        "unique_readers": unique_readers,
        "avg_read_seconds": avg_seconds,
        "median_read_seconds": median_seconds,
        "last_30_days": last_30_days,
        "top_referrers": top_referrers,
        "section_attention": section_attention,
    })


@router.get(
    "/inactive-docs",
    summary="장기 미열람/미수정 문서 (admin)",
)
async def inactive_docs(
    since_days: int = Query(default=90, ge=7, le=365),
    limit: int = Query(default=100, ge=1, le=500),
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            WITH last_edit AS (
              SELECT document_id, MAX(edited_at) AS edited_at
              FROM document_versions
              GROUP BY document_id
            ),
            last_read AS (
              SELECT document_id, MAX(read_at) AS read_at
              FROM document_reads
              GROUP BY document_id
            )
            SELECT d.slug, d.title,
                   COALESCE(le.edited_at, d.updated_at) AS last_edited,
                   lr.read_at AS last_read,
                   u.name AS owner_name,
                   u.email AS owner_email
            FROM documents d
            LEFT JOIN last_edit le ON le.document_id = d.id
            LEFT JOIN last_read lr ON lr.document_id = d.id
            LEFT JOIN users u ON u.id = d.owner_id
            WHERE d.status != 'archived'
              AND COALESCE(le.edited_at, d.updated_at)
                  < NOW() - (:n || ' days')::interval
              AND (lr.read_at IS NULL
                   OR lr.read_at < NOW() - (:n || ' days')::interval)
            ORDER BY COALESCE(lr.read_at, le.edited_at, d.updated_at) ASC
            LIMIT :lim
        """),
        {"n": str(since_days), "lim": limit},
    )).all()
    items = [
        {
            "slug": r[0],
            "title": r[1],
            "last_edited": r[2].isoformat() if r[2] else None,
            "last_read": r[3].isoformat() if r[3] else None,
            "owner_name": r[4] or r[5] or "—",
        }
        for r in rows
    ]
    return envelope(
        data=items, meta={"count": len(items), "since_days": since_days},
    )


@router.get(
    "/top-docs",
    summary="조직 단위 인기 문서 (reader+)",
)
async def top_docs(
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=20, ge=1, le=100),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            WITH views AS (
              SELECT a.target,
                     COUNT(*) AS views
              FROM audit_logs a
              WHERE a.action = 'document.view'
                AND a.created_at >= NOW() - (:n || ' days')::interval
              GROUP BY a.target
            ),
            reads AS (
              SELECT document_id,
                     COUNT(DISTINCT user_id) AS unique_readers,
                     COALESCE(AVG(read_seconds), 0)::float AS avg_seconds
              FROM document_reads
              GROUP BY document_id
            )
            SELECT d.slug, d.title,
                   COALESCE(v.views, 0) AS views,
                   COALESCE(r.unique_readers, 0) AS unique_readers,
                   COALESCE(r.avg_seconds, 0) AS avg_seconds
            FROM documents d
            LEFT JOIN views v ON v.target = ('document:' || d.slug)
            LEFT JOIN reads r ON r.document_id = d.id
            WHERE d.status != 'archived'
              AND COALESCE(v.views, 0) > 0
            ORDER BY views DESC, unique_readers DESC
            LIMIT :lim
        """),
        {"n": str(days), "lim": limit},
    )).all()
    items = [
        {
            "slug": r[0],
            "title": r[1],
            "views": int(r[2]),
            "unique_readers": int(r[3]),
            "avg_read_seconds": round(float(r[4])),
        }
        for r in rows
    ]
    return envelope(data=items, meta={"count": len(items), "days": days})
