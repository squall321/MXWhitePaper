"""Document 비즈니스 로직: ETag, version bump, audit_log.

Sprint 1 범위:
  - ETag 포맷: W/"<id>-<version>"
  - PUT 시 If-Match 헤더와 비교 → 불일치 시 412 PreconditionFailed
  - PUT/POST 시 section_numbering.renumber_sections() 호출
  - PUT 성공 시 document_versions 행 +1, audit_logs 기록

Sprint 4 — Editor MVP 추가:
  - Section/Block PATCH/insert/move/delete + Outline reorder
  - X-MXWP-Change-Log 헤더 (auto-save 등) → change_log 기록
  - versions/<n>/restore (If-Match 면제, 의도된 override)
"""
from __future__ import annotations

import copy
import logging
import os
import re
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound, PreconditionFailed, ValidationFailed
from app.repos import document_repo
from app.schemas.document import DocumentjsonV10
from app.search import meili_indexer
from app.services import webhook_dispatcher
from app.services.section_numbering import renumber_sections
from app.services.wiki_link_extractor import extract_wiki_links

logger = logging.getLogger(__name__)

# X-MXWP-Change-Log 허용 문자: 알파벳, 숫자, -, _, ., :, 공백. ≤80자
_CHANGE_LOG_RE = re.compile(r"^[A-Za-z0-9._:\-\s]{1,80}$")


# ── Block-level permission scrubbing ────────────────────────────────────
# Mirror of FE `canSeeBlock` in apps/web/src/components/blocks/BlockRenderer.tsx.
# Higher number = more privileged. Unknown roles fall back to 0 (most-restrictive).
_ROLE_LEVEL: dict[str, int] = {"reader": 1, "editor": 2, "owner": 3, "admin": 4}
_PERM_LEVEL: dict[str, int] = {"all": 1, "editor": 2, "admin": 4}


def _can_see_block(meta: Any, role_level: int) -> bool:
    if not isinstance(meta, dict):
        return True
    perm = meta.get("permission")
    if not isinstance(perm, str):
        return True
    needed = _PERM_LEVEL.get(perm, 1)
    return role_level >= needed


def _redact_block(block: dict[str, Any]) -> dict[str, Any]:
    """Replace a hidden block with an opaque placeholder.

    The placeholder retains the original `id` and the original
    `meta.permission` value so the FE can still surface "this block is
    restricted" in the same slot — but no other field of the original
    block leaks through (no text, no captions, no nested blocks).
    """
    perm = (block.get("meta") or {}).get("permission")
    return {
        "type": "paragraph",
        "id": block.get("id", ""),
        "text": "[권한이 부족한 블록]",
        "meta": {"permission": perm} if perm else {},
    }


def _scrub_block_array(blocks: Any, role_level: int) -> Any:
    if not isinstance(blocks, list):
        return blocks
    out: list[Any] = []
    for blk in blocks:
        if not isinstance(blk, dict):
            out.append(blk)
            continue
        if not _can_see_block(blk.get("meta"), role_level):
            out.append(_redact_block(blk))
            continue
        # Recurse into container blocks so nested blocks are also gated.
        btype = blk.get("type")
        if btype == "columns":
            cols = blk.get("columns")
            if isinstance(cols, list):
                blk["columns"] = [
                    _scrub_block_array(col, role_level) for col in cols
                ]
        elif btype == "tabs":
            tabs = blk.get("tabs")
            if isinstance(tabs, list):
                for tab in tabs:
                    if isinstance(tab, dict):
                        tab["blocks"] = _scrub_block_array(
                            tab.get("blocks"), role_level
                        )
        elif btype == "accordion":
            items = blk.get("items")
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict):
                        it["blocks"] = _scrub_block_array(
                            it.get("blocks"), role_level
                        )
        out.append(blk)
    return out


def _scrub_sections(sections: Any, role_level: int) -> Any:
    if not isinstance(sections, list):
        return sections
    for sec in sections:
        if not isinstance(sec, dict):
            continue
        sec["blocks"] = _scrub_block_array(sec.get("blocks"), role_level)
        _scrub_sections(sec.get("subsections"), role_level)
    return sections


def scrub_for_response(
    content_json: dict[str, Any], *, role: str | None
) -> dict[str, Any]:
    """Public entry point for response-path scrubbing.

    Thin wrapper around `scrub_blocks_for_role`. `role=None` is treated as the
    lowest tier ('reader') — used by anonymous paths such as `/share/:token`
    where the viewer has no authenticated role.
    """
    return scrub_blocks_for_role(content_json, role or "reader")


def scrub_section_for_response(
    section: dict[str, Any], *, role: str | None
) -> dict[str, Any]:
    """Scrub a single section subtree for the caller's role.

    Used by endpoints that return only a section (PATCH section). Admin role
    short-circuits to identity. Otherwise blocks (incl. nested
    columns/tabs/accordion + subsections) are scrubbed.
    """
    if not isinstance(section, dict):
        return section
    role_level = _ROLE_LEVEL.get((role or "reader").lower(), 0)
    if role_level >= _PERM_LEVEL["admin"]:
        return section
    cloned = copy.deepcopy(section)
    cloned["blocks"] = _scrub_block_array(cloned.get("blocks"), role_level)
    _scrub_sections(cloned.get("subsections"), role_level)
    return cloned


def scrub_block_for_response(
    block: dict[str, Any], *, role: str | None
) -> dict[str, Any]:
    """Scrub a single block (and its nested children) for the caller's role.

    Used by endpoints that return only a block (PATCH block). The block itself
    may have a `meta.permission` above the caller — in which case it's
    redacted to a placeholder.
    """
    if not isinstance(block, dict):
        return block
    role_level = _ROLE_LEVEL.get((role or "reader").lower(), 0)
    if role_level >= _PERM_LEVEL["admin"]:
        return block
    scrubbed = _scrub_block_array([copy.deepcopy(block)], role_level)
    return scrubbed[0] if scrubbed else block


def scrub_blocks_for_role(
    content_json: dict[str, Any], role: str | None
) -> dict[str, Any]:
    """Walk a DocumentJSON tree and redact blocks the caller can't see.

    Permission matrix (role × meta.permission → visible?):

        role        all   editor   admin
        reader      ✓     ✗        ✗
        editor      ✓     ✓        ✗
        owner       ✓     ✓        ✗
        admin       ✓     ✓        ✓
        (unknown)   ✓     ✗        ✗      (treated as < reader)

    A redacted block is replaced with a stable opaque placeholder:

        { "type": "paragraph", "id": <original-id>,
          "text": "[권한이 부족한 블록]",
          "meta": { "permission": <original-permission> } }

    so the original payload (text, captions, nested blocks) never leaves
    the server. The caller is responsible for *not* echoing the resulting
    document back into a write path — the redacted shape would clobber the
    real content. This function deep-copies internally to be safe.
    """
    if not isinstance(content_json, dict):
        return content_json
    role_level = _ROLE_LEVEL.get((role or "").lower(), 0)
    # Admins (and anything ≥ admin) see everything → fast path, no copy.
    if role_level >= _PERM_LEVEL["admin"]:
        return content_json
    cloned = copy.deepcopy(content_json)
    _scrub_sections(cloned.get("sections"), role_level)
    return cloned


def make_etag(doc_id: str, version: int) -> str:
    """Weak ETag 포맷 — 본문 단위 해시는 향후 도입."""
    return f'W/"{doc_id}-{version}"'


def parse_if_match(header: str | None) -> tuple[str, int] | None:
    """`W/"<id>-<version>"` 또는 `"<id>-<version>"` 파싱."""
    if not header:
        return None
    val = header.strip()
    if val.startswith("W/"):
        val = val[2:]
    val = val.strip('"')
    if "-" not in val:
        return None
    last_dash = val.rfind("-")
    doc_id = val[:last_dash]
    try:
        version = int(val[last_dash + 1 :])
    except ValueError:
        return None
    return doc_id, version


def validate_documentjson(payload: dict[str, Any]) -> dict[str, Any]:
    """DocumentJSON v1.0 Pydantic 검증 + section 재번호."""
    from pydantic import ValidationError

    from app.core.errors import format_pydantic_errors

    try:
        doc = DocumentjsonV10.model_validate(payload)
    except ValidationError as e:
        friendly = format_pydantic_errors(e.errors())
        raise ValidationFailed(
            "DocumentJSON v1.0 본문이 규격에 맞지 않습니다 — details.errors 참조.",
            details={"errors": friendly},
        ) from e
    except Exception as e:
        raise ValidationFailed(
            f"DocumentJSON v1.0 validation failed: {e}",
            details={"errors": str(e)},
        ) from e

    # by_alias=True 로 imageId / chartType 등 카멜 키 보존
    dumped = doc.model_dump(by_alias=True, mode="json", exclude_none=False)
    renumber_sections(dumped)
    return dumped


async def update_links_for_document(
    s: AsyncSession,
    *,
    doc_id: str,
    content_json: dict[str, Any],
) -> int:
    """links 테이블을 doc_id 기준으로 재구축. 같은 트랜잭션 내에서 실행."""
    extracted = extract_wiki_links(content_json)
    return await document_repo.replace_links_for_document(
        s, source_doc_id=doc_id, links=extracted
    )


async def refresh_search_view(s: AsyncSession) -> None:
    """`documents_flat_v` 갱신 — save 후 호출.

    CONCURRENTLY 모드는 unique index 가 필요하다 (0002 마이그레이션에서 생성됨).
    실패하면 non-concurrent 으로 폴백, 그래도 실패하면 로그만 남기고 계속.
    유닛 테스트에서는 `MXWP_SKIP_VIEW_REFRESH=1` 로 스킵.
    """
    if os.environ.get("MXWP_SKIP_VIEW_REFRESH") == "1":
        return
    # CONCURRENTLY 는 별도 트랜잭션에서만 가능하므로 autocommit 으로 실행.
    try:
        # commit 이 끝났다고 가정 — 이미 호출자가 await s.commit() 후 호출.
        # 같은 세션이라도 새 transaction 으로 emit.
        await s.execute(text("REFRESH MATERIALIZED VIEW CONCURRENTLY documents_flat_v"))
        await s.commit()
    except Exception as e_concurrent:
        logger.warning(
            "REFRESH MATERIALIZED VIEW CONCURRENTLY failed, falling back to plain refresh: %s",
            e_concurrent,
        )
        try:
            await s.rollback()
        except Exception:
            pass
        try:
            await s.execute(text("REFRESH MATERIALIZED VIEW documents_flat_v"))
            await s.commit()
        except Exception as e_plain:
            logger.warning("REFRESH MATERIALIZED VIEW failed: %s", e_plain)
            try:
                await s.rollback()
            except Exception:
                pass


async def fire_webhook(
    event_kind: str,
    payload: dict[str, Any],
    *,
    target_part_id: str | None = None,
) -> None:
    """Best-effort dispatch — never blocks the originating mutation.

    Wraps `webhook_dispatcher.dispatch` in try/except so a misconfigured hook,
    network error, or assertion in payload construction can never fail the
    write that triggered the event. Also fans out to subscription dispatcher
    (Cycle 0018) for the kinds subscribers can ask about.
    """
    try:
        await webhook_dispatcher.dispatch(
            event_kind, payload, target_part_id=target_part_id
        )
    except Exception as e:
        logger.warning("webhook dispatch (%s) skipped: %s", event_kind, e)

    # Cycle 0018 — fan out to followers. We only handle the four event kinds
    # listed in the subscription contract; anything else (doc_created etc.) is
    # webhook-only.
    SUB_KINDS = {
        "doc_edited", "comment_added", "review_decided", "doc_published",
    }
    if event_kind in SUB_KINDS:
        doc_id = payload.get("document_id")
        actor = (
            payload.get("actor_user_id")
            or payload.get("author_user_id")
            or payload.get("reviewer_user_id")
        )
        if isinstance(doc_id, str) and doc_id:
            try:
                from app.services import digest_runner

                await digest_runner.dispatch_subscription_event(
                    event_kind,
                    document_id=doc_id,
                    payload=payload,
                    actor_user_id=actor if isinstance(actor, str) else None,
                )
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "subscription dispatch (%s) skipped: %s", event_kind, e,
                )


async def reindex_meili(s: AsyncSession, *, doc_id: str, archived: bool = False) -> None:
    """Best-effort: 한 문서를 Meilisearch 에 push 또는 인덱스에서 제거.

    실패는 로깅만 — write path 를 막지 않는다. MXWP_SKIP_MEILI=1 이면 no-op.
    """
    if os.environ.get("MXWP_SKIP_MEILI") == "1":
        return
    try:
        if archived:
            meili_indexer.delete_document(doc_id)
        else:
            await meili_indexer.upsert_document(s, doc_id)
    except Exception as e:
        logger.warning("Meilisearch sync skipped: %s", e)


async def upsert_glossary_terms(
    s: AsyncSession, *, doc_id: str, content_json: dict[str, Any]
) -> int:
    """문서의 glossary[] 를 terms 테이블에 idempotent 하게 업서트.

    related_docs 는 array_append 가 아니라 distinct UNION 으로 누적.
    또한 *이전* save 에서 등록되었던 term 중 이번 save 에서 사라진 것은
    terms.related_docs 에서 doc_id 를 제거한다 (idempotent).
    """
    glossary = content_json.get("glossary") or []
    if not isinstance(glossary, list):
        glossary = []
    new_terms: set[str] = set()
    for item in glossary:
        if not isinstance(item, dict):
            continue
        term = item.get("term")
        definition = item.get("definition")
        if not isinstance(term, str) or not term.strip():
            continue
        if not isinstance(definition, str) or not definition.strip():
            continue
        t = term.strip()
        new_terms.add(t)
        await s.execute(
            text("""
                INSERT INTO terms (term, definition, related_docs)
                VALUES (:t, :d, ARRAY[CAST(:doc AS uuid)])
                ON CONFLICT (term) DO UPDATE SET
                  definition = EXCLUDED.definition,
                  related_docs = (
                    SELECT ARRAY(
                      SELECT DISTINCT unnest(terms.related_docs || ARRAY[CAST(:doc AS uuid)])
                    )
                  )
            """),
            {"t": t, "d": definition.strip(), "doc": doc_id},
        )

    # 이번 doc 이 *이전*에 등록했던 term 중, 이번 save 의 set 에 없는 항목은
    # related_docs 에서 doc_id 를 제거.
    if new_terms:
        from sqlalchemy import bindparam
        stmt = text("""
            UPDATE terms
            SET related_docs = array_remove(related_docs, CAST(:doc AS uuid))
            WHERE CAST(:doc AS uuid) = ANY(related_docs)
              AND term NOT IN :keep
        """).bindparams(bindparam("keep", expanding=True))
        await s.execute(stmt, {"doc": doc_id, "keep": list(new_terms)})
    else:
        # 새 glossary 가 비어있으면 이 doc 이 기여한 모든 term 에서 제거
        await s.execute(
            text("""
                UPDATE terms
                SET related_docs = array_remove(related_docs, CAST(:doc AS uuid))
                WHERE CAST(:doc AS uuid) = ANY(related_docs)
            """),
            {"doc": doc_id},
        )
    return len(new_terms)


async def resolve_metadata_part(
    s: AsyncSession,
    metadata: dict[str, Any] | None,
) -> tuple[str | None, list[dict[str, Any]]]:
    """metadata.part 를 part.id 로 해석. 반환: (part_id, warnings).

    해석 순서:
      1. metadata.part 값이 slug 면 곧바로 매칭
      2. slug 미발견 → name 매칭 시도. metadata.team / metadata.group /
         metadata.division 가 slug 형태이면 hint 로 사용해 disambiguate
      3. 여전히 미발견 또는 multiple match → NULL + warnings[]
    """
    warnings: list[dict[str, Any]] = []
    if not isinstance(metadata, dict):
        return None, warnings
    raw = metadata.get("part")
    if not isinstance(raw, str) or not raw.strip():
        return None, warnings
    raw = raw.strip()

    # 1) slug 시도
    pid = await document_repo.fetch_part_id_by_slug(s, raw)
    if pid:
        return pid, warnings

    # 2) name 시도 (한글 등 사람-읽기 이름 지원)
    div = metadata.get("division")
    team = metadata.get("team")
    group = metadata.get("group")
    # team/group/division 도 *ASCII* slug 일 때만 hint 로 사용
    # (한글 이름이 들어오면 hint 로 못 쓰고 단순 name 매칭만)
    def _is_slug(v: Any) -> bool:
        return (
            isinstance(v, str)
            and bool(v)
            and v.isascii()
            and v == v.lower()
            and all(c.isalnum() or c == "-" for c in v)
        )
    matches = await document_repo.fetch_parts_by_name(
        s,
        raw,
        division_slug=div if _is_slug(div) else None,
        team_slug=team if _is_slug(team) else None,
        group_slug=group if _is_slug(group) else None,
    )
    if len(matches) == 1:
        return matches[0]["id"], warnings
    if len(matches) > 1:
        warnings.append({
            "field": "metadata.part",
            "code": "ambiguous_name",
            "message": (
                f"part 이름 '{raw}' 이 여러 파트와 매칭됩니다 — slug 사용을 권장합니다."
            ),
            "candidates": [{"slug": m["slug"], "name": m["name"]} for m in matches],
        })
        return None, warnings
    warnings.append({
        "field": "metadata.part",
        "code": "unresolved",
        "message": (
            f"part '{raw}' 을(를) 찾지 못했습니다 — slug 또는 정확한 한글 이름을 사용하세요."
        ),
    })
    return None, warnings


async def resolve_owners(
    s: AsyncSession, owners: list[Any] | None
) -> tuple[list[str], list[dict[str, Any]]]:
    """owners[] 를 user.id list 로 해석. email/UUID/free-string 혼재 허용.

    free-string (a.k.a. 'admin' 같은 alias) 은 그대로 보존되며 warnings 에 표시.
    """
    warnings: list[dict[str, Any]] = []
    resolved: list[str] = []
    if not isinstance(owners, list):
        return resolved, warnings
    for raw in owners:
        if not isinstance(raw, str) or not raw.strip():
            continue
        val = raw.strip()
        uid = await document_repo.fetch_user_id_by_email_or_id(s, val)
        if uid:
            resolved.append(uid)
        else:
            warnings.append({
                "field": "metadata.owners",
                "code": "unresolved",
                "message": (
                    f"owner '{val}' 은 email/UUID 로 해석되지 않습니다 — "
                    "원문 그대로 저장됩니다."
                ),
                "value": val,
            })
    return resolved, warnings


def _extract_tag_names(content_json: dict[str, Any]) -> list[str]:
    md = content_json.get("metadata") or {}
    tags = md.get("tags") or []
    out: list[str] = []
    for t in tags:
        if isinstance(t, str) and t.strip():
            out.append(t.strip())
    return out


async def create_document(
    s: AsyncSession,
    *,
    payload: dict[str, Any],
    owner_id: str,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    validated = validate_documentjson(payload)
    slug = validated["slug"]
    title = validated["title"]
    summary = validated.get("summary")
    metadata = validated.get("metadata") or {}

    # part 해석 (slug → name → unresolved)
    part_id, warnings = await resolve_metadata_part(s, metadata)
    # owners 해석 (free-string 은 warnings 로만 surfaces)
    _, owner_warnings = await resolve_owners(s, metadata.get("owners"))
    warnings.extend(owner_warnings)

    inserted = await document_repo.insert_document(
        s,
        slug=slug,
        title=title,
        summary=summary,
        content_json=validated,
        owner_id=owner_id,
        part_id=part_id,
    )
    await document_repo.insert_version(
        s,
        doc_id=inserted["id"],
        version=inserted["version"],
        content_json=validated,
        edited_by=owner_id,
        change_log="initial",
    )
    await update_links_for_document(
        s, doc_id=inserted["id"], content_json=validated
    )
    # 태그 pipeline: metadata.tags → tags + document_tags (replace 전략)
    await document_repo.replace_document_tags(
        s,
        document_id=inserted["id"],
        tag_names=_extract_tag_names(validated),
    )
    await document_repo.insert_audit(
        s,
        user_id=owner_id,
        action="document.create",
        target=f"document:{slug}",
        payload={"version": inserted["version"]},
    )
    await upsert_glossary_terms(s, doc_id=inserted["id"], content_json=validated)
    await s.commit()
    await refresh_search_view(s)
    await reindex_meili(s, doc_id=inserted["id"])
    doc = await get_document_or_404(s, slug)
    await fire_webhook(
        "doc_created",
        {
            "event": "doc_created",
            "document_id": doc["id"],
            "slug": doc["slug"],
            "title": doc["title"],
            "version": doc["version"],
            "actor_user_id": owner_id,
        },
        target_part_id=part_id,
    )
    return doc, warnings


async def replace_document(
    s: AsyncSession,
    *,
    slug: str,
    payload: dict[str, Any],
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    existing = await document_repo.find_by_slug(s, slug)
    if not existing:
        raise NotFound(f"document not found: {slug}")

    parsed = parse_if_match(if_match)
    if not parsed:
        raise PreconditionFailed("If-Match header required for PUT")
    given_id, given_version = parsed
    if given_id != existing["id"] or given_version != existing["version"]:
        raise PreconditionFailed(
            "ETag mismatch — refresh and retry",
            details={
                "expected": make_etag(existing["id"], existing["version"]),
                "got": if_match,
            },
        )

    validated = validate_documentjson(payload)
    if validated["slug"] != slug:
        raise ValidationFailed(
            "slug in body must match URL slug",
            details={"url_slug": slug, "body_slug": validated["slug"]},
        )

    metadata = validated.get("metadata") or {}
    part_id, warnings = await resolve_metadata_part(s, metadata)
    _, owner_warnings = await resolve_owners(s, metadata.get("owners"))
    warnings.extend(owner_warnings)

    new_version = await document_repo.update_document(
        s,
        doc_id=existing["id"],
        title=validated["title"],
        summary=validated.get("summary"),
        content_json=validated,
    )
    # part_id 변경 반영 (replace 의미상 매번 재할당)
    await s.execute(
        text("UPDATE documents SET part_id = :p WHERE id = :id"),
        {"p": part_id, "id": existing["id"]},
    )
    log = normalize_change_log(change_log, default="replace")
    await document_repo.insert_version(
        s,
        doc_id=existing["id"],
        version=new_version,
        content_json=validated,
        edited_by=actor_id,
        change_log=log,
    )
    await update_links_for_document(
        s, doc_id=existing["id"], content_json=validated
    )
    await document_repo.replace_document_tags(
        s,
        document_id=existing["id"],
        tag_names=_extract_tag_names(validated),
    )
    await document_repo.insert_audit(
        s,
        user_id=actor_id,
        action="document.replace",
        target=f"document:{slug}",
        payload={"version": new_version, "change_log": log},
    )
    await upsert_glossary_terms(s, doc_id=existing["id"], content_json=validated)
    await s.commit()
    await refresh_search_view(s)
    await reindex_meili(s, doc_id=existing["id"])
    doc = await get_document_or_404(s, slug)
    await fire_webhook(
        "doc_edited",
        {
            "event": "doc_edited",
            "document_id": doc["id"],
            "slug": doc["slug"],
            "title": doc["title"],
            "version": doc["version"],
            "actor_user_id": actor_id,
            "change_log": log,
        },
        target_part_id=part_id,
    )
    return doc, warnings


async def archive_document(
    s: AsyncSession, *, slug: str, actor_id: str
) -> None:
    existing = await document_repo.find_by_slug(s, slug)
    if not existing:
        raise NotFound(f"document not found: {slug}")
    await document_repo.soft_delete_document(s, existing["id"])
    await document_repo.insert_audit(
        s,
        user_id=actor_id,
        action="document.archive",
        target=f"document:{slug}",
    )
    await s.commit()
    await refresh_search_view(s)
    await reindex_meili(s, doc_id=existing["id"], archived=True)


async def get_document_or_404(s: AsyncSession, slug: str) -> dict[str, Any]:
    doc = await document_repo.find_by_slug(s, slug)
    if not doc:
        raise NotFound(f"document not found: {slug}")
    return doc


# ── Sprint 4: Section/Block 편집 헬퍼 ─────────────────────────────────

def normalize_change_log(raw: str | None, default: str) -> str:
    """X-MXWP-Change-Log 헤더 검증 + 디폴트.

    None/빈 문자열 → default. 허용되지 않는 값 → ValidationFailed(422).
    """
    if raw is None:
        return default
    val = raw.strip()
    if not val:
        return default
    if not _CHANGE_LOG_RE.match(val):
        raise ValidationFailed(
            "X-MXWP-Change-Log header contains invalid characters or is too long",
            details={"got": raw, "max_len": 80},
        )
    return val


def _check_etag(existing: dict[str, Any], if_match: str | None) -> None:
    parsed = parse_if_match(if_match)
    if not parsed:
        raise PreconditionFailed("If-Match header required")
    given_id, given_version = parsed
    if given_id != existing["id"] or given_version != existing["version"]:
        raise PreconditionFailed(
            "ETag mismatch — refresh and retry",
            details={
                "expected": make_etag(existing["id"], existing["version"]),
                "got": if_match,
            },
        )


def _walk_sections(
    sections: list[dict[str, Any]],
    parent_level: int = 0,
) -> Any:
    """sections 트리를 yield. 각 항목: (section_dict, parent_list, idx, parent_level)."""
    for idx, sec in enumerate(sections):
        yield sec, sections, idx, parent_level
        subs = sec.get("subsections") or []
        if isinstance(subs, list):
            yield from _walk_sections(subs, parent_level=sec.get("level", parent_level + 1))


def _find_section(
    content: dict[str, Any], section_id: str
) -> tuple[dict[str, Any], list[dict[str, Any]], int, int] | None:
    sections = content.get("sections") or []
    for sec, parent, idx, parent_level in _walk_sections(sections, parent_level=0):
        if sec.get("id") == section_id:
            return sec, parent, idx, parent_level
    return None


def _walk_blocks_in_section(
    section: dict[str, Any],
):
    """섹션 자체의 blocks 만 yield (subsections 의 block 은 별도 호출).

    yields (block_dict, parent_blocks_list, idx, owner_section_id).
    컨테이너(columns/tabs/accordion) 안의 자식 block 도 재귀.
    """
    sec_id = section.get("id")
    yield from _walk_blocks_in_array(section.get("blocks") or [], sec_id)
    for sub in section.get("subsections") or []:
        if isinstance(sub, dict):
            yield from _walk_blocks_in_section(sub)


def _walk_blocks_in_array(blocks: list[dict[str, Any]], sec_id: str | None):
    for idx, blk in enumerate(blocks):
        if not isinstance(blk, dict):
            continue
        yield blk, blocks, idx, sec_id
        btype = blk.get("type")
        if btype == "columns":
            for col in blk.get("columns") or []:
                if isinstance(col, list):
                    yield from _walk_blocks_in_array(col, sec_id)
        elif btype == "tabs":
            for tab in blk.get("tabs") or []:
                if isinstance(tab, dict):
                    yield from _walk_blocks_in_array(tab.get("blocks") or [], sec_id)
        elif btype == "accordion":
            for item in blk.get("items") or []:
                if isinstance(item, dict):
                    yield from _walk_blocks_in_array(item.get("blocks") or [], sec_id)


def _find_block(
    content: dict[str, Any], block_id: str
) -> tuple[dict[str, Any], list[dict[str, Any]], int, str | None] | None:
    for sec in content.get("sections") or []:
        for blk, parent, idx, owner in _walk_blocks_in_section(sec):
            if blk.get("id") == block_id:
                return blk, parent, idx, owner
    return None


async def _persist_content_change(
    s: AsyncSession,
    *,
    existing: dict[str, Any],
    new_content: dict[str, Any],
    actor_id: str,
    change_log: str,
    action: str,
    target_suffix: str,
) -> dict[str, Any]:
    """Pydantic 검증 + renumber → DB UPDATE + version + audit + links.

    호출자가 if_match 검증을 끝냈다고 가정한다.
    """
    validated = validate_documentjson(new_content)
    # slug 일치 보장
    if validated["slug"] != existing["slug"]:
        raise ValidationFailed(
            "slug mismatch after edit",
            details={"existing": existing["slug"], "new": validated["slug"]},
        )

    new_version = await document_repo.update_document(
        s,
        doc_id=existing["id"],
        title=validated["title"],
        summary=validated.get("summary"),
        content_json=validated,
    )
    await document_repo.insert_version(
        s,
        doc_id=existing["id"],
        version=new_version,
        content_json=validated,
        edited_by=actor_id,
        change_log=change_log,
    )
    await update_links_for_document(
        s, doc_id=existing["id"], content_json=validated
    )
    await document_repo.replace_document_tags(
        s,
        document_id=existing["id"],
        tag_names=_extract_tag_names(validated),
    )
    await document_repo.insert_audit(
        s,
        user_id=actor_id,
        action=action,
        target=f"document:{existing['slug']}{target_suffix}",
        payload={"version": new_version, "change_log": change_log},
    )
    await upsert_glossary_terms(s, doc_id=existing["id"], content_json=validated)
    await s.commit()
    await refresh_search_view(s)
    await reindex_meili(s, doc_id=existing["id"])
    fresh = await get_document_or_404(s, existing["slug"])
    await fire_webhook(
        "doc_edited",
        {
            "event": "doc_edited",
            "document_id": fresh["id"],
            "slug": fresh["slug"],
            "title": fresh["title"],
            "version": fresh["version"],
            "actor_user_id": actor_id,
            "change_log": change_log,
        },
        target_part_id=fresh.get("part_id"),
    )
    return fresh


async def patch_section(
    s: AsyncSession,
    *,
    slug: str,
    section_id: str,
    patch: dict[str, Any],
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """섹션 PATCH. (updated_doc, updated_section_subtree) 반환."""
    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    found = _find_section(content, section_id)
    if not found:
        raise NotFound(f"section not found: {section_id}")
    sec, parent_list, idx, parent_level = found

    # level 변경 시 parent_level + 1 == new_level 보장.
    # parent_level == 0 이면 root → level 1 만 허용.
    if "level" in patch and patch["level"] is not None:
        new_level = patch["level"]
        expected = parent_level + 1 if parent_level > 0 else 1
        if new_level != expected:
            raise ValidationFailed(
                f"section level inconsistent with parent: parent_level={parent_level}, "
                f"new_level={new_level}, expected={expected}",
                details={
                    "parent_level": parent_level,
                    "new_level": new_level,
                    "expected_level": expected,
                },
            )
        sec["level"] = new_level

    if "title" in patch and patch["title"] is not None:
        sec["title"] = patch["title"]
    if "blocks" in patch and patch["blocks"] is not None:
        sec["blocks"] = patch["blocks"]
    if "subsections" in patch and patch["subsections"] is not None:
        sec["subsections"] = patch["subsections"]

    log = normalize_change_log(change_log, default=f"section.patch:{section_id}")
    updated = await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.section.patch",
        target_suffix=f"#section:{section_id}",
    )
    # 섭트리 다시 찾기 (renumber 후 number 가 바뀌었을 수 있음)
    new_section = _find_section(updated["content_json"], section_id)
    if not new_section:
        # 패치가 섹션을 제거하지 않았으니 일반적으로 도달 안 함.
        raise NotFound(f"section vanished after patch: {section_id}")
    return updated, new_section[0]


async def patch_block(
    s: AsyncSession,
    *,
    slug: str,
    block_id: str,
    new_block: dict[str, Any],
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Block 전체 교체. (updated_doc, replaced_block) 반환."""
    if not isinstance(new_block, dict):
        raise ValidationFailed("block payload must be an object")
    body_id = new_block.get("id")
    if body_id != block_id:
        raise ValidationFailed(
            "block id in URL must match body.id",
            details={"url_id": block_id, "body_id": body_id},
        )
    if "type" not in new_block:
        raise ValidationFailed("block.type required")

    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    found = _find_block(content, block_id)
    if not found:
        raise NotFound(f"block not found: {block_id}")
    _, parent_list, idx, _ = found
    parent_list[idx] = new_block

    log = normalize_change_log(change_log, default=f"block.patch:{block_id}")
    updated = await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.block.patch",
        target_suffix=f"#block:{block_id}",
    )
    new_loc = _find_block(updated["content_json"], block_id)
    return updated, (new_loc[0] if new_loc else new_block)


async def insert_block(
    s: AsyncSession,
    *,
    slug: str,
    section_id: str,
    after_block_id: str | None,
    new_block: dict[str, Any],
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> dict[str, Any]:
    if not isinstance(new_block, dict) or "type" not in new_block or "id" not in new_block:
        raise ValidationFailed("block payload must include type and id")

    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    sec_found = _find_section(content, section_id)
    if not sec_found:
        raise NotFound(f"section not found: {section_id}")
    sec = sec_found[0]
    blocks: list[dict[str, Any]] = sec.setdefault("blocks", [])

    if after_block_id is None:
        blocks.append(new_block)
    else:
        # after_block_id 가 정확히 이 섹션의 top-level blocks 안에 있어야 한다
        target_idx = next(
            (i for i, b in enumerate(blocks) if isinstance(b, dict) and b.get("id") == after_block_id),
            None,
        )
        if target_idx is None:
            raise NotFound(
                f"after_block_id not found in section.blocks: {after_block_id}"
            )
        blocks.insert(target_idx + 1, new_block)

    log = normalize_change_log(change_log, default=f"block.insert:{new_block['id']}")
    return await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.block.insert",
        target_suffix=f"#block:{new_block['id']}",
    )


async def delete_block(
    s: AsyncSession,
    *,
    slug: str,
    block_id: str,
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> dict[str, Any]:
    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    found = _find_block(content, block_id)
    if not found:
        raise NotFound(f"block not found: {block_id}")
    _, parent_list, idx, _ = found
    del parent_list[idx]

    log = normalize_change_log(change_log, default=f"block.delete:{block_id}")
    return await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.block.delete",
        target_suffix=f"#block:{block_id}",
    )


async def move_block(
    s: AsyncSession,
    *,
    slug: str,
    block_id: str,
    target_section_id: str,
    after_block_id: str | None,
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> dict[str, Any]:
    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    src = _find_block(content, block_id)
    if not src:
        raise NotFound(f"block not found: {block_id}")
    blk_obj, src_parent, src_idx, _ = src
    # remove from source
    moved = src_parent.pop(src_idx)

    tgt = _find_section(content, target_section_id)
    if not tgt:
        raise NotFound(f"target section not found: {target_section_id}")
    tgt_blocks: list[dict[str, Any]] = tgt[0].setdefault("blocks", [])
    if after_block_id is None:
        tgt_blocks.append(moved)
    else:
        target_idx = next(
            (i for i, b in enumerate(tgt_blocks) if isinstance(b, dict) and b.get("id") == after_block_id),
            None,
        )
        if target_idx is None:
            raise NotFound(
                f"after_block_id not found in target section.blocks: {after_block_id}"
            )
        tgt_blocks.insert(target_idx + 1, moved)

    log = normalize_change_log(change_log, default=f"block.move:{block_id}")
    return await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.block.move",
        target_suffix=f"#block:{block_id}",
    )


def _index_sections_by_id(content: dict[str, Any]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for sec, _, _, _ in _walk_sections(content.get("sections") or [], parent_level=0):
        sid = sec.get("id")
        if sid:
            out[sid] = sec
    return out


def _build_reordered_sections(
    outline: list[dict[str, Any]],
    index: dict[str, dict[str, Any]],
    depth: int = 1,
    seen: set[str] | None = None,
) -> list[dict[str, Any]]:
    if seen is None:
        seen = set()
    # 빈 리스트는 depth 검사 면제 — 실제 요소가 들어올 때만 depth>3 을 거부.
    if depth > 3 and outline:
        raise ValidationFailed(
            "section depth cannot exceed 3",
            details={"depth": depth},
        )
    out: list[dict[str, Any]] = []
    for ref in outline:
        if not isinstance(ref, dict) or "id" not in ref:
            raise ValidationFailed("outline entry must have an id")
        sid = ref["id"]
        if sid in seen:
            raise ValidationFailed(
                f"duplicate section id in outline: {sid}",
                details={"id": sid},
            )
        seen.add(sid)
        original = index.get(sid)
        if original is None:
            raise ValidationFailed(
                f"unknown section id in outline: {sid}",
                details={"id": sid},
            )
        # 자식 outline 재귀
        children_refs = ref.get("children") or []
        new_subs = _build_reordered_sections(children_refs, index, depth + 1, seen)
        # 새 섹션 dict — 원본의 title/blocks/id 는 보존, level 은 depth 로 재유도.
        new_sec = {
            "id": sid,
            "level": depth,
            "title": original.get("title", ""),
            "blocks": original.get("blocks") or [],
            "subsections": new_subs,
            # number 는 renumber 가 다시 채움
        }
        out.append(new_sec)
    return out


async def reorder_sections(
    s: AsyncSession,
    *,
    slug: str,
    outline: list[dict[str, Any]],
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> dict[str, Any]:
    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    index = _index_sections_by_id(content)
    new_sections = _build_reordered_sections(outline, index, depth=1, seen=set())

    # 모든 기존 id 가 outline 에 들어왔는지 확인 (누락 금지)
    seen_ids = set()
    def _collect(secs: list[dict[str, Any]]) -> None:
        for sc in secs:
            seen_ids.add(sc["id"])
            _collect(sc.get("subsections") or [])
    _collect(new_sections)

    missing = set(index.keys()) - seen_ids
    if missing:
        raise ValidationFailed(
            "outline missing section ids",
            details={"missing": sorted(missing)},
        )

    content["sections"] = new_sections

    log = normalize_change_log(change_log, default="sections.reorder")
    return await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.sections.reorder",
        target_suffix="#sections.reorder",
    )


async def patch_variables(
    s: AsyncSession,
    *,
    slug: str,
    variables: dict[str, str],
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> dict[str, Any]:
    """문서의 `variables` 맵을 통째로 교체.

    값이 빈 문자열이거나 None인 항목은 자동으로 제거되어 빈 변수가 누적되지
    않는다. payload 형 검증은 schema (`additionalProperties: { type: 'string' }`)
    가 담당하므로 여기서는 합집합 갱신만 수행한다.
    """
    if not isinstance(variables, dict):
        raise ValidationFailed("variables payload must be an object")
    cleaned: dict[str, str] = {}
    for k, v in variables.items():
        if not isinstance(k, str) or not k:
            continue
        if v is None:
            continue
        if not isinstance(v, str):
            raise ValidationFailed(
                "variables values must be strings",
                details={"key": k, "value_type": type(v).__name__},
            )
        if v:
            cleaned[k] = v

    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    if cleaned:
        content["variables"] = cleaned
    else:
        content.pop("variables", None)

    log = normalize_change_log(change_log, default="variables.patch")
    return await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.variables.patch",
        target_suffix="#variables",
    )


async def restore_version(
    s: AsyncSession,
    *,
    slug: str,
    version: int,
    actor_id: str,
) -> dict[str, Any]:
    """버전 n 의 content 를 head 로 복사. If-Match 면제 (의도된 override).

    수동 롤백 액션이며, 보통 새 버전을 만든 직후 사용한다. concurrent edit
    이 있어도 head 가 강제로 v(n) 의 본문으로 덮어써지므로 호출자 책임.
    """
    existing = await get_document_or_404(s, slug)
    ver = await document_repo.find_version(s, doc_id=existing["id"], version=version)
    if not ver:
        raise NotFound(f"version not found: {slug}@{version}")

    content = ver["content_json"]
    log = f"restore-from-v{version}"
    return await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.restore",
        target_suffix=f"#restore:v{version}",
    )
