"""용어집 라우터 — glossary-knowledge-graph Sprint AB.

기존 2 endpoint (GET /glossary/term/{term}, GET /glossary) 는 새 컬럼 노출 +
status 필터 추가하며 호환 유지. 신규 11 endpoint (FR-01,04~13) 추가.

Plan: docs/01-plan/features/glossary-knowledge-graph.plan.md §2.1
"""
from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    require_admin,
    require_reader,
)
from app.core.db import get_db
from app.core.errors import NotFound, ValidationFailed, envelope
from app.repos import glossary_repo
from app.schemas.glossary import (
    BulkImportIn,
    DomainIn,
    RejectIn,
    TermPatchIn,
    TermProposeIn,
)
from app.services import glossary_service

router = APIRouter(prefix="/api/v1", tags=["glossary"])


# ─────────────────────────────────────────────────────────────────────────
# FR-02 — GET /glossary  (public; status=approved default)
# ─────────────────────────────────────────────────────────────────────────
@router.get("/glossary")
async def list_glossary(
    q: str | None = Query(default=None),
    domain: str | None = Query(default=None),
    status: str | None = Query(
        default="approved",
        description=(
            "필터할 상태. 미인증/비관리자는 'approved' 만 보임. "
            "admin 은 'proposed'/'rejected'/'deprecated'/'all' 가능."
        ),
    ),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """approved 만 public 노출. 그 외 status 는 admin 인증 시에만.

    'all' 은 admin 에게만 — status 필터 자체를 제거 (None 전달).
    """
    # public default = 'approved'. 비 'approved' 는 거부 (admin 은 별도 endpoints).
    if status not in (None, "approved"):
        raise ValidationFailed(
            "status 'approved' 외 값은 GET /glossary/pending 등 전용 "
            "엔드포인트를 사용하세요."
        )
    items, total = await glossary_repo.list_terms(
        s, q=q, domain=domain, status="approved", page=page, size=size
    )
    return envelope(
        data={"items": items, "total": total, "page": page, "size": size},
        meta={"q": q, "domain": domain, "status": status},
    )


# ─────────────────────────────────────────────────────────────────────────
# FR-03 — GET /glossary/term/{term}  (public)
# ─────────────────────────────────────────────────────────────────────────
@router.get("/glossary/term/{term}")
async def get_term(
    term: str,
    domain: str | None = Query(default=None),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """단건 조회. domain 지정 시 같은 분야 우선, 아니면 status 우선순위."""
    row = await glossary_repo.get_term_by_text(s, term=term, domain=domain)
    if not row:
        raise NotFound(f"term not found: {term}")
    # public 노출이므로 approved 가 아니면 숨김 (proposed/rejected/deprecated)
    if row["status"] != "approved":
        raise NotFound(f"term not found (status={row['status']}): {term}")
    # 호환성: 기존 응답이 갖던 related_doc_count 도 함께 노출.
    rd_count = int((await s.execute(
        text(
            "SELECT COALESCE(array_length(related_docs, 1), 0) "
            "FROM terms WHERE id = CAST(:id AS uuid)"
        ),
        {"id": row["id"]},
    )).scalar() or 0)
    out = {**row, "related_doc_count": rd_count}
    return envelope(data=out, meta={"source": "terms"})


# ─────────────────────────────────────────────────────────────────────────
# FR-01 — POST /glossary/propose  (reader+ = require_reader)
# ─────────────────────────────────────────────────────────────────────────
@router.post("/glossary/propose", status_code=202)
async def propose(
    payload: TermProposeIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    row = await glossary_service.propose_term(
        s,
        term=payload.term,
        definition=payload.definition,
        domain=payload.domain,
        subdomain=payload.subdomain,
        term_en=payload.term_en,
        aliases=payload.aliases,
        user_id=user["id"],
    )
    return envelope(data=row)


# ─────────────────────────────────────────────────────────────────────────
# FR-04 — GET /glossary/pending  (admin)
# ─────────────────────────────────────────────────────────────────────────
@router.get("/glossary/pending")
async def list_pending(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    items, total = await glossary_repo.list_pending(s, page=page, size=size)
    return envelope(
        data={"items": items, "total": total, "page": page, "size": size},
    )


# ─────────────────────────────────────────────────────────────────────────
# FR-05 — POST /glossary/{id}/approve  (admin)
# ─────────────────────────────────────────────────────────────────────────
@router.post("/glossary/{term_id}/approve")
async def approve(
    term_id: str,
    s: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    row = await glossary_service.approve_term(
        s, term_id=term_id, admin_id=admin["id"]
    )
    return envelope(data=row)


# ─────────────────────────────────────────────────────────────────────────
# FR-06 — POST /glossary/{id}/reject  (admin)
# ─────────────────────────────────────────────────────────────────────────
@router.post("/glossary/{term_id}/reject")
async def reject(
    term_id: str,
    body: RejectIn,
    s: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    row = await glossary_service.reject_term(
        s, term_id=term_id, admin_id=admin["id"], reason=body.reason
    )
    return envelope(data=row)


# ─────────────────────────────────────────────────────────────────────────
# FR-07 — PATCH /glossary/{id}  (admin direct edit)
# ─────────────────────────────────────────────────────────────────────────
@router.patch("/glossary/{term_id}")
async def patch_term(
    term_id: str,
    body: TermPatchIn,
    s: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    patch = body.model_dump(exclude_unset=True)
    row = await glossary_service.patch_term_admin(
        s, term_id=term_id, admin_id=admin["id"], patch=patch
    )
    return envelope(data=row)


# ─────────────────────────────────────────────────────────────────────────
# FR-08 — PATCH /glossary/proposals/{id}  (본인 + pending)
# ─────────────────────────────────────────────────────────────────────────
@router.patch("/glossary/proposals/{term_id}")
async def patch_proposal(
    term_id: str,
    body: TermPatchIn,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    patch = body.model_dump(exclude_unset=True)
    row = await glossary_service.patch_proposal_owner(
        s, term_id=term_id, user_id=user["id"], patch=patch
    )
    return envelope(data=row)


# ─────────────────────────────────────────────────────────────────────────
# FR-09 — DELETE /glossary/proposals/{id}  (본인 + pending)
# ─────────────────────────────────────────────────────────────────────────
@router.delete("/glossary/proposals/{term_id}")
async def delete_proposal(
    term_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    await glossary_service.delete_proposal_owner(
        s, term_id=term_id, user_id=user["id"]
    )
    return envelope(data={"id": term_id, "deleted": True})


# ─────────────────────────────────────────────────────────────────────────
# FR-10 — GET /domains  (public, flat list — parent_id 만 노출)
# ─────────────────────────────────────────────────────────────────────────
@router.get("/domains")
async def list_domains(s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    items = await glossary_repo.list_domains(s)
    return envelope(data={"items": items}, meta={"count": len(items)})


# ─────────────────────────────────────────────────────────────────────────
# FR-11 — POST /domains  (admin)
# ─────────────────────────────────────────────────────────────────────────
@router.post("/domains", status_code=201)
async def create_domain(
    body: DomainIn,
    s: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    row = await glossary_service.create_domain(
        s,
        slug=body.slug,
        name=body.name,
        parent_id=body.parent_id,
        admin_id=admin["id"],
    )
    return envelope(data=row)


# ─────────────────────────────────────────────────────────────────────────
# FR-12 — GET /graph/terms/{id}  (reader+)
# ─────────────────────────────────────────────────────────────────────────
@router.get("/graph/terms/{term_id}")
async def graph_for_term(
    term_id: str,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    data = await glossary_service.build_graph_for_term(s, term_id=term_id)
    return envelope(data=data)


# ─────────────────────────────────────────────────────────────────────────
# FR-13 — POST /glossary/import  (admin; multipart CSV or JSON body)
# ─────────────────────────────────────────────────────────────────────────
@router.post("/glossary/import")
async def bulk_import(
    request: Request,
    s: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """CSV multipart 또는 JSON {rows:[...]} 둘 다 허용.

    Content-Type 으로 분기:
      - `multipart/form-data` → field `file` 의 CSV 파일
      - `application/json` → `{rows:[...]}` (BulkImportIn 검증)

    CSV 컬럼: term,definition,domain,subdomain,term_en,aliases (aliases는 '|' 구분)
    """
    rows: list[dict[str, Any]] = []
    ctype = (request.headers.get("content-type") or "").lower()

    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        f = form.get("file")
        # starlette UploadFile 은 fastapi.UploadFile 과 동일 객체. 단,
        # 일부 client 가 단순 str 로 보낼 가능성을 흡수.
        if f is None or isinstance(f, str):
            raise ValidationFailed("multipart form 의 'file' 필드가 필요합니다.")
        raw = await f.read()  # type: ignore[union-attr]
        try:
            text_data = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            text_data = raw.decode("utf-8", errors="replace")
        reader = csv.DictReader(io.StringIO(text_data))
        for r in reader:
            row: dict[str, Any] = {
                "term": (r.get("term") or "").strip(),
                "definition": (r.get("definition") or "").strip(),
                "domain": (r.get("domain") or "").strip() or None,
                "subdomain": (r.get("subdomain") or "").strip() or None,
                "term_en": (r.get("term_en") or "").strip() or None,
            }
            aliases_raw = (r.get("aliases") or "").strip()
            row["aliases"] = (
                [a.strip() for a in aliases_raw.split("|") if a.strip()]
                if aliases_raw
                else []
            )
            rows.append(row)
    elif ctype.startswith("application/json"):
        raw_body = await request.body()
        if not raw_body:
            raise ValidationFailed("JSON 본문이 비어 있습니다.")
        import json as _json

        try:
            parsed = _json.loads(raw_body)
        except _json.JSONDecodeError as e:
            raise ValidationFailed(f"JSON 파싱 실패: {e}") from e
        try:
            body = BulkImportIn.model_validate(parsed)
        except Exception as e:  # pydantic ValidationError 등
            raise ValidationFailed(f"rows 검증 실패: {e}") from e
        rows = [r.model_dump() for r in body.rows]
    else:
        raise ValidationFailed(
            "Content-Type 은 multipart/form-data 또는 application/json 이어야 합니다."
        )

    result = await glossary_service.bulk_import(
        s, rows=rows, admin_id=admin["id"]
    )
    return envelope(data=result)


