"""Approvals router — document review workflow + status transitions.

Endpoints (all prefixed `/api/v1`):

  - POST   /documents/{slug}/reviewers              (editor+)
        Body: { user_ids: [str, ...] }
        Adds the listed users as reviewers in `pending` state. Idempotent —
        users already present are silently skipped (no error). Inserts one
        `review_request` notification per *newly added* reviewer.

  - DELETE /documents/{slug}/reviewers/{user_id}    (editor+)
        Removes a reviewer row. Returns 204 even when the row doesn't exist
        so the FE can call this confidently from a delete button.

  - GET    /documents/{slug}/reviewers              (reader+)
        Lists reviewers + their statuses + comments + reviewer name/email.

  - POST   /documents/{slug}/reviewers/{user_id}/decision   (the reviewer)
        Body: { status: 'approved'|'rejected'|'changes_requested', comment?: str }
        The reviewer themselves submits their decision. Inserts a
        `review_decision` notification for the document author.

  - POST   /documents/{slug}/transition             (editor+/admin)
        Body: { status: 'draft'|'in_review'|'approved'|'published'|'archived' }
        Allowed transitions:
          draft       → in_review   (editor+)
          in_review   → approved    (editor+, only when ALL reviewers approved)
          in_review   → draft       (editor+)
          approved    → published   (editor+)
          published   → archived    (admin)
          archived    → draft       (admin)
        Anything else → 422.

`/api/v1/me/reviews` lists the current user's pending+changes_requested
review tasks for the "내 리뷰 요청" page.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_editor
from app.core.db import get_db
from app.core.errors import Forbidden, NotFound, ValidationFailed, envelope
from app.repos import document_repo
from app.services import notification_prefs as prefs_svc
from app.services.document_service import fire_webhook

router = APIRouter(prefix="/api/v1", tags=["approvals"])


# ── transitions table ───────────────────────────────────────────────────

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    # `draft → published` is the "바로 게시" shortcut: imported docs and
    # internal wikis often don't go through a formal review cycle, so the
    # editor can skip the in_review/approved hops. The full review path
    # stays available for cases where it makes sense.
    "draft": {"in_review", "published", "archived"},
    "in_review": {"approved", "draft", "archived"},
    "approved": {"published", "archived"},
    "published": {"archived", "draft"},
    "archived": {"draft"},
}

# admin-only edges (rest are editor+).
# Note: editor+ may archive from draft/in_review/approved (cycle 8 quick-archive
# button). published→archived stays admin-only because once published, undoing
# distribution should be a deliberate admin action.
ADMIN_ONLY_EDGES: set[tuple[str, str]] = {
    ("published", "archived"),
    ("archived", "draft"),
}

DECISION_STATUSES: set[str] = {"approved", "rejected", "changes_requested"}


# ── Pydantic bodies ─────────────────────────────────────────────────────


class AddReviewersIn(BaseModel):
    user_ids: list[str] = Field(default_factory=list, max_length=50)
    notify: bool = Field(
        default=False,
        description=(
            "True 면 새로 추가된 reviewer 의 등록 이메일로 검토 요청 메일을 "
            "best-effort 발송한다. SMTP 실패는 reviewer 생성을 되돌리지 않는다."
        ),
    )


class DecisionIn(BaseModel):
    status: str = Field(description="approved | rejected | changes_requested")
    comment: str | None = Field(default=None, max_length=2000)


class TransitionIn(BaseModel):
    status: str


# ── helpers ─────────────────────────────────────────────────────────────


async def _require_doc(s: AsyncSession, slug: str) -> dict[str, Any]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc:
        raise NotFound(f"document not found: {slug}")
    return doc


async def _list_reviewer_rows(
    s: AsyncSession, doc_id: str
) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text("""
            SELECT
              r.id, r.document_id, r.reviewer_user_id, r.status,
              r.comment, r.reviewed_at, r.added_at,
              u.email, u.name
            FROM document_reviewers r
            LEFT JOIN users u ON u.id = r.reviewer_user_id
            WHERE r.document_id = CAST(:doc AS uuid)
            ORDER BY r.added_at ASC
        """),
        {"doc": doc_id},
    )).all()
    return [
        {
            "id": str(row[0]),
            "document_id": str(row[1]),
            "reviewer_user_id": str(row[2]),
            "status": row[3],
            "comment": row[4],
            "reviewed_at": row[5].isoformat() if row[5] else None,
            "added_at": row[6].isoformat() if row[6] else None,
            "reviewer_email": row[7],
            "reviewer_name": row[8],
        }
        for row in rows
    ]


async def _insert_notification(
    s: AsyncSession,
    *,
    user_id: str,
    kind: str,
    payload: dict[str, Any],
) -> None:
    """INSERT a notifications row, honouring the recipient's in-app channel
    preference. Silently no-ops when the user has disabled this kind for in-app."""
    if not await prefs_svc.is_channel_enabled(
        s, user_id=user_id, kind=kind, channel="in_app"
    ):
        return
    await s.execute(
        text("""
            INSERT INTO notifications (user_id, kind, payload)
            VALUES (CAST(:u AS uuid), :k, CAST(:p AS jsonb))
        """),
        {
            "u": user_id,
            "k": kind,
            "p": json.dumps(payload, ensure_ascii=False),
        },
    )


# ── endpoints ───────────────────────────────────────────────────────────


@router.post(
    "/documents/{slug}/reviewers",
    status_code=201,
    summary="문서 리뷰어 추가 (editor+)",
)
async def add_reviewers(
    slug: str,
    body: AddReviewersIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    doc = await _require_doc(s, slug)
    added: list[str] = []
    skipped: list[str] = []
    seen: set[str] = set()
    for raw in body.user_ids:
        if not isinstance(raw, str):
            continue
        uid = raw.strip()
        if not uid or uid in seen:
            continue
        seen.add(uid)
        # validate user exists + active
        exists = (await s.execute(
            text(
                "SELECT 1 FROM users WHERE id = CAST(:u AS uuid) AND is_active = TRUE"
            ),
            {"u": uid},
        )).first()
        if not exists:
            skipped.append(uid)
            continue
        # ON CONFLICT — idempotent. RETURNING is empty when nothing inserted.
        ins = (await s.execute(
            text("""
                INSERT INTO document_reviewers
                  (document_id, reviewer_user_id, status)
                VALUES (CAST(:d AS uuid), CAST(:u AS uuid), 'pending')
                ON CONFLICT (document_id, reviewer_user_id) DO NOTHING
                RETURNING id
            """),
            {"d": doc["id"], "u": uid},
        )).first()
        if ins:
            added.append(uid)
            await _insert_notification(
                s,
                user_id=uid,
                kind="review_request",
                payload={
                    "document_id": doc["id"],
                    "slug": doc["slug"],
                    "title": doc["title"],
                    "from_user_id": user["id"],
                },
            )
        else:
            skipped.append(uid)

    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="approval.reviewers_added",
        target=f"document:{slug}",
        payload={"added": added, "skipped": skipped},
    )
    await s.commit()

    items = await _list_reviewer_rows(s, doc["id"])

    # Best-effort review-request emails. Toggle gated on body.notify so callers
    # opt in explicitly; failures never undo the reviewer rows above.
    notified: list[str] = []
    if body.notify and added:
        try:
            from app.services.email import review_request_email, send_email

            requester_name = (
                user.get("name") or user.get("email") or "검토 요청자"
            )
            doc_url = f"/docs/{doc['slug']}"
            for it in items:
                if it["reviewer_user_id"] not in added:
                    continue
                addr = it.get("reviewer_email")
                if not addr:
                    continue
                # Honour the reviewer's email channel preference.
                if not await prefs_svc.is_channel_enabled(
                    s,
                    user_id=it["reviewer_user_id"],
                    kind="review_request",
                    channel="email",
                ):
                    continue
                subject, body_text = review_request_email(
                    reviewer_name=it.get("reviewer_name") or "",
                    requester_name=requester_name,
                    doc_title=doc["title"],
                    doc_url=doc_url,
                )
                ok = await send_email(addr, subject, body_text)
                if ok:
                    notified.append(addr)
        except Exception:
            import logging as _logging

            _logging.getLogger(__name__).exception(
                "review-request email dispatch failed for slug=%s", slug
            )

    return envelope(
        data={
            "items": items,
            "added": added,
            "skipped": skipped,
            "notified_emails": notified,
        },
        meta={"count": len(items)},
    )


@router.delete(
    "/documents/{slug}/reviewers/{user_id}",
    status_code=204,
    summary="리뷰어 제거 (editor+)",
)
async def remove_reviewer(
    slug: str,
    user_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> Response:
    doc = await _require_doc(s, slug)
    await s.execute(
        text("""
            DELETE FROM document_reviewers
            WHERE document_id = CAST(:d AS uuid)
              AND reviewer_user_id = CAST(:u AS uuid)
        """),
        {"d": doc["id"], "u": user_id},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="approval.reviewer_removed",
        target=f"document:{slug}",
        payload={"reviewer_user_id": user_id},
    )
    await s.commit()
    return Response(status_code=204)


@router.get(
    "/documents/{slug}/reviewers",
    summary="리뷰어 목록 (reader+)",
)
async def list_reviewers(
    slug: str,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    doc = await _require_doc(s, slug)
    items = await _list_reviewer_rows(s, doc["id"])
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.post(
    "/documents/{slug}/reviewers/{user_id}/decision",
    summary="리뷰어 결정 제출 (본인만)",
)
async def submit_decision(
    slug: str,
    user_id: str,
    body: DecisionIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if user_id != user["id"]:
        raise Forbidden("only the reviewer themselves may submit a decision")
    if body.status not in DECISION_STATUSES:
        raise ValidationFailed(
            "status must be one of approved|rejected|changes_requested",
            details={"got": body.status},
        )

    doc = await _require_doc(s, slug)
    row = (await s.execute(
        text("""
            UPDATE document_reviewers
            SET status = :st,
                comment = :cm,
                reviewed_at = NOW()
            WHERE document_id = CAST(:d AS uuid)
              AND reviewer_user_id = CAST(:u AS uuid)
            RETURNING id
        """),
        {"st": body.status, "cm": body.comment, "d": doc["id"], "u": user_id},
    )).first()
    if not row:
        raise NotFound("you are not a reviewer for this document")

    # Notify the author of the doc.
    await _insert_notification(
        s,
        user_id=doc["owner_id"],
        kind="review_decision",
        payload={
            "document_id": doc["id"],
            "slug": doc["slug"],
            "title": doc["title"],
            "from_user_id": user["id"],
            "status": body.status,
            "comment": body.comment,
        },
    )

    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="approval.decision",
        target=f"document:{slug}",
        payload={"status": body.status},
    )
    await s.commit()

    await fire_webhook(
        "review_decided",
        {
            "event": "review_decided",
            "document_id": doc["id"],
            "slug": doc["slug"],
            "title": doc["title"],
            "reviewer_user_id": user_id,
            "status": body.status,
            "comment": body.comment,
        },
        target_part_id=doc.get("part_id"),
    )

    items = await _list_reviewer_rows(s, doc["id"])
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.post(
    "/documents/{slug}/transition",
    summary="문서 상태 전이 (editor+/admin)",
)
async def transition_status(
    slug: str,
    body: TransitionIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    doc = await _require_doc(s, slug)
    current = doc["status"]
    target = body.status
    allowed = ALLOWED_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise ValidationFailed(
            f"transition not allowed: {current} → {target}",
            details={"from": current, "to": target, "allowed": sorted(allowed)},
        )

    # admin-only edges
    if (current, target) in ADMIN_ONLY_EDGES and user.get("role") != "admin":
        raise Forbidden(f"transition {current} → {target} requires admin role")

    # in_review → approved requires unanimous reviewer approval.
    if current == "in_review" and target == "approved":
        rows = (await s.execute(
            text("""
                SELECT status FROM document_reviewers
                WHERE document_id = CAST(:d AS uuid)
            """),
            {"d": doc["id"]},
        )).all()
        statuses = [r[0] for r in rows]
        if not statuses or not all(st == "approved" for st in statuses):
            raise ValidationFailed(
                "all reviewers must approve before transition to approved",
                details={
                    "reviewer_count": len(statuses),
                    "approved_count": sum(1 for st in statuses if st == "approved"),
                },
            )

    await s.execute(
        text(
            """
            UPDATE documents SET status = :st, updated_at = NOW()
            WHERE id = CAST(:id AS uuid)
            """
        ),
        {"st": target, "id": doc["id"]},
    )
    await document_repo.insert_audit(
        s,
        user_id=user["id"],
        action="approval.transition",
        target=f"document:{slug}",
        payload={"from": current, "to": target},
    )
    await s.commit()

    # ── Sync Meilisearch (CRITICAL — without this, draft→published
    # leaves the doc out of search even though it's in the DB).
    # `documents_flat_v` (status='published' 필터) 를 **먼저 refresh** 해야
    # upsert_document 가 방금 발행된 문서를 본다. create_document 와 동일하게
    # commit 이후에 실행한다 (CONCURRENTLY refresh 는 트랜잭션 밖이어야 함).
    #   - target=published → matview 에 등장 → upsert
    #   - target=archived  → 인덱스에서 delete
    from app.services.document_service import refresh_search_view, reindex_meili
    await refresh_search_view(s)
    await reindex_meili(
        s,
        doc_id=str(doc["id"]),
        archived=(target == "archived"),
    )

    if target == "published":
        await fire_webhook(
            "doc_published",
            {
                "event": "doc_published",
                "document_id": doc["id"],
                "slug": doc["slug"],
                "title": doc["title"],
                "actor_user_id": user["id"],
                "from_status": current,
            },
            target_part_id=doc.get("part_id"),
        )

    # Cycle 0025 — automation triggers. `doc_archived` fires whenever
    # the target status is `archived`; `status_transition` fires for
    # *every* transition so admins can write rules like
    # "(from=in_review, to=approved) → blast notification".
    if target == "archived":
        await fire_webhook(
            "doc_archived",
            {
                "event": "doc_archived",
                "document_id": doc["id"],
                "slug": doc["slug"],
                "title": doc["title"],
                "actor_user_id": user["id"],
                "from_status": current,
            },
            target_part_id=doc.get("part_id"),
        )
    await fire_webhook(
        "status_transition",
        {
            "event": "status_transition",
            "document_id": doc["id"],
            "slug": doc["slug"],
            "title": doc["title"],
            "actor_user_id": user["id"],
            "from": current,
            "to": target,
        },
        target_part_id=doc.get("part_id"),
    )

    return envelope(data={"slug": slug, "status": target, "from": current})


@router.get(
    "/me/reviews",
    summary="내가 리뷰어로 지정된 문서 (pending + changes_requested)",
)
async def my_reviews(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    rows = (await s.execute(
        text("""
            SELECT
              d.slug, d.title, d.status,
              r.status, r.added_at, r.reviewed_at,
              d.owner_id, u.name, u.email
            FROM document_reviewers r
            JOIN documents d ON d.id = r.document_id
            LEFT JOIN users u ON u.id = d.owner_id
            WHERE r.reviewer_user_id = CAST(:u AS uuid)
              AND r.status IN ('pending','changes_requested')
              AND d.status != 'archived'
            ORDER BY r.added_at DESC
        """),
        {"u": user["id"]},
    )).all()
    items = [
        {
            "slug": row[0],
            "title": row[1],
            "doc_status": row[2],
            "review_status": row[3],
            "added_at": row[4].isoformat() if row[4] else None,
            "reviewed_at": row[5].isoformat() if row[5] else None,
            "author_id": str(row[6]) if row[6] else None,
            "author_name": row[7],
            "author_email": row[8],
        }
        for row in rows
    ]
    return envelope(data={"items": items}, meta={"count": len(items)})
