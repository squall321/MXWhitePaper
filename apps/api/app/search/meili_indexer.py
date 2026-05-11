"""Meilisearch 인덱서 (Sprint 6).

핵심 헬퍼:
  - ensure_index()        — `documents` 인덱스 settings 적용 (idempotent)
  - upsert_document(doc)  — documents_flat_v 의 한 행을 인덱스로 push
  - delete_document(id)   — 인덱스에서 제거
  - reindex_all()         — documents_flat_v 전체 dump → push
  - search(...)           — search 라우터에서 호출

실패는 모두 try/except 로 감싼다. 인덱서 실패가 본문 저장을 막아선 안 된다.
"""
from __future__ import annotations

import logging
import re
from typing import Any

import meilisearch
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

logger = logging.getLogger(__name__)


# ── CamelCase / snake_case tokenizer ────────────────────────────────
# Meilisearch tokenises on whitespace + a few CJK boundaries but does
# NOT split CamelCase or snake_case. That means "KooRemapper_Manual"
# stays as two tokens — "KooRemapper" and "Manual" — and a search for
# "remapper" returns nothing because Meili only does PREFIX matching by
# default. We work around this at index time: a derived `title_tokens`
# field holds the human-word form ("Koo Remapper Manual") and gets the
# same searchable weight as `title`. Original title stays intact so
# exact-match queries still work.
_RE_CAMEL_BOUNDARY_AB = re.compile(r"([A-Z]+)([A-Z][a-z])")  # XMLHttp → XML Http
_RE_CAMEL_BOUNDARY_AC = re.compile(r"([a-z\d])([A-Z])")       # KooR → Koo R
_RE_SEP_TO_SPACE = re.compile(r"[_\-]+")


def _tokenize_words(s: str | None) -> str:
    """Split CamelCase / snake_case / kebab-case into space-separated
    words for search-friendly tokenisation. Korean text passes through
    unchanged (Meili already tokenises CJK on character boundaries)."""
    if not s:
        return ""
    out = _RE_CAMEL_BOUNDARY_AB.sub(r"\1 \2", s)
    out = _RE_CAMEL_BOUNDARY_AC.sub(r"\1 \2", out)
    out = _RE_SEP_TO_SPACE.sub(" ", out)
    return out.strip()


# Strip anything that LOOKS like an HTML/XML tag (`<mark>`, `</em>`,
# `<br/>`, `<div class="…">`) from indexed body / summary text. Word
# imports and code samples often leave literal tag strings in the body
# that subsequently show up inside MeiliSearch's `_formatted` snippets
# — readable as "<Mark>this is highlight</Mark>" which looks ugly even
# after our sanitiser since it preserves the literal angle brackets.
# We keep the inner text and just drop the tag wrappers.
_RE_TAG_LIKE = re.compile(r"<\s*/?\s*[A-Za-z][A-Za-z0-9-]*(?:\s+[^>]*)?\s*/?\s*>")


def _strip_tag_literals(s: str | None) -> str:
    if not s:
        return ""
    return _RE_TAG_LIKE.sub(" ", s)

INDEX_UID = "documents"
PRIMARY_KEY = "id"

SEARCHABLE_ATTRS = [
    "title",
    "title_tokens",  # CamelCase/snake_case split form (see _tokenize_words)
    "summary",
    "section_titles",
    "section_titles_tokens",
    "body_text",
    "image_text",
    "tags",
]
FILTERABLE_ATTRS = [
    "part_slug",
    "team_slug",
    "group_slug",
    "division_slug",
    "tags",
    "status",
    "confidentiality",
]
SORTABLE_ATTRS = ["updated_at", "title"]

# 한국어 stop-words 작은 셋. Meilisearch 의 stop_words 는 토큰 매칭이라
# 너무 많이 넣으면 '결산' 처럼 의미있는 형태소까지 자른다.
KO_STOP_WORDS = [
    "은", "는", "이", "가", "을", "를", "의", "에", "와", "과",
    "도", "에서", "으로", "로", "만", "및", "그리고",
    "the", "a", "an", "of", "and", "or",
]


def get_client() -> meilisearch.Client:
    s = get_settings()
    return meilisearch.Client(s.meili_host, s.meili_master_key)


def ensure_index() -> dict[str, Any]:
    """`documents` 인덱스 + settings 보장. 이미 있으면 settings 만 갱신."""
    cli = get_client()
    try:
        cli.create_index(INDEX_UID, {"primaryKey": PRIMARY_KEY})
    except meilisearch.errors.MeilisearchApiError:
        # 이미 존재 — 무시.
        pass

    idx = cli.index(INDEX_UID)
    idx.update_settings({
        "searchableAttributes": SEARCHABLE_ATTRS,
        "filterableAttributes": FILTERABLE_ATTRS,
        "sortableAttributes": SORTABLE_ATTRS,
        "stopWords": KO_STOP_WORDS,
        "displayedAttributes": [
            "id", "slug", "title", "summary", "tags",
            "part_slug", "team_slug", "group_slug", "division_slug",
            "status", "confidentiality", "updated_at",
        ],
    })
    return {"uid": INDEX_UID, "primary_key": PRIMARY_KEY}


# ── DB → Meilisearch 도큐먼트 변환 ────────────────────────────────────
async def _fetch_flat_row(s: AsyncSession, doc_id: str) -> dict[str, Any] | None:
    """documents_flat_v + documents 메타에서 인덱싱용 row 1건 fetch.

    documents_flat_v 는 published 만 포함하므로 archived/draft 는 None.
    그러나 인덱스에는 status=draft 도 노출하지 않는 정책 (검색=published 만).
    """
    row = (await s.execute(
        text("""
            SELECT
              v.id::text,
              d.slug,
              v.title,
              v.summary,
              v.section_titles,
              v.body_text,
              v.tags,
              v.updated_at,
              p.slug AS part_slug,
              g.slug AS group_slug,
              t.slug AS team_slug,
              dv.slug AS division_slug,
              d.status,
              COALESCE(d.content_json->'metadata'->>'confidentiality', 'internal') AS confidentiality
            FROM documents_flat_v v
            JOIN documents d ON d.id = v.id
            LEFT JOIN parts p ON p.id = d.part_id
            LEFT JOIN groups g ON g.id = p.group_id
            LEFT JOIN teams t ON t.id = g.team_id
            LEFT JOIN divisions dv ON dv.id = t.division_id
            WHERE v.id = CAST(:id AS uuid)
        """),
        {"id": doc_id},
    )).first()
    if not row:
        return None
    return {
        "id": row[0],
        "slug": row[1],
        "title": row[2],
        "summary": _strip_tag_literals(row[3] or ""),
        "title_tokens": _tokenize_words(row[2]),
        "section_titles": _strip_tag_literals(row[4] or ""),
        "section_titles_tokens": _tokenize_words(_strip_tag_literals(row[4])),
        "body_text": _strip_tag_literals(row[5] or ""),
        "image_text": "",  # body_text 안에 caption/alt 가 이미 합쳐져 있음
        "tags": list(row[6]) if row[6] else [],
        "updated_at": row[7].isoformat() if row[7] else None,
        "part_slug": row[8],
        "group_slug": row[9],
        "team_slug": row[10],
        "division_slug": row[11],
        "status": row[12],
        "confidentiality": row[13],
    }


async def _fetch_all_flat_rows(s: AsyncSession) -> list[dict[str, Any]]:
    rows = (await s.execute(
        text("""
            SELECT
              v.id::text,
              d.slug,
              v.title,
              v.summary,
              v.section_titles,
              v.body_text,
              v.tags,
              v.updated_at,
              p.slug AS part_slug,
              g.slug AS group_slug,
              t.slug AS team_slug,
              dv.slug AS division_slug,
              d.status,
              COALESCE(d.content_json->'metadata'->>'confidentiality', 'internal') AS confidentiality
            FROM documents_flat_v v
            JOIN documents d ON d.id = v.id
            LEFT JOIN parts p ON p.id = d.part_id
            LEFT JOIN groups g ON g.id = p.group_id
            LEFT JOIN teams t ON t.id = g.team_id
            LEFT JOIN divisions dv ON dv.id = t.division_id
        """)
    )).all()
    return [
        {
            "id": r[0],
            "slug": r[1],
            "title": r[2],
            "summary": _strip_tag_literals(r[3] or ""),
            "title_tokens": _tokenize_words(r[2]),
            "section_titles": _strip_tag_literals(r[4] or ""),
            "section_titles_tokens": _tokenize_words(_strip_tag_literals(r[4])),
            "body_text": _strip_tag_literals(r[5] or ""),
            "image_text": "",
            "tags": list(r[6]) if r[6] else [],
            "updated_at": r[7].isoformat() if r[7] else None,
            "part_slug": r[8],
            "group_slug": r[9],
            "team_slug": r[10],
            "division_slug": r[11],
            "status": r[12],
            "confidentiality": r[13],
        }
        for r in rows
    ]


async def upsert_document(s: AsyncSession, doc_id: str) -> bool:
    """Best-effort: Meilisearch 에 1건 push. 실패하면 warn 만.

    Returns True on success, False otherwise.
    """
    try:
        flat = await _fetch_flat_row(s, doc_id)
        if not flat:
            # published 가 아니거나 view 가 아직 갱신 안됐을 수 있음 → 삭제 시도
            return delete_document(doc_id)
        cli = get_client()
        cli.index(INDEX_UID).add_documents([flat], primary_key=PRIMARY_KEY)
        return True
    except Exception as e:
        logger.warning("Meilisearch upsert failed for %s: %s", doc_id, e)
        return False


def delete_document(doc_id: str) -> bool:
    try:
        cli = get_client()
        cli.index(INDEX_UID).delete_document(doc_id)
        return True
    except Exception as e:
        logger.warning("Meilisearch delete failed for %s: %s", doc_id, e)
        return False


async def reindex_all(s: AsyncSession, *, wait: bool = True) -> dict[str, Any]:
    """뷰 전체를 dump 한 뒤 인덱스에 추가. CLI 에서 호출.

    wait=True 면 Meilisearch 인덱싱 task 가 완료될 때까지 블락 (테스트용).
    """
    ensure_index()
    rows = await _fetch_all_flat_rows(s)
    cli = get_client()
    if rows:
        task = cli.index(INDEX_UID).add_documents(rows, primary_key=PRIMARY_KEY)
        if wait:
            try:
                # task.task_uid 또는 task["taskUid"] 둘 다 처리
                tid = getattr(task, "task_uid", None) or (
                    task.get("taskUid") if isinstance(task, dict) else None
                )
                if tid is not None:
                    cli.wait_for_task(tid, timeout_in_ms=10000)
            except Exception as e:
                logger.warning("wait_for_task failed: %s", e)
    stats = cli.index(INDEX_UID).get_stats()
    n = getattr(stats, "number_of_documents", None)
    if n is None and isinstance(stats, dict):
        n = stats.get("numberOfDocuments")
    return {"indexed": len(rows), "stats_count": n}


# ── search ────────────────────────────────────────────────────────────
def search(
    *,
    q: str,
    limit: int = 20,
    offset: int = 0,
    filters: dict[str, str] | None = None,
    raw_filter_exprs: list[str] | None = None,
) -> dict[str, Any]:
    """Run a Meilisearch query with `<mark>` highlighting + body cropping.

    Args:
        q: query string.
        limit / offset: pagination.
        filters: simple `{field: value}` map → emits `field = "value"` AND clauses.
        raw_filter_exprs: extra filter expressions appended via AND
            (used for range filters such as `updated_at >= "2025-01-01"`).
    """
    cli = get_client()
    idx = cli.index(INDEX_UID)
    filter_exprs: list[str] = []
    if filters:
        for k, v in filters.items():
            if v is None or v == "":
                continue
            # 값에 따옴표 escape
            safe = str(v).replace('"', '\\"')
            filter_exprs.append(f'{k} = "{safe}"')
    if raw_filter_exprs:
        filter_exprs.extend([e for e in raw_filter_exprs if e])
    payload: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "attributesToHighlight": ["title", "summary", "body_text"],
        "attributesToCrop": ["body_text"],
        "cropLength": 200,
        "highlightPreTag": "<mark>",
        "highlightPostTag": "</mark>",
    }
    if filter_exprs:
        payload["filter"] = " AND ".join(filter_exprs)
    return idx.search(q, payload)
