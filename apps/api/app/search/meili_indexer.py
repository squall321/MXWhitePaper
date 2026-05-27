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
import time
from typing import Any, Callable, TypeVar

import meilisearch
import meilisearch.errors as _meili_errors
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings

logger = logging.getLogger(__name__)

T = TypeVar("T")

# ── transient-error retry (M2) ────────────────────────────────────────
# `upsert_document` / `delete_document` are best-effort but were giving up
# after a single 5xx / timeout — the H9 background hook wrapper
# (`document_service._run_with_retry`) then retried the whole flow once.
# That outer retry waits 1 s and re-issues the *full* request including the
# DB fetch, which is wasteful when only the Meilisearch HTTP call blipped.
# Add a fine-grained retry around the Meilisearch call itself for the
# subset of errors that are worth retrying (network down, request timeout,
# 5xx). Auth/4xx are user errors and not retried.
_RETRY_BACKOFFS_SECONDS: tuple[float, ...] = (0.5, 1.0)


def _is_transient_meili_error(exc: BaseException) -> bool:
    """True if ``exc`` is a Meilisearch error worth retrying.

    Retried:
      - MeilisearchCommunicationError (connection refused / DNS / reset)
      - MeilisearchTimeoutError       (request timeout)
      - MeilisearchApiError with HTTP 5xx
    Not retried:
      - MeilisearchApiError 4xx       (bad payload / auth — retry won't help)
      - everything else               (unknown — surface to caller's except)
    """
    if isinstance(exc, _meili_errors.MeilisearchCommunicationError):
        return True
    if isinstance(exc, _meili_errors.MeilisearchTimeoutError):
        return True
    if isinstance(exc, _meili_errors.MeilisearchApiError):
        status = getattr(exc, "status_code", None)
        return isinstance(status, int) and 500 <= status < 600
    return False


def _call_meili_with_retry(label: str, fn: Callable[[], T]) -> T:
    """Run ``fn`` with up to ``len(_RETRY_BACKOFFS_SECONDS)`` retries on
    transient errors. Returns ``fn()``'s value on success; re-raises the
    last exception on final failure. Logs each retry with attempt counter.
    """
    last_exc: BaseException | None = None
    for attempt in range(len(_RETRY_BACKOFFS_SECONDS) + 1):
        try:
            return fn()
        except Exception as exc:  # noqa: BLE001
            if not _is_transient_meili_error(exc):
                raise
            last_exc = exc
            if attempt >= len(_RETRY_BACKOFFS_SECONDS):
                break
            delay = _RETRY_BACKOFFS_SECONDS[attempt]
            logger.warning(
                "meili %s transient error (attempt %d/%d): %s — retrying in %.1fs",
                label, attempt + 1, len(_RETRY_BACKOFFS_SECONDS) + 1, exc, delay,
            )
            time.sleep(delay)
    assert last_exc is not None
    logger.warning(
        "meili %s failed after %d attempts: %s",
        label, len(_RETRY_BACKOFFS_SECONDS) + 1, last_exc,
    )
    raise last_exc


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
    "author",  # H6 — owner email is also searchable so q="alice@…" works
]
FILTERABLE_ATTRS = [
    "part_slug",
    "team_slug",
    "group_slug",
    "division_slug",
    "tags",
    "status",
    "confidentiality",
    # H5 — role-based hit filtering. `min_role_required` is the highest
    # `meta.permission` seen across the document's blocks ("all" / "editor"
    # / "admin"). The search router AND-s in a per-user level filter so a
    # reader never receives a hit (or snippet) for a doc that has editor-only
    # content. Conservative: a single restricted block hides the whole doc.
    "min_role_required",
    # H6 — author filter. Owner email (lower-cased) for the documents-side
    # `?author=` chip. Future: extend to created_by once that column lands.
    "author",
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
    except meilisearch.errors.MeilisearchApiError:  # type: ignore[attr-defined]  # meilisearch stub omits the errors submodule
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


# ── H5: role-based hit filtering ──────────────────────────────────────
# Mirror of `_PERM_LEVEL` in app.services.document_service. Kept local to
# avoid pulling the document_service into the indexer (one-way import).
_PERM_LEVEL_INDEX: dict[str, int] = {"all": 1, "editor": 2, "admin": 4}
_LEVEL_TO_PERM: dict[int, str] = {1: "all", 2: "editor", 4: "admin"}


def _walk_all_blocks(content_json: Any) -> Any:
    """Yield every block dict in a DocumentJSON tree, including those nested
    inside columns/tabs/accordion. Generator — yields dicts only."""
    if not isinstance(content_json, dict):
        return
    sections = content_json.get("sections")
    if not isinstance(sections, list):
        return

    def _walk_sec(sec: Any) -> Any:
        if not isinstance(sec, dict):
            return
        for blk in sec.get("blocks") or []:
            yield from _walk_block(blk)
        for sub in sec.get("subsections") or []:
            yield from _walk_sec(sub)

    def _walk_block(blk: Any) -> Any:
        if not isinstance(blk, dict):
            return
        yield blk
        btype = blk.get("type")
        if btype == "columns":
            for col in blk.get("columns") or []:
                if isinstance(col, list):
                    for child in col:
                        yield from _walk_block(child)
        elif btype == "tabs":
            for tab in blk.get("tabs") or []:
                if isinstance(tab, dict):
                    for child in tab.get("blocks") or []:
                        yield from _walk_block(child)
        elif btype == "accordion":
            for item in blk.get("items") or []:
                if isinstance(item, dict):
                    for child in item.get("blocks") or []:
                        yield from _walk_block(child)

    for sec in sections:
        yield from _walk_sec(sec)


def _max_permission_required(content_json: Any) -> str:
    """Return the highest `meta.permission` seen across all blocks.

    Output is one of: ``"all"`` (default, no restriction), ``"editor"``, or
    ``"admin"``. Unknown values are treated as ``"all"`` (most-permissive)
    so a typo in `meta.permission` doesn't accidentally hide a doc. The
    *opposite* default would silently lock content; conservative wins are
    handled at the *search filter* layer (we only return docs whose
    requirement is <= caller's role-level).
    """
    max_level = 1  # "all"
    for blk in _walk_all_blocks(content_json):
        meta = blk.get("meta")
        if not isinstance(meta, dict):
            continue
        perm = meta.get("permission")
        if not isinstance(perm, str):
            continue
        lvl = _PERM_LEVEL_INDEX.get(perm, 1)
        if lvl > max_level:
            max_level = lvl
    return _LEVEL_TO_PERM.get(max_level, "all")


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
              COALESCE(d.content_json->'metadata'->>'confidentiality', 'internal') AS confidentiality,
              d.content_json,
              LOWER(COALESCE(u.email, '')) AS author_email
            FROM documents_flat_v v
            JOIN documents d ON d.id = v.id
            LEFT JOIN parts p ON p.id = d.part_id
            LEFT JOIN groups g ON g.id = p.group_id
            LEFT JOIN teams t ON t.id = g.team_id
            LEFT JOIN divisions dv ON dv.id = t.division_id
            LEFT JOIN users u ON u.id = d.owner_id
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
        # H5 — max(meta.permission) across all blocks (incl. nested in
        # columns/tabs/accordion). Default "all" = no restriction.
        "min_role_required": _max_permission_required(row[14]),
        # H6 — owner email (lowercased). Empty string if no owner — Meili
        # accepts it as a value but filters require exact match.
        "author": row[15] or "",
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
              COALESCE(d.content_json->'metadata'->>'confidentiality', 'internal') AS confidentiality,
              d.content_json,
              LOWER(COALESCE(u.email, '')) AS author_email
            FROM documents_flat_v v
            JOIN documents d ON d.id = v.id
            LEFT JOIN parts p ON p.id = d.part_id
            LEFT JOIN groups g ON g.id = p.group_id
            LEFT JOIN teams t ON t.id = g.team_id
            LEFT JOIN divisions dv ON dv.id = t.division_id
            LEFT JOIN users u ON u.id = d.owner_id
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
            "min_role_required": _max_permission_required(r[14]),
            "author": r[15] or "",
        }
        for r in rows
    ]


async def upsert_document(s: AsyncSession, doc_id: str) -> bool:
    """Best-effort: Meilisearch 에 1건 push. 실패하면 warn 만.

    Returns True on success, False otherwise. Transient Meilisearch errors
    (timeout / connection refused / HTTP 5xx) are retried with backoff —
    see ``_call_meili_with_retry``.
    """
    try:
        flat = await _fetch_flat_row(s, doc_id)
        if not flat:
            # published 가 아니거나 view 가 아직 갱신 안됐을 수 있음 → 삭제 시도
            return delete_document(doc_id)
        cli = get_client()

        def _push() -> None:
            cli.index(INDEX_UID).add_documents([flat], primary_key=PRIMARY_KEY)

        _call_meili_with_retry(f"upsert {doc_id}", _push)
        return True
    except Exception as e:
        logger.warning("Meilisearch upsert failed for %s: %s", doc_id, e)
        return False


def delete_document(doc_id: str) -> bool:
    try:
        cli = get_client()

        def _delete() -> None:
            cli.index(INDEX_UID).delete_document(doc_id)

        _call_meili_with_retry(f"delete {doc_id}", _delete)
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


# ── H5: role → filter helper ──────────────────────────────────────────
# Caller (`routers/search.py`) uses this to AND in a clause that hides
# every hit whose `min_role_required` exceeds the viewer's level. Mirrors
# the role/perm matrix in `app.services.document_service`.
_ROLE_TO_PERM_LEVEL: dict[str, int] = {
    "reader": 1,
    "editor": 2,
    "owner": 2,  # treated like editor for content visibility
    "admin": 4,
}


def role_filter_exprs(role: str | None) -> list[str]:
    """Return the Meilisearch filter expressions required to hide hits whose
    `min_role_required` is above the caller's level.

    - reader → ``[min_role_required = "all"]``
    - editor / owner → ``[min_role_required IN ["all", "editor"]]``
    - admin → ``[]`` (no restriction)
    - unknown / None → reader-equivalent (most-restrictive). This protects
      anonymous flows like ``/share/:token`` against a missing role string.
    """
    lvl = _ROLE_TO_PERM_LEVEL.get((role or "").lower(), 1)
    if lvl >= _PERM_LEVEL_INDEX["admin"]:
        return []
    if lvl >= _PERM_LEVEL_INDEX["editor"]:
        return ['min_role_required IN ["all", "editor"]']
    return ['min_role_required = "all"']


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
