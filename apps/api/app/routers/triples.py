"""Triple 라우터 — 그래프 의미 엣지 (subject, predicate, object).

graph-edge-predicates 사이클 1차 (DB+API). `doc_triples` 테이블의 CRUD 와
LLM 추출 트리거 (mock provider) 를 노출한다. wiki/tag 엣지는 기존
links/document_tags 가 담당하고, 이 라우터는 source='llm'|'manual' 만 다룬다.

GET    /api/v1/triples            필터 조회 (reader)
POST   /api/v1/triples            단건 생성 (editor)
DELETE /api/v1/triples/{id}       단건 삭제 (editor 작성자 / admin)
POST   /api/v1/triples/extract    문서 단건 LLM 추출 (editor)
POST   /api/v1/triples/extract/bulk  일괄 추출 (admin)
"""
from __future__ import annotations

from typing import Any

import ulid
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_editor, require_reader
from app.core.db import get_db
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed, envelope
from app.lib.super_domains import by_id
from app.services.triple_extractor import TripleExtractor

router = APIRouter(prefix="/api/v1/triples", tags=["triples"])

_PREDICATE_MAX = 200


def _row_to_dict(row: Any) -> dict[str, Any]:
    """doc_triples row → 응답 dict (Plan §2.3 형태)."""
    return {
        "id": row[0],
        "subject_slug": row[1],
        "predicate": row[2],
        "object_slug": row[3],
        "source": row[4],
        "confidence": row[5],
        "created_by": str(row[6]) if row[6] else None,
        "created_at": row[7].isoformat() if row[7] else None,
        "inverse_predicate": row[8],
    }


_SELECT_COLS = (
    "id, subject_slug, predicate, object_slug, source, confidence, "
    "created_by, created_at, inverse_predicate"
)


@router.get("")
async def list_triples(
    subject: str | None = Query(default=None),
    object: str | None = Query(default=None),
    predicate: str | None = Query(default=None),
    source: str | None = Query(default=None),
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_reader),
) -> dict[str, Any]:
    """필터 조회. 인자 미지정 시 전체 반환."""
    where: list[str] = []
    params: dict[str, Any] = {}
    if subject:
        where.append("subject_slug = :subject")
        params["subject"] = subject
    if object:
        where.append("object_slug = :object")
        params["object"] = object
    if predicate:
        where.append("predicate = :predicate")
        params["predicate"] = predicate
    if source:
        if source not in ("llm", "manual"):
            raise ValidationFailed("source must be 'llm' or 'manual'")
        where.append("source = :source")
        params["source"] = source

    clause = f"WHERE {' AND '.join(where)}" if where else ""
    rows = (await s.execute(
        text(f"SELECT {_SELECT_COLS} FROM doc_triples {clause} "
             "ORDER BY created_at DESC"),
        params,
    )).all()
    items = [_row_to_dict(r) for r in rows]
    return envelope(data=items, meta={"total": len(items)})


class TripleCreate(BaseModel):
    subject_slug: str = Field(min_length=1, max_length=100)
    predicate: str = Field(min_length=1, max_length=_PREDICATE_MAX)
    object_slug: str = Field(min_length=1, max_length=100)
    source: str = Field(default="manual")
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    # 역방향 자연어 설명 (object 쪽에서 읽는 관계). 미지정 시 표시 측이 fallback.
    inverse_predicate: str | None = Field(default=None, max_length=_PREDICATE_MAX)


@router.post("")
async def create_triple(
    body: TripleCreate,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    """단건 생성 (manual / system-internal). source 기본 'manual'."""
    if body.source not in ("llm", "manual"):
        raise ValidationFailed("source must be 'llm' or 'manual'")

    tid = str(ulid.new())
    # manual 은 created_by 보관, llm 은 NULL.
    created_by = user["id"] if body.source == "manual" else None
    try:
        row = (await s.execute(
            text(f"""
                INSERT INTO doc_triples
                    (id, subject_slug, predicate, object_slug, source,
                     confidence, created_by, inverse_predicate)
                VALUES
                    (:id, :subject, :predicate, :object, :source,
                     :confidence, :created_by, :inverse)
                RETURNING {_SELECT_COLS}
            """),
            {
                "id": tid,
                "subject": body.subject_slug,
                "predicate": body.predicate,
                "object": body.object_slug,
                "source": body.source,
                "confidence": body.confidence,
                "created_by": created_by,
                "inverse": body.inverse_predicate,
            },
        )).first()
        await s.commit()
    except Exception as e:  # UNIQUE(subject, predicate, object, source) 위반
        await s.rollback()
        if "doc_triples" in str(e) and "unique" in str(e).lower():
            raise Conflict("Triple already exists") from e
        raise

    return envelope(data=_row_to_dict(row))


@router.delete("/{triple_id}")
async def delete_triple(
    triple_id: str,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    """단건 삭제. created_by 가 본인이거나 admin 이면 허용.

    created_by 가 NULL (=llm) 인 triple 은 admin 만 삭제 가능.
    """
    row = (await s.execute(
        text("SELECT created_by FROM doc_triples WHERE id = :id"),
        {"id": triple_id},
    )).first()
    if not row:
        raise NotFound("Triple not found")

    created_by = str(row[0]) if row[0] else None
    is_admin = user.get("role") == "admin"
    if not is_admin and created_by != user["id"]:
        raise Forbidden("Only the creator or an admin can delete this triple")

    await s.execute(
        text("DELETE FROM doc_triples WHERE id = :id"), {"id": triple_id}
    )
    await s.commit()
    return envelope(data={"id": triple_id, "deleted": True})


async def _replace_llm_triples(
    s: AsyncSession, subject_slug: str, extracted: list[Any]
) -> tuple[int, int]:
    """문서의 기존 source='llm' triple 을 모두 삭제 후 재삽입 (idempotent).

    Returns (stored, replaced) — replaced 는 삭제된 기존 LLM triple 수.
    """
    deleted = (await s.execute(
        text("DELETE FROM doc_triples "
             "WHERE subject_slug = :subj AND source = 'llm'"),
        {"subj": subject_slug},
    )).rowcount or 0

    stored = 0
    for t in extracted:
        try:
            await s.execute(
                text("""
                    INSERT INTO doc_triples
                        (id, subject_slug, predicate, object_slug, source,
                         confidence, created_by, inverse_predicate)
                    VALUES
                        (:id, :subj, :predicate, :object, 'llm',
                         :confidence, NULL, :inverse)
                """),
                {
                    "id": str(ulid.new()),
                    "subj": subject_slug,
                    "predicate": t.predicate,
                    "object": t.object_slug,
                    "confidence": t.confidence,
                    "inverse": getattr(t, "inverse_predicate", None),
                },
            )
            stored += 1
        except Exception:
            # 같은 추출 batch 안의 (predicate, object) 중복 — 조용히 skip.
            await s.rollback()
            continue
    await s.commit()
    return stored, deleted


class ExtractRequest(BaseModel):
    subject_slug: str = Field(min_length=1, max_length=100)


@router.post("/extract")
async def extract_triple(
    body: ExtractRequest,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_editor),
) -> dict[str, Any]:
    """문서 단건 LLM 추출. 기존 source='llm' triple 을 교체 (manual 보존)."""
    extractor = TripleExtractor(s)
    extracted = await extractor.extract_for_doc(body.subject_slug)
    stored, replaced = await _replace_llm_triples(s, body.subject_slug, extracted)
    return envelope(data={
        "subject_slug": body.subject_slug,
        "extracted": [
            {"predicate": t.predicate, "object_slug": t.object_slug,
             "confidence": t.confidence,
             "inverse_predicate": t.inverse_predicate}
            for t in extracted
        ],
        "stored": stored,
        "replaced": replaced,
        "source": "llm",
    })


class BulkExtractRequest(BaseModel):
    slugs: list[str] | None = Field(default=None)
    domain: str | None = Field(default=None)


@router.post("/extract/bulk")
async def extract_bulk(
    body: BulkExtractRequest,
    s: AsyncSession = Depends(get_db),
    _user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """일괄 추출. slugs 명시 시 그 목록, domain 시 도메인 published 문서,
    둘 다 없으면 published 문서 전체를 대상으로 직렬 추출한다."""
    target_slugs = await _resolve_bulk_slugs(s, body)

    extractor = TripleExtractor(s)
    results: list[dict[str, Any]] = []
    total_stored = 0
    total_replaced = 0
    for slug in target_slugs:
        extracted = await extractor.extract_for_doc(slug)
        stored, replaced = await _replace_llm_triples(s, slug, extracted)
        total_stored += stored
        total_replaced += replaced
        results.append({
            "subject_slug": slug,
            "stored": stored,
            "replaced": replaced,
        })

    return envelope(data={
        "documents": len(target_slugs),
        "stored": total_stored,
        "replaced": total_replaced,
        "results": results,
        "source": "llm",
    })


async def _resolve_bulk_slugs(
    s: AsyncSession, body: BulkExtractRequest
) -> list[str]:
    """bulk 추출 대상 slug 목록 결정."""
    if body.slugs:
        return body.slugs

    if body.domain:
        domain = by_id(body.domain)
        if not domain:
            raise ValidationFailed(f"Unknown domain: {body.domain}")
        rows = (await s.execute(
            text("""
                SELECT DISTINCT d.slug
                FROM documents d
                JOIN document_tags dt ON dt.document_id = d.id
                JOIN tags tg ON tg.id = dt.tag_id
                WHERE tg.name = ANY(:tags)
                  AND d.status = 'published'
            """),
            {"tags": list(domain.tags)},
        )).all()
        return [r[0] for r in rows]

    rows = (await s.execute(
        text("SELECT slug FROM documents WHERE status = 'published'"),
    )).all()
    return [r[0] for r in rows]
