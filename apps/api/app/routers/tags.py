"""태그 자동완성 + 태그 매니저 라우터.

엔드포인트:
  GET  /api/v1/tags                 — 태그 prefix 자동완성 + count (reader+, 60s LRU)
  GET  /api/v1/tags/{tag}/documents — 해당 태그를 가진 문서 카드 리스트 (reader+)
  POST /api/v1/tags/rename          — 모든 문서의 metadata.tags 에서 from→to (editor+)
  POST /api/v1/tags/delete          — 모든 문서의 metadata.tags 에서 tag 제거 (admin+)

집계는 `documents.content_json -> 'metadata' -> 'tags'` (jsonb 배열) 을
walk 한다. `documents.status != 'archived'` 만 포함한다.

LRU 캐시는 files.py 의 in-process 패턴을 그대로 따른다 (60s, 단일 프로세스).
"""
from __future__ import annotations

import json
import time
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin, require_editor, require_reader
from app.core.db import get_db
from app.core.errors import ValidationFailed, envelope
from app.repos import document_repo
from app.services.document_service import refresh_search_view, reindex_meili

router = APIRouter(prefix="/api/v1/tags", tags=["tags"])

# ── 60초 in-process LRU 캐시 ─────────────────────────────────────────
# files.py 의 dict 기반 패턴과 동일 — 단일 프로세스 가정.
_CACHE_TTL_SECONDS = 60.0
_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}


def _cache_get(key: str) -> list[dict[str, Any]] | None:
    entry = _cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if expires_at < time.monotonic():
        _cache.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: list[dict[str, Any]]) -> None:
    _cache[key] = (time.monotonic() + _CACHE_TTL_SECONDS, value)


def _cache_clear() -> None:
    _cache.clear()


@router.get(
    "",
    summary="태그 자동완성 — prefix 매칭 + 사용 횟수",
    description=(
        "모든 비-archived 문서의 `metadata.tags` 를 집계해 (name, count) 로 반환한다. "
        "`q` 가 주어지면 prefix(case-insensitive)로 필터링한다."
    ),
)
async def list_tags(
    q: str | None = Query(default=None, description="태그 prefix 필터 (case-insensitive)"),
    limit: int = Query(default=20, ge=1, le=500),
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    cache_key = f"q={q or ''}|limit={limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return envelope(data=cached, meta={"count": len(cached), "cached": True})

    params: dict[str, Any] = {"lim": limit}
    where_clause = ""
    if q is not None and q.strip():
        where_clause = "WHERE LOWER(t.tag) LIKE :prefix"
        params["prefix"] = f"{q.strip().lower()}%"

    sql = f"""
        SELECT t.tag AS name, COUNT(*)::int AS cnt
        FROM (
            SELECT jsonb_array_elements_text(
                       d.content_json -> 'metadata' -> 'tags'
                   ) AS tag
            FROM documents d
            WHERE d.status != 'archived'
              AND jsonb_typeof(d.content_json -> 'metadata' -> 'tags') = 'array'
        ) AS t
        {where_clause}
        GROUP BY t.tag
        ORDER BY cnt DESC, t.tag ASC
        LIMIT :lim
    """
    rows = (await s.execute(text(sql), params)).all()
    items = [{"name": r[0], "count": int(r[1])} for r in rows]
    _cache_set(cache_key, items)
    return envelope(data=items, meta={"count": len(items), "cached": False})


@router.get(
    "/{tag}/documents",
    summary="특정 태그가 달린 문서 목록",
    description="`metadata.tags` 에 주어진 태그가 포함된 문서 카드 리스트를 반환.",
)
async def list_documents_for_tag(
    tag: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_reader),
) -> dict[str, Any]:
    if not tag.strip():
        raise ValidationFailed("tag must not be empty")
    sql = """
        SELECT d.slug, d.title, d.summary, d.updated_at
        FROM documents d
        WHERE d.status != 'archived'
          AND jsonb_typeof(d.content_json -> 'metadata' -> 'tags') = 'array'
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(
                  d.content_json -> 'metadata' -> 'tags'
              ) AS x WHERE x = :tag
          )
        ORDER BY d.updated_at DESC
        LIMIT :lim OFFSET :off
    """
    rows = (await s.execute(
        text(sql),
        {"tag": tag, "lim": limit, "off": offset},
    )).all()
    items = [
        {
            "slug": r[0],
            "title": r[1],
            "summary": r[2],
            "updated_at": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]
    return envelope(
        data=items,
        meta={"count": len(items), "tag": tag, "limit": limit, "offset": offset},
    )


def _normalize_tag(s: str) -> str:
    return s.strip()


async def _walk_and_apply(
    s: AsyncSession,
    *,
    matcher: str,
    transform,
) -> tuple[int, list[str]]:
    """모든 비-archived 문서를 돌며 metadata.tags 가 `matcher` 와 일치하는 문서에
    `transform(tags)` 를 적용하고 doc 을 업데이트한다.

    `transform(list[str]) -> list[str]` — None 반환 시 변경 없음.
    Returns (영향받은 문서 수, 변경된 doc_id 리스트). Meili 재인덱스는
    호출자가 commit 후 수행한다 (document_service.py 의 패턴과 동일).
    """
    rows = (await s.execute(
        text("""
            SELECT d.id, d.content_json
            FROM documents d
            WHERE d.status != 'archived'
              AND jsonb_typeof(d.content_json -> 'metadata' -> 'tags') = 'array'
              AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(
                      d.content_json -> 'metadata' -> 'tags'
                  ) AS x WHERE x = :match
              )
        """),
        {"match": matcher},
    )).all()

    affected_ids: list[str] = []
    for r in rows:
        doc_id = str(r[0])
        content = r[1]
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except json.JSONDecodeError:
                continue
        if not isinstance(content, dict):
            continue
        meta = content.get("metadata")
        if not isinstance(meta, dict):
            continue
        tags = meta.get("tags")
        if not isinstance(tags, list):
            continue
        new_tags = transform([t for t in tags if isinstance(t, str)])
        if new_tags is None or new_tags == tags:
            continue
        meta["tags"] = new_tags
        content["metadata"] = meta

        # documents 테이블 업데이트 (version++) + document_tags 재구성.
        await s.execute(
            text("""
                UPDATE documents
                SET content_json = CAST(:body AS JSONB),
                    version = version + 1,
                    updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": doc_id,
                "body": json.dumps(content, ensure_ascii=False),
            },
        )
        await document_repo.replace_document_tags(
            s, document_id=doc_id, tag_names=new_tags
        )
        affected_ids.append(doc_id)
    return len(affected_ids), affected_ids


@router.post(
    "/rename",
    summary="태그 일괄 rename — from → to",
    description=(
        "모든 비-archived 문서의 `metadata.tags` 에서 `from` 을 `to` 로 치환. "
        "이미 `to` 가 같은 문서에 있으면 dedupe. document version 이 +1 된다."
    ),
)
async def rename_tag(
    payload: dict[str, Any],
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_editor),
) -> dict[str, Any]:
    src = _normalize_tag(str(payload.get("from") or ""))
    dst = _normalize_tag(str(payload.get("to") or ""))
    if not src:
        raise ValidationFailed("'from' must not be empty")
    if not dst:
        raise ValidationFailed("'to' must not be empty")
    if src == dst:
        return envelope(data={"affected": 0}, meta={"reason": "from == to"})

    def _xform(tags: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for t in tags:
            mapped = dst if t == src else t
            if mapped in seen:
                continue
            seen.add(mapped)
            out.append(mapped)
        return out

    affected, doc_ids = await _walk_and_apply(s, matcher=src, transform=_xform)
    await s.commit()
    await refresh_search_view(s)
    for did in doc_ids:
        await reindex_meili(s, doc_id=did)
    _cache_clear()
    return envelope(data={"affected": affected})


@router.post(
    "/delete",
    summary="태그 일괄 삭제",
    description="모든 비-archived 문서의 `metadata.tags` 에서 주어진 tag 를 제거.",
)
async def delete_tag(
    payload: dict[str, Any],
    s: AsyncSession = Depends(get_db),
    _user: dict = Depends(require_admin),
) -> dict[str, Any]:
    target = _normalize_tag(str(payload.get("tag") or ""))
    if not target:
        raise ValidationFailed("'tag' must not be empty")

    def _xform(tags: list[str]) -> list[str]:
        return [t for t in tags if t != target]

    affected, doc_ids = await _walk_and_apply(s, matcher=target, transform=_xform)
    await s.commit()
    await refresh_search_view(s)
    for did in doc_ids:
        await reindex_meili(s, doc_id=did)
    _cache_clear()
    return envelope(data={"affected": affected})
