"""glossary-knowledge-graph — business logic.

Repo (raw SQL) 는 데이터 액세스만, service 는 lifecycle / audit / 중복 처리.

Plan: docs/01-plan/features/glossary-knowledge-graph.plan.md §6
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound, ValidationFailed
from app.repos import document_repo, glossary_repo


# ─────────────────────────────────────────────────────────────────────────
# Propose
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
    """새 용어 제안 — status='proposed' INSERT + history + audit.

    동일 (term, domain) 충돌:
      - 기존 proposed → 409 + 기존 id hint
      - 기존 approved → 409 + alias 추가 권장 hint
    """
    term = term.strip()
    definition = definition.strip()

    # 사전 중복 체크 — UNIQUE 인덱스 의존도 가능하나 친절한 message 위해 선조회.
    dup = await glossary_repo.find_term_for_dup(s, term=term, domain=domain)
    if dup:
        if dup["status"] == "proposed":
            raise Conflict(
                "이미 제안 중인 용어입니다.",
                details={"existing_id": dup["id"], "existing_status": "proposed"},
            )
        if dup["status"] == "approved":
            raise Conflict(
                "이미 등록된 용어입니다. alias 추가 제안을 고려해 주세요.",
                details={"existing_id": dup["id"], "existing_status": "approved"},
            )
        if dup["status"] == "rejected":
            raise Conflict(
                "거부된 용어가 있습니다. 기존 제안을 수정해 재제출해 주세요.",
                details={"existing_id": dup["id"], "existing_status": "rejected"},
            )
        # deprecated 는 통과 — 새 propose 허용 (plan §6.5)

    try:
        row = await glossary_repo.propose_term(
            s,
            term=term,
            definition=definition,
            domain=domain,
            subdomain=subdomain,
            term_en=term_en,
            aliases=list(aliases or []),
            user_id=user_id,
        )
    except IntegrityError as e:
        await s.rollback()
        raise Conflict("동일 (term, domain) 제약 위반") from e

    await glossary_repo.insert_proposal_history(
        s,
        term_id=row["id"],
        action="propose",
        actor_id=user_id,
        payload={
            "term": term,
            "definition": definition,
            "domain": domain,
            "subdomain": subdomain,
            "term_en": term_en,
            "aliases": list(aliases or []),
        },
    )
    await document_repo.insert_audit(
        s,
        user_id=user_id,
        action="glossary.propose",
        target=f"term:{row['id']}",
        payload={"term": term, "domain": domain},
    )
    await s.commit()
    return row


# ─────────────────────────────────────────────────────────────────────────
# Admin lifecycle
# ─────────────────────────────────────────────────────────────────────────
async def approve_term(
    s: AsyncSession, *, term_id: str, admin_id: str
) -> dict[str, Any]:
    row = await glossary_repo.approve_term(s, term_id=term_id, admin_id=admin_id)
    if not row:
        raise NotFound(f"term not found: {term_id}")
    await glossary_repo.insert_proposal_history(
        s, term_id=term_id, action="approve", actor_id=admin_id
    )
    await document_repo.insert_audit(
        s,
        user_id=admin_id,
        action="glossary.approve",
        target=f"term:{term_id}",
        payload={"term": row["term"], "domain": row["domain"]},
    )
    await s.commit()
    return row


async def reject_term(
    s: AsyncSession, *, term_id: str, admin_id: str, reason: str
) -> dict[str, Any]:
    if not reason or not reason.strip():
        raise ValidationFailed("reject reason is required")
    reason = reason.strip()
    row = await glossary_repo.reject_term(
        s, term_id=term_id, admin_id=admin_id, reason=reason
    )
    if not row:
        raise NotFound(f"term not found: {term_id}")
    await glossary_repo.insert_proposal_history(
        s, term_id=term_id, action="reject", actor_id=admin_id, reason=reason
    )
    await document_repo.insert_audit(
        s,
        user_id=admin_id,
        action="glossary.reject",
        target=f"term:{term_id}",
        payload={"term": row["term"], "reason": reason},
    )
    await s.commit()
    return row


async def patch_term_admin(
    s: AsyncSession, *, term_id: str, admin_id: str, patch: dict[str, Any]
) -> dict[str, Any]:
    """admin 직접 수정 — status 무관 + alias / definition 등 부분 변경."""
    # 빈 patch 는 ValidationFailed
    if not patch:
        raise ValidationFailed("patch body is empty")
    try:
        row = await glossary_repo.patch_term(s, term_id=term_id, patch=patch)
    except IntegrityError as e:
        await s.rollback()
        raise Conflict("동일 (term, domain) 제약 위반") from e
    if not row:
        raise NotFound(f"term not found: {term_id}")
    await glossary_repo.insert_proposal_history(
        s,
        term_id=term_id,
        action="edit",
        actor_id=admin_id,
        payload=patch,
    )
    await document_repo.insert_audit(
        s,
        user_id=admin_id,
        action="glossary.patch",
        target=f"term:{term_id}",
        payload=patch,
    )
    await s.commit()
    return row


# ─────────────────────────────────────────────────────────────────────────
# 본인 제안 수정/취소
# ─────────────────────────────────────────────────────────────────────────
async def patch_proposal_owner(
    s: AsyncSession, *, term_id: str, user_id: str, patch: dict[str, Any]
) -> dict[str, Any]:
    """제안자 본인 + status='proposed' 한정 부분 수정."""
    if not patch:
        raise ValidationFailed("patch body is empty")
    # 존재 + ownership + status 체크는 repo 함수가 종합 — None=거부.
    row_before = await glossary_repo.get_term_by_id(s, term_id=term_id)
    if not row_before:
        raise NotFound(f"term not found: {term_id}")
    try:
        row = await glossary_repo.patch_proposal(
            s, term_id=term_id, user_id=user_id, patch=patch
        )
    except IntegrityError as e:
        await s.rollback()
        raise Conflict("동일 (term, domain) 제약 위반") from e
    if row is None:
        # ownership 또는 status 위반.
        from app.core.errors import Forbidden
        raise Forbidden(
            "본인이 제안한 pending 상태 용어만 수정할 수 있습니다."
        )
    await glossary_repo.insert_proposal_history(
        s,
        term_id=term_id,
        action="edit",
        actor_id=user_id,
        payload=patch,
    )
    await document_repo.insert_audit(
        s,
        user_id=user_id,
        action="glossary.proposal.patch",
        target=f"term:{term_id}",
        payload=patch,
    )
    await s.commit()
    return row


async def delete_proposal_owner(
    s: AsyncSession, *, term_id: str, user_id: str
) -> None:
    """제안자 본인 + status='proposed' 한정 hard-delete."""
    row_before = await glossary_repo.get_term_by_id(s, term_id=term_id)
    if not row_before:
        raise NotFound(f"term not found: {term_id}")
    ok = await glossary_repo.delete_proposal(s, term_id=term_id, user_id=user_id)
    if not ok:
        from app.core.errors import Forbidden
        raise Forbidden(
            "본인이 제안한 pending 상태 용어만 취소할 수 있습니다."
        )
    # term row 가 사라졌으니 term_proposals 도 ON DELETE CASCADE 로 삭제됨 →
    # 별도 history 행 추가 의미 없음. audit 만 남김.
    await document_repo.insert_audit(
        s,
        user_id=user_id,
        action="glossary.proposal.delete",
        target=f"term:{term_id}",
        payload={"term": row_before["term"]},
    )
    await s.commit()


# ─────────────────────────────────────────────────────────────────────────
# Domains
# ─────────────────────────────────────────────────────────────────────────
async def create_domain(
    s: AsyncSession, *, slug: str, name: str, parent_id: str | None, admin_id: str
) -> dict[str, Any]:
    try:
        row = await glossary_repo.create_domain(
            s, slug=slug, name=name, parent_id=parent_id
        )
    except IntegrityError as e:
        await s.rollback()
        raise Conflict(f"domain slug already exists: {slug}") from e
    await document_repo.insert_audit(
        s,
        user_id=admin_id,
        action="glossary.domain.create",
        target=f"domain:{slug}",
        payload={"name": name, "parent_id": parent_id},
    )
    await s.commit()
    return row


# ─────────────────────────────────────────────────────────────────────────
# Graph (FR-12)
# ─────────────────────────────────────────────────────────────────────────
async def build_graph_for_term(
    s: AsyncSession, *, term_id: str
) -> dict[str, Any]:
    """D3-friendly nodes/edges. center=term, surrounding=docs + cooccur_terms."""
    center = await glossary_repo.get_term_by_id(s, term_id=term_id)
    if not center:
        raise NotFound(f"term not found: {term_id}")
    rel = await glossary_repo.find_related_for_term(s, term_id=term_id)

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for d in rel["docs"]:
        nodes.append({"id": d["id"], "label": d["title"], "type": "document",
                      "slug": d["slug"]})
        edges.append({"source": center["id"], "target": d["id"],
                      "rel": "referenced_in"})
    for t in rel["cooccur_terms"]:
        nodes.append({"id": t["id"], "label": t["term"], "type": "term",
                      "domain": t["domain"]})
        edges.append({"source": center["id"], "target": t["id"],
                      "rel": "cooccurs_with"})
    if center.get("page_doc_id"):
        # has_page edge (page_doc_id 가 nodes 에 이미 있을 수도 있음)
        if not any(n["id"] == center["page_doc_id"] for n in nodes):
            # docs 에 없으면 별도 fetch — 흔치 않음. nil-safe pattern.
            pass
        edges.append({"source": center["id"],
                      "target": center["page_doc_id"], "rel": "has_page"})

    return {
        "center": {"id": center["id"], "label": center["term"],
                   "type": "term", "domain": center["domain"]},
        "nodes": nodes,
        "edges": edges,
    }


# ─────────────────────────────────────────────────────────────────────────
# Bulk import (FR-13)
# ─────────────────────────────────────────────────────────────────────────
async def bulk_import(
    s: AsyncSession, *, rows: list[dict[str, Any]], admin_id: str
) -> dict[str, Any]:
    if not rows:
        raise ValidationFailed("rows is empty")
    result = await glossary_repo.bulk_import_terms(
        s, rows=rows, admin_id=admin_id
    )
    await document_repo.insert_audit(
        s,
        user_id=admin_id,
        action="glossary.import",
        target="terms:bulk",
        payload={"imported": result["imported"], "skipped": result["skipped"]},
    )
    await s.commit()
    return result
