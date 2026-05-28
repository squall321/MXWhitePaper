"""glossary-knowledge-graph — terms / term_domains / term_proposals raw-SQL repo.

document_repo.py 패턴 일관 (raw SQL + asyncpg). ORM 모델 미선언.

Plan: docs/01-plan/features/glossary-knowledge-graph.plan.md §4, §2.1
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# ─────────────────────────────────────────────────────────────────────────
# SELECT 컬럼 — 모든 GET 응답이 일관된 형태를 갖도록.
# ─────────────────────────────────────────────────────────────────────────
TERM_COLS = (
    "id, term, definition, domain, subdomain, term_en, "
    "COALESCE(aliases, '{}') AS aliases, "
    "status, "
    "proposed_by, proposed_at, "
    "approved_by, approved_at, "
    "rejected_by, reject_reason, "
    "page_doc_id, "
    "COALESCE(array_length(related_docs, 1), 0) AS related_doc_count"
)


def _row_to_term(row: Any) -> dict[str, Any]:
    """terms row → dict (응답용)."""
    return {
        "id": str(row[0]),
        "term": row[1],
        "definition": row[2],
        "domain": row[3],
        "subdomain": row[4],
        "term_en": row[5],
        "aliases": list(row[6] or []),
        "status": row[7],
        "proposed_by": str(row[8]) if row[8] else None,
        "proposed_at": row[9].isoformat() if row[9] else None,
        "approved_by": str(row[10]) if row[10] else None,
        "approved_at": row[11].isoformat() if row[11] else None,
        "rejected_by": str(row[12]) if row[12] else None,
        "reject_reason": row[13],
        "page_doc_id": str(row[14]) if row[14] else None,
        "related_doc_count": int(row[15] or 0),
    }


# ─────────────────────────────────────────────────────────────────────────
# Create / propose
# ─────────────────────────────────────────────────────────────────────────
async def propose_term(
    s: AsyncSession,
    *,
    term: str,
    definition: str,
    domain: str | None,
    subdomain: str | None,
    term_en: str | None,
    aliases: list[str],
    user_id: str,
) -> dict[str, Any]:
    """`status='proposed'` 신규 row INSERT. UNIQUE 충돌은 호출자가 잡음."""
    row = (await s.execute(
        text(f"""
            INSERT INTO terms
                (term, definition, domain, subdomain, term_en, aliases,
                 status, proposed_by, proposed_at)
            VALUES
                (:term, :def, :domain, :subdomain, :term_en, :aliases,
                 'proposed', CAST(:uid AS uuid), NOW())
            RETURNING {TERM_COLS}
        """),
        {
            "term": term,
            "def": definition,
            "domain": domain,
            "subdomain": subdomain,
            "term_en": term_en,
            "aliases": aliases,
            "uid": user_id,
        },
    )).first()
    assert row is not None
    return _row_to_term(row)


# ─────────────────────────────────────────────────────────────────────────
# Read
# ─────────────────────────────────────────────────────────────────────────
async def get_term_by_id(s: AsyncSession, *, term_id: str) -> dict[str, Any] | None:
    row = (await s.execute(
        text(f"SELECT {TERM_COLS} FROM terms WHERE id = CAST(:id AS uuid)"),
        {"id": term_id},
    )).first()
    return _row_to_term(row) if row else None


async def get_term_by_text(
    s: AsyncSession, *, term: str, domain: str | None = None
) -> dict[str, Any] | None:
    """term + (optional) domain 으로 단건 조회. 다중 도메인이면 첫 row.

    `domain=None` 호출은 domain 무관 매칭 → 우선순위: approved > proposed >
    rejected > deprecated. 같은 status 안에선 정렬 보장 안 함.
    """
    if domain is not None:
        row = (await s.execute(
            text(f"""
                SELECT {TERM_COLS} FROM terms
                WHERE term = :term AND domain = :domain
                LIMIT 1
            """),
            {"term": term, "domain": domain},
        )).first()
    else:
        row = (await s.execute(
            text(f"""
                SELECT {TERM_COLS} FROM terms
                WHERE term = :term
                ORDER BY
                  CASE status
                    WHEN 'approved'   THEN 1
                    WHEN 'proposed'   THEN 2
                    WHEN 'rejected'   THEN 3
                    WHEN 'deprecated' THEN 4
                    ELSE 99
                  END
                LIMIT 1
            """),
            {"term": term},
        )).first()
    return _row_to_term(row) if row else None


async def list_terms(
    s: AsyncSession,
    *,
    q: str | None = None,
    domain: str | None = None,
    status: str | None = "approved",
    page: int = 1,
    size: int = 50,
) -> tuple[list[dict[str, Any]], int]:
    """검색/필터 목록. q 는 term / term_en / aliases ILIKE.

    status=None 호출은 모든 status 포함 (admin 용). 기본 'approved' 만.
    """
    where: list[str] = []
    params: dict[str, Any] = {}
    if status is not None:
        where.append("status = :status")
        params["status"] = status
    if domain is not None:
        where.append("domain = :domain")
        params["domain"] = domain
    if q and q.strip():
        where.append(
            "(term ILIKE :q OR lower(term_en) LIKE lower(:q) "
            "OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE a ILIKE :q))"
        )
        params["q"] = f"%{q.strip()}%"

    clause = f"WHERE {' AND '.join(where)}" if where else ""

    total = int((await s.execute(
        text(f"SELECT COUNT(*) FROM terms {clause}"), params
    )).scalar() or 0)

    offset = max(0, (page - 1) * size)
    params2 = {**params, "limit": size, "offset": offset}
    rows = (await s.execute(
        text(f"""
            SELECT {TERM_COLS} FROM terms
            {clause}
            ORDER BY term
            LIMIT :limit OFFSET :offset
        """),
        params2,
    )).all()
    return [_row_to_term(r) for r in rows], total


async def list_pending(
    s: AsyncSession, *, page: int = 1, size: int = 50
) -> tuple[list[dict[str, Any]], int]:
    """admin 승인 대기 목록 (status='proposed')."""
    return await list_terms(s, status="proposed", page=page, size=size)


# ─────────────────────────────────────────────────────────────────────────
# Update — admin lifecycle
# ─────────────────────────────────────────────────────────────────────────
async def approve_term(
    s: AsyncSession, *, term_id: str, admin_id: str
) -> dict[str, Any] | None:
    row = (await s.execute(
        text(f"""
            UPDATE terms SET
              status = 'approved',
              approved_by = CAST(:admin AS uuid),
              approved_at = NOW(),
              rejected_by = NULL,
              reject_reason = NULL
            WHERE id = CAST(:id AS uuid)
            RETURNING {TERM_COLS}
        """),
        {"id": term_id, "admin": admin_id},
    )).first()
    return _row_to_term(row) if row else None


async def reject_term(
    s: AsyncSession, *, term_id: str, admin_id: str, reason: str
) -> dict[str, Any] | None:
    row = (await s.execute(
        text(f"""
            UPDATE terms SET
              status = 'rejected',
              rejected_by = CAST(:admin AS uuid),
              reject_reason = :reason
            WHERE id = CAST(:id AS uuid)
            RETURNING {TERM_COLS}
        """),
        {"id": term_id, "admin": admin_id, "reason": reason},
    )).first()
    return _row_to_term(row) if row else None


async def patch_term(
    s: AsyncSession, *, term_id: str, patch: dict[str, Any]
) -> dict[str, Any] | None:
    """admin 직접 수정 — 어느 status 라도 가능."""
    return await _apply_patch(s, term_id=term_id, patch=patch)


async def patch_proposal(
    s: AsyncSession, *, term_id: str, user_id: str, patch: dict[str, Any]
) -> dict[str, Any] | None:
    """본인 + pending 한정 수정. 다른 조건이면 None 반환."""
    row = (await s.execute(
        text("""
            SELECT proposed_by, status FROM terms
            WHERE id = CAST(:id AS uuid)
        """),
        {"id": term_id},
    )).first()
    if not row:
        return None
    proposed_by = str(row[0]) if row[0] else None
    status = row[1]
    if proposed_by != user_id or status != "proposed":
        return None
    return await _apply_patch(s, term_id=term_id, patch=patch)


async def _apply_patch(
    s: AsyncSession, *, term_id: str, patch: dict[str, Any]
) -> dict[str, Any] | None:
    """공통 patch 빌더. 빈 patch 면 현재 row 그대로 반환."""
    fields: list[str] = []
    params: dict[str, Any] = {"id": term_id}
    for col in ("term", "definition", "domain", "subdomain", "term_en"):
        if col in patch:
            fields.append(f"{col} = :{col}")
            params[col] = patch[col]
    if "aliases" in patch:
        fields.append("aliases = :aliases")
        params["aliases"] = patch["aliases"] or []
    if not fields:
        return await get_term_by_id(s, term_id=term_id)
    row = (await s.execute(
        text(f"""
            UPDATE terms SET {', '.join(fields)}
            WHERE id = CAST(:id AS uuid)
            RETURNING {TERM_COLS}
        """),
        params,
    )).first()
    return _row_to_term(row) if row else None


async def delete_proposal(
    s: AsyncSession, *, term_id: str, user_id: str
) -> bool:
    """본인 + pending 한정 hard-delete. 성공 True."""
    row = (await s.execute(
        text("""
            SELECT proposed_by, status FROM terms
            WHERE id = CAST(:id AS uuid)
        """),
        {"id": term_id},
    )).first()
    if not row:
        return False
    proposed_by = str(row[0]) if row[0] else None
    status = row[1]
    if proposed_by != user_id or status != "proposed":
        return False
    await s.execute(
        text("DELETE FROM terms WHERE id = CAST(:id AS uuid)"),
        {"id": term_id},
    )
    return True


# ─────────────────────────────────────────────────────────────────────────
# Domain master
# ─────────────────────────────────────────────────────────────────────────
async def list_domains(s: AsyncSession) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text("""
            SELECT id, slug, name, parent_id, created_at
            FROM term_domains
            ORDER BY slug
        """),
    )).all()
    return [
        {
            "id": str(r[0]),
            "slug": r[1],
            "name": r[2],
            "parent_id": str(r[3]) if r[3] else None,
            "created_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]


async def create_domain(
    s: AsyncSession, *, slug: str, name: str, parent_id: str | None = None
) -> dict[str, Any]:
    row = (await s.execute(
        text("""
            INSERT INTO term_domains (slug, name, parent_id)
            VALUES (:slug, :name, CAST(:pid AS uuid))
            RETURNING id, slug, name, parent_id, created_at
        """),
        {"slug": slug, "name": name, "pid": parent_id},
    )).first()
    assert row is not None
    return {
        "id": str(row[0]),
        "slug": row[1],
        "name": row[2],
        "parent_id": str(row[3]) if row[3] else None,
        "created_at": row[4].isoformat() if row[4] else None,
    }


# ─────────────────────────────────────────────────────────────────────────
# History (term_proposals)
# ─────────────────────────────────────────────────────────────────────────
async def insert_proposal_history(
    s: AsyncSession,
    *,
    term_id: str,
    action: str,
    actor_id: str | None,
    payload: dict[str, Any] | None = None,
    reason: str | None = None,
) -> None:
    """term_proposals INSERT — 모든 mutation 이 호출 (lifecycle 보존)."""
    await s.execute(
        text("""
            INSERT INTO term_proposals
                (term_id, action, actor_id, payload, reason)
            VALUES
                (CAST(:tid AS uuid), :action,
                 CAST(:aid AS uuid),
                 CAST(:payload AS JSONB),
                 :reason)
        """),
        {
            "tid": term_id,
            "action": action,
            "aid": actor_id,
            "payload": json.dumps(payload or {}, ensure_ascii=False),
            "reason": reason,
        },
    )


async def list_history(
    s: AsyncSession, *, term_id: str
) -> list[dict[str, Any]]:
    """단건 term 의 변경 이력 (FR-12 곁다리)."""
    rows = (await s.execute(
        text("""
            SELECT id, term_id, action, actor_id, payload, reason, created_at
            FROM term_proposals
            WHERE term_id = CAST(:tid AS uuid)
            ORDER BY created_at DESC
        """),
        {"tid": term_id},
    )).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        payload = r[4]
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = None
        out.append({
            "id": str(r[0]),
            "term_id": str(r[1]) if r[1] else None,
            "action": r[2],
            "actor_id": str(r[3]) if r[3] else None,
            "payload": payload,
            "reason": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
        })
    return out


# ─────────────────────────────────────────────────────────────────────────
# Graph (FR-12)
# ─────────────────────────────────────────────────────────────────────────
async def find_related_for_term(
    s: AsyncSession, *, term_id: str
) -> dict[str, Any]:
    """{docs, cooccur_terms} — D3 그래프 응답의 raw 데이터.

    docs: terms.related_docs (UUID[]) 에서 documents 매칭.
    cooccur_terms: 동일 documents 를 공유하는 다른 approved terms.
    """
    # 1) docs
    doc_rows = (await s.execute(
        text("""
            SELECT d.id, d.slug, d.title
            FROM terms t
            JOIN documents d ON d.id = ANY(t.related_docs)
            WHERE t.id = CAST(:id AS uuid)
              AND d.status != 'archived'
            ORDER BY d.title
        """),
        {"id": term_id},
    )).all()
    docs = [{"id": str(r[0]), "slug": r[1], "title": r[2]} for r in doc_rows]

    # 2) co-occurring terms — 같은 doc 을 share 하는 다른 approved term
    cooccur_rows = (await s.execute(
        text("""
            SELECT DISTINCT u.id, u.term, u.domain
            FROM terms t, terms u
            WHERE t.id = CAST(:id AS uuid)
              AND u.id != t.id
              AND u.status = 'approved'
              AND u.related_docs && t.related_docs
            ORDER BY u.term
            LIMIT 50
        """),
        {"id": term_id},
    )).all()
    cooccur = [
        {"id": str(r[0]), "term": r[1], "domain": r[2]}
        for r in cooccur_rows
    ]

    return {"docs": docs, "cooccur_terms": cooccur}


# ─────────────────────────────────────────────────────────────────────────
# Bulk import (FR-13)
# ─────────────────────────────────────────────────────────────────────────
async def bulk_import_terms(
    s: AsyncSession,
    *,
    rows: list[dict[str, Any]],
    admin_id: str,
) -> dict[str, Any]:
    """CSV/JSON 일괄 INSERT. (term, domain) 중복은 skip.

    bulk import 는 admin 입력이므로 'approved' 로 직접 등록.
    """
    imported = 0
    skipped = 0
    errors: list[dict[str, Any]] = []
    for idx, row in enumerate(rows):
        term = (row.get("term") or "").strip()
        defn = (row.get("definition") or "").strip()
        if not term or not defn:
            errors.append({"row": idx, "reason": "term/definition 필수"})
            continue
        domain = row.get("domain")
        try:
            result = (await s.execute(
                text("""
                    INSERT INTO terms
                        (term, definition, domain, subdomain, term_en,
                         aliases, status, approved_by, approved_at)
                    VALUES
                        (:term, :def, :domain, :subdomain, :term_en,
                         :aliases, 'approved',
                         CAST(:admin AS uuid), NOW())
                    ON CONFLICT DO NOTHING
                    RETURNING id
                """),
                {
                    "term": term,
                    "def": defn,
                    "domain": domain,
                    "subdomain": row.get("subdomain"),
                    "term_en": row.get("term_en"),
                    "aliases": list(row.get("aliases") or []),
                    "admin": admin_id,
                },
            )).first()
            if result is None:
                skipped += 1
            else:
                imported += 1
        except Exception as exc:  # noqa: BLE001
            # FK 위반 (domain not in term_domains 등) 은 row 단위 에러로.
            await s.rollback()
            errors.append({"row": idx, "reason": str(exc)[:200]})
    return {"imported": imported, "skipped": skipped, "errors": errors}


# ─────────────────────────────────────────────────────────────────────────
# Helpers used by service for duplicate-check
# ─────────────────────────────────────────────────────────────────────────
async def find_term_for_dup(
    s: AsyncSession, *, term: str, domain: str | None
) -> dict[str, Any] | None:
    """propose 직전 중복 체크. domain=NULL 은 unique idx 가 강제 안 함 → 항상 None."""
    if domain is None:
        return None
    row = (await s.execute(
        text("SELECT id, status FROM terms WHERE term = :term AND domain = :domain"),
        {"term": term, "domain": domain},
    )).first()
    if not row:
        return None
    return {"id": str(row[0]), "status": row[1]}
