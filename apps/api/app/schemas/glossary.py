"""glossary-knowledge-graph — pydantic v2 schemas for terms + domains.

Plan: docs/01-plan/features/glossary-knowledge-graph.plan.md §2.3, §4.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

_SLUG = r"^[a-z0-9][a-z0-9-]{0,99}$"

# Status enum (DB CHECK 와 동기 — alembic 0048)
TermStatus = str  # 'proposed'|'approved'|'rejected'|'deprecated'


# ── Term ────────────────────────────────────────────────────────────────
class TermBase(BaseModel):
    """공통 필드 — propose / patch 의 베이스."""
    model_config = ConfigDict(extra="forbid")
    term: str = Field(..., min_length=1, max_length=200)
    definition: str = Field(..., min_length=1, max_length=5000)
    domain: str | None = Field(default=None, max_length=100)
    subdomain: str | None = Field(default=None, max_length=100)
    term_en: str | None = Field(default=None, max_length=200)
    aliases: list[str] = Field(default_factory=list, max_length=20)


class TermProposeIn(TermBase):
    """POST /glossary/propose 본문."""
    pass


class TermPatchIn(BaseModel):
    """PATCH /glossary/{id} (admin) 또는 /glossary/proposals/{id} (본인) 본문.

    모든 필드 optional — 부분 갱신.
    """
    model_config = ConfigDict(extra="forbid")
    term: str | None = Field(default=None, min_length=1, max_length=200)
    definition: str | None = Field(default=None, min_length=1, max_length=5000)
    domain: str | None = Field(default=None, max_length=100)
    subdomain: str | None = Field(default=None, max_length=100)
    term_en: str | None = Field(default=None, max_length=200)
    aliases: list[str] | None = Field(default=None, max_length=20)


class TermOut(BaseModel):
    """응답용 — DB row 전부 노출."""
    id: str
    term: str
    definition: str
    domain: str | None = None
    subdomain: str | None = None
    term_en: str | None = None
    aliases: list[str] = Field(default_factory=list)
    status: str
    proposed_by: str | None = None
    proposed_at: str | None = None
    approved_by: str | None = None
    approved_at: str | None = None
    rejected_by: str | None = None
    reject_reason: str | None = None
    page_doc_id: str | None = None


class RejectIn(BaseModel):
    """POST /glossary/{id}/reject 본문 — reason 필수."""
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=1, max_length=1000)


# ── Domain ──────────────────────────────────────────────────────────────
class DomainIn(BaseModel):
    """POST /domains 본문."""
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(..., pattern=_SLUG)
    name: str = Field(..., min_length=1, max_length=200)
    parent_id: str | None = None


class DomainOut(BaseModel):
    id: str
    slug: str
    name: str
    parent_id: str | None = None
    created_at: str | None = None


# ── Bulk import (CSV/JSON) ──────────────────────────────────────────────
class BulkImportRow(BaseModel):
    """POST /glossary/import 의 한 row."""
    model_config = ConfigDict(extra="forbid")
    term: str = Field(..., min_length=1, max_length=200)
    definition: str = Field(..., min_length=1, max_length=5000)
    domain: str | None = Field(default=None, max_length=100)
    subdomain: str | None = Field(default=None, max_length=100)
    term_en: str | None = Field(default=None, max_length=200)
    aliases: list[str] = Field(default_factory=list, max_length=20)


class BulkImportIn(BaseModel):
    """JSON 본문 (CSV multipart 대신 JSON 도 받음)."""
    model_config = ConfigDict(extra="forbid")
    rows: list[BulkImportRow] = Field(..., min_length=1, max_length=10000)
