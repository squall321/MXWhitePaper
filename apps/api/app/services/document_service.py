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

import asyncio
import copy
import logging
import os
import re
from typing import Any

from fastapi import BackgroundTasks
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import session_scope
from app.core.errors import NotFound, PreconditionFailed, ValidationFailed
from app.repos import document_repo
from app.schemas.document import DocumentjsonV10
from app.search import meili_indexer
from app.services import section_numbering, webhook_dispatcher
from app.services.heading_promote import promote_inline_headings
from app.services.section_numbering import renumber_sections
from app.services.wiki_link_alias import resolve_term_aliases
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

    Also normalises legacy image-annotation shapes (callout.text → label,
    snake_case image_id) in place — pre-pass-2 rows on disk still carry the
    old keys, and FE assumes the canonical post-pass-2 shape. validate_documentjson
    does this on the save path; we mirror it on the read path so the response
    is canonical regardless of when the row was written.
    """
    # 응답 전에 legacy shape 보정 — content_json 의 (deep) 사본을 만들 비용을
    # 피하기 위해 in-place. scrub_blocks_for_role 가 어차피 새 사본을 만들지만,
    # 이 normaliser 가 그 전에 호출돼도 무해 (callout label 만 손봄).
    if isinstance(content_json, dict):
        _normalise_image_annotation_ids(content_json)
        _normalise_image_annotation_labels(content_json)
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


def _normalise_image_annotation_ids(payload: dict[str, Any]) -> None:
    """Rewrite legacy ``image_id`` → ``imageId`` on every ``image-annotation``
    block in place.

    The schema migrated from ``image_id`` (snake-case) to ``imageId``
    (camel-case, matching ``ImageBlock``/``GalleryBlock``). Old rows persisted
    before the migration still carry ``image_id`` in their DocumentJSON.
    Pydantic with ``extra='forbid'`` would reject those, so we shim the key
    here — before validation — without touching any other field.

    Only the ``image-annotation`` block is affected; the surrounding
    ``image_id`` columns on ``images``/``templates``/``series`` tables are
    out of scope.
    """

    def _walk_block(blk: Any) -> None:
        if not isinstance(blk, dict):
            return
        t = blk.get("type")
        if t == "image-annotation":
            # Old key present, new key absent → rename. If both happen to be
            # present, keep the new one (caller intent) and drop the legacy.
            if "image_id" in blk:
                if "imageId" not in blk:
                    blk["imageId"] = blk["image_id"]
                del blk["image_id"]
            return
        if t == "columns":
            for col in blk.get("columns") or []:
                if isinstance(col, list):
                    for child in col:
                        _walk_block(child)
        elif t == "tabs":
            for tab in blk.get("tabs") or []:
                for child in (tab or {}).get("blocks") or []:
                    _walk_block(child)
        elif t == "accordion":
            for item in blk.get("items") or []:
                for child in (item or {}).get("blocks") or []:
                    _walk_block(child)

    def _walk_section(sec: dict[str, Any]) -> None:
        for blk in sec.get("blocks") or []:
            _walk_block(blk)
        for sub in sec.get("subsections") or []:
            _walk_section(sub)

    for sec in payload.get("sections") or []:
        if isinstance(sec, dict):
            _walk_section(sec)


def _normalise_image_annotation_labels(payload: dict[str, Any]) -> None:
    """Rewrite legacy ``text`` → ``label`` on every callout-kind annotation
    of every ``image-annotation`` block in place.

    Pre-pass-2, callout-kind annotations carried their string under ``text``
    while arrow / rect already used ``label``. The schema unified all three
    on ``label``. Old rows persisted before the unification still carry
    ``text`` in their DocumentJSON. Pydantic with ``extra='forbid'`` would
    reject those, so we shim the key here — before validation — without
    touching any other field. Mirrors ``_normalise_image_annotation_ids``.

    Only ``kind == "callout"`` annotations are affected; arrow / rect were
    already canonical.
    """

    def _walk_block(blk: Any) -> None:
        if not isinstance(blk, dict):
            return
        t = blk.get("type")
        if t == "image-annotation":
            for ann in blk.get("annotations") or []:
                if not isinstance(ann, dict):
                    continue
                if ann.get("kind") != "callout":
                    continue
                if "text" in ann:
                    if "label" not in ann:
                        ann["label"] = ann["text"]
                    del ann["text"]
            return
        if t == "columns":
            for col in blk.get("columns") or []:
                if isinstance(col, list):
                    for child in col:
                        _walk_block(child)
        elif t == "tabs":
            for tab in blk.get("tabs") or []:
                for child in (tab or {}).get("blocks") or []:
                    _walk_block(child)
        elif t == "accordion":
            for item in blk.get("items") or []:
                for child in (item or {}).get("blocks") or []:
                    _walk_block(child)

    def _walk_section(sec: dict[str, Any]) -> None:
        for blk in sec.get("blocks") or []:
            _walk_block(blk)
        for sub in sec.get("subsections") or []:
            _walk_section(sub)

    for sec in payload.get("sections") or []:
        if isinstance(sec, dict):
            _walk_section(sec)


def validate_documentjson(payload: dict[str, Any]) -> dict[str, Any]:
    """DocumentJSON v1.0 Pydantic 검증 + section 재번호 + columns widths 정합성."""
    from pydantic import ValidationError

    from app.core.errors import format_pydantic_errors

    # Legacy migration: image-annotation blocks used snake-case `image_id`
    # before the imageId unification. Rewrite in place so old rows validate.
    _normalise_image_annotation_ids(payload)
    # Legacy migration: callout-kind annotations used `text` before the
    # arrow/rect/callout label unification (pass-2). Rewrite in place.
    _normalise_image_annotation_labels(payload)

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
    # 본문 안의 heading-4 블록을 sub-section 으로 자동 승격.
    # renumber 보다 *먼저* 호출해서 새 섹션도 1, 1.1, 1.1.1 번호를 받게.
    promote_inline_headings(dumped)
    renumber_sections(dumped)
    _normalise_columns_widths(dumped)
    _normalise_table_cells(dumped)
    _assert_unique_ids(dumped)
    return dumped


def _normalise_columns_widths(content: dict[str, Any]) -> None:
    """Walk every ColumnsBlock in the document. If `widths` is set, enforce
    length == len(columns) and rescale the sum to 100 so the row always
    fills the available width. Mutates ``content`` in place.
    """

    def _renorm(widths: list[Any]) -> list[float]:
        nums = [float(w) for w in widths]
        total = sum(nums)
        if total <= 0:
            # Degenerate input — fall back to equal split.
            n = len(nums)
            return [round(100.0 / n, 2)] * n
        if abs(total - 100.0) <= 0.5:
            return nums
        return [round(w * 100.0 / total, 2) for w in nums]

    def _walk_block(blk: Any) -> None:
        if not isinstance(blk, dict):
            return
        t = blk.get("type")
        if t == "columns":
            cols = blk.get("columns") or []
            widths = blk.get("widths")
            if widths is not None:
                if not isinstance(widths, list) or len(widths) != len(cols):
                    raise ValidationFailed(
                        "columns.widths length must match columns.length",
                        details={
                            "columns_len": len(cols),
                            "widths_len": (
                                len(widths) if isinstance(widths, list) else None
                            ),
                        },
                    )
                blk["widths"] = _renorm(widths)
            for col in cols:
                if isinstance(col, list):
                    for child in col:
                        _walk_block(child)
        elif t == "tabs":
            for tab in blk.get("tabs") or []:
                for child in (tab or {}).get("blocks") or []:
                    _walk_block(child)
        elif t == "accordion":
            for item in blk.get("items") or []:
                for child in (item or {}).get("blocks") or []:
                    _walk_block(child)

    def _walk_section(sec: dict[str, Any]) -> None:
        for blk in sec.get("blocks") or []:
            _walk_block(blk)
        for sub in sec.get("subsections") or []:
            _walk_section(sub)

    for sec in content.get("sections") or []:
        if isinstance(sec, dict):
            _walk_section(sec)


def _normalise_table_cells(content: dict[str, Any]) -> None:
    """Walk every TableBlock cell and enforce the text-OR-blocks contract.

    The pydantic schema permits both fields to be present (or both absent)
    so it can stay backward-compatible; the runtime contract is stricter:
    each cell carries content via exactly one channel. Rules applied in place:
      * blocks non-empty ⇒ drop text (blocks win)
      * neither set      ⇒ text = "" (empty cell)
    """

    def _normalise_cell(cell: Any) -> None:
        if not isinstance(cell, dict):
            return
        blocks = cell.get("blocks")
        has_blocks = isinstance(blocks, list) and len(blocks) > 0
        if has_blocks:
            cell.pop("text", None)
            return
        if cell.get("text") is None:
            cell["text"] = ""

    def _walk_block(blk: Any) -> None:
        if not isinstance(blk, dict):
            return
        t = blk.get("type")
        if t == "table":
            for cell in blk.get("cells") or []:
                _normalise_cell(cell)
        elif t == "columns":
            for col in blk.get("columns") or []:
                if isinstance(col, list):
                    for child in col:
                        _walk_block(child)
        elif t == "tabs":
            for tab in blk.get("tabs") or []:
                for child in (tab or {}).get("blocks") or []:
                    _walk_block(child)
        elif t == "accordion":
            for item in blk.get("items") or []:
                for child in (item or {}).get("blocks") or []:
                    _walk_block(child)

    def _walk_section(sec: dict[str, Any]) -> None:
        for blk in sec.get("blocks") or []:
            _walk_block(blk)
        for sub in sec.get("subsections") or []:
            _walk_section(sub)

    for sec in content.get("sections") or []:
        if isinstance(sec, dict):
            _walk_section(sec)


def _assert_unique_ids(content: dict[str, Any]) -> None:
    """문서 전역에서 section id 와 block id (중첩 컨테이너 child 포함) 의 유일성을 강제.

    중복 id 는 get/update/delete/move_block 이 first-match 만 처리하게 만들어
    둘째 노드를 영영 도달 불가능한 orphan 으로 남긴다 (delete 1회는 생존자를,
    update 는 엉뚱한 노드를 건드림 — 데이터 무결성 결함). 섹션 outline 에는
    이미 dup 가드가 있었지만 블록 insert 경로엔 없어 조용히 통과되던 것을 막는다.
    write 경로(create/replace/patch)에서만 호출되므로 기존 문서 read 는 영향 없음.
    """
    seen: set[str] = set()

    def _check(node_id: Any) -> None:
        if not isinstance(node_id, str):
            return
        if node_id in seen:
            raise ValidationFailed(
                f"duplicate id in document: {node_id}",
                details={"id": node_id},
            )
        seen.add(node_id)

    def _walk_block(blk: Any) -> None:
        if not isinstance(blk, dict):
            return
        _check(blk.get("id"))
        t = blk.get("type")
        if t == "columns":
            for col in blk.get("columns") or []:
                if isinstance(col, list):
                    for child in col:
                        _walk_block(child)
        elif t == "tabs":
            for tab in blk.get("tabs") or []:
                for child in (tab or {}).get("blocks") or []:
                    _walk_block(child)
        elif t == "accordion":
            for item in blk.get("items") or []:
                for child in (item or {}).get("blocks") or []:
                    _walk_block(child)

    def _walk_section(sec: dict[str, Any]) -> None:
        _check(sec.get("id"))
        for blk in sec.get("blocks") or []:
            _walk_block(blk)
        for sub in sec.get("subsections") or []:
            if isinstance(sub, dict):
                _walk_section(sub)

    for sec in content.get("sections") or []:
        if isinstance(sec, dict):
            _walk_section(sec)


async def update_links_for_document(
    s: AsyncSession,
    *,
    doc_id: str,
    content_json: dict[str, Any],
) -> int:
    """links 테이블을 doc_id 기준으로 재구축. 같은 트랜잭션 내에서 실행.

    `[[alias]]` 가 approved term 의 aliases 에 들어 있으면 canonical term
    슬러그로 redirect 한 뒤 저장한다 (glossary-knowledge-graph § 8.4)."""
    extracted = extract_wiki_links(content_json)
    extracted = await resolve_term_aliases(s, extracted)
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


# ── Background-task debounce for refresh_search_view (M-large #1) ──────────
#
# 문제: replace_document → BackgroundTasks → refresh_search_view 가 동시 PUT
# 두 건에서 같은 시점에 발화하면 두 번째 CONCURRENTLY 가 "another refresh in
# progress" 로 실패 → plain REFRESH (AccessExclusiveLock) 폴백 → 동시 SELECT
# stall (대형 view 에서 10-30초).
#
# 해결: 5초 윈도우 안에 들어온 refresh 요청을 1개로 coalesce. 진행 중이면
# `_pending` 플래그만 set 하고 종료 — 진행 중인 작업이 끝날 때 _pending 이면
# 다시 한 번 실행하고 더는 누적 없이 종료. view 는 idempotent 이므로 안전.
_view_refresh_lock = asyncio.Lock()
_view_refresh_pending = False
_view_refresh_window_s = 5.0


async def refresh_search_view_debounced(
    s: AsyncSession,
    *,
    window_s: float | None = None,
) -> None:
    """`refresh_search_view` 를 5초 윈도우로 coalesce.

    여러 background task 가 동시에 refresh 를 요청해도 실제 REFRESH 는 *최대
    1개* 만 진행 + 끝난 직후 *최대 1번* 추가 실행 (그 사이 들어온 요청들을
    한 번에 흡수). CONCURRENT 충돌로 인한 plain 폴백 stall 제거.

    Args:
      s: AsyncSession (refresh_search_view 가 사용)
      window_s: 디바운스 윈도우 초 (기본 5초; 테스트에서 단축 가능)
    """
    global _view_refresh_pending
    win = window_s if window_s is not None else _view_refresh_window_s

    if _view_refresh_lock.locked():
        # 이미 진행 중 — 1회 추가 실행만 예약하고 즉시 리턴.
        _view_refresh_pending = True
        return

    async with _view_refresh_lock:
        await refresh_search_view(s)
        await asyncio.sleep(win)
        # 윈도우 동안 추가 요청이 쌓였으면 한 번 더만 실행 (cap=2).
        if _view_refresh_pending:
            _view_refresh_pending = False
            await refresh_search_view(s)


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

    # Cycle 0025 — fan out to automation rules. Best-effort, never raises.
    AUTO_KINDS = {
        "doc_published", "doc_archived", "review_decided",
        "status_transition", "comment_added", "tag_added",
    }
    if event_kind in AUTO_KINDS:
        try:
            from app.services import automation_dispatcher

            await automation_dispatcher.dispatch_event(event_kind, payload)
        except Exception as e:
            logger.warning("automation dispatch (%s) skipped: %s", event_kind, e)

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
            except Exception as e:
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


# ── H9: PUT 응답 경로에서 reindex/refresh/webhook 분리 ───────────────────
# replace_document 의 응답 latency 를 줄이기 위해 검색 인덱싱과 webhook
# 발송을 BackgroundTasks 로 후행 실행한다. 호출자(라우터)가 BackgroundTasks
# 를 전달하지 않으면 종전대로 동기 실행 (테스트/배치 경로 호환).
#
# 백그라운드에서 실행되는 함수는 요청 스코프의 AsyncSession 을 재사용할 수
# 없다 — 응답이 전송되면 dependency 가 close 한다. 따라서 새 session 을
# 직접 연다 (session_scope).
#
# Retry: 즉시 1회 재시도 + 1s backoff. background 라 silent 실패 위험을 줄임.

_RETRY_DELAY_SECONDS = 1.0


async def _run_with_retry(
    name: str,
    fn,  # type: ignore[no-untyped-def]
    *args,  # type: ignore[no-untyped-def]
    **kwargs,  # type: ignore[no-untyped-def]
) -> None:
    """fn 을 1회 호출, 실패 시 1초 후 1회 재시도 — silent 실패 로깅."""
    try:
        await fn(*args, **kwargs)
        return
    except Exception as e:
        logger.warning("[background] %s failed (attempt 1): %s — retrying", name, e)
    await asyncio.sleep(_RETRY_DELAY_SECONDS)
    try:
        await fn(*args, **kwargs)
    except Exception as e:
        logger.warning("[background] %s failed (attempt 2, giving up): %s", name, e)


async def run_post_save_hooks(
    *,
    doc_id: str,
    webhook_event: str | None,
    webhook_payload: dict[str, Any] | None,
    target_part_id: str | None = None,
    archived: bool = False,
    tag_added_events: list[dict[str, Any]] | None = None,
) -> None:
    """3 hook (refresh_search_view + reindex_meili + fire_webhook) 을 백그라운드
    에서 새 DB session 으로 실행. 각각 retry-1 로 silent 실패 위험 감소.

    응답이 이미 전송된 뒤 호출되므로 실패해도 write path 는 막지 않는다.
    """
    # 1) Meilisearch 색인 — 자체 session 필요 (요청 session 은 이미 닫힘)
    async def _reindex() -> None:
        async with session_scope() as s2:
            await reindex_meili(s2, doc_id=doc_id, archived=archived)

    # 2) materialized view refresh — 자체 session, CONCURRENTLY 시도.
    #    debounced wrapper 로 동시 PUT background task 간 CONCURRENT 충돌 회피
    #    (충돌 시 plain REFRESH 폴백이 AccessExclusiveLock 잡아 SELECT stall).
    async def _refresh() -> None:
        async with session_scope() as s2:
            await refresh_search_view_debounced(s2)

    # 3) webhook + automation + subscription fanout — session 무관
    async def _webhook() -> None:
        if webhook_event and webhook_payload:
            await fire_webhook(
                webhook_event, webhook_payload, target_part_id=target_part_id,
            )

    await _run_with_retry("reindex_meili", _reindex)
    await _run_with_retry("refresh_search_view", _refresh)
    await _run_with_retry("fire_webhook", _webhook)

    # tag_added events (replace_document 의 tag diff fanout)
    for ev in tag_added_events or []:
        await _run_with_retry(
            "fire_webhook[tag_added]",
            fire_webhook,
            "tag_added",
            ev,
        )


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
        # glossary-knowledge-graph (0048) 이후: terms.term UNIQUE 가 제거되고
        # (term, domain) WHERE domain IS NOT NULL UNIQUE 가 됨. 문서 본문에서
        # 자동 등록되는 용어는 status='approved', domain='general' 로 등록.
        await s.execute(
            text("""
                INSERT INTO terms
                    (term, definition, domain, status, related_docs)
                VALUES
                    (:t, :d, 'general', 'approved',
                     ARRAY[CAST(:doc AS uuid)])
                ON CONFLICT (term, domain) WHERE domain IS NOT NULL
                DO UPDATE SET
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


async def _fire_tag_added_events(
    *,
    doc_id: str,
    slug: str,
    actor_id: str | None,
    before: list[str],
    after: list[str],
) -> None:
    """Fire one `tag_added` event per net-new tag (Cycle 0025).

    Idempotent: tags already present in `before` are skipped.
    """
    before_set = set(before or [])
    for t in after or []:
        if t in before_set:
            continue
        await fire_webhook(
            "tag_added",
            {
                "event": "tag_added",
                "document_id": doc_id,
                "slug": slug,
                "tag": t,
                "actor_user_id": actor_id,
            },
        )


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
    background_tasks: BackgroundTasks | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    # H9: 응답 latency 단축 — background_tasks 가 주어지면 reindex/refresh/
    # webhook 을 응답 후 백그라운드에서 실행. 트랜잭션 일관성이 필요한
    # update_links_for_document 는 응답 경로 유지.
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

    # Capture before-tags for `tag_added` automation trigger (Cycle 0025).
    _before_tags = _extract_tag_names(existing.get("content_json") or {})

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

    # 응답 latency 에 직접 영향을 주지 않도록, doc 메타만 짚어서 webhook payload
    # 를 미리 빌드. get_document_or_404 는 동기 경로에 남겨서 응답 본문이
    # 최신 row 를 반환하도록 한다 (FE 가 ETag/version 의존).
    doc = await get_document_or_404(s, slug)
    after_tags = _extract_tag_names(validated)
    tag_events = [
        {
            "event": "tag_added",
            "document_id": doc["id"],
            "slug": doc["slug"],
            "tag": t,
            "actor_user_id": actor_id,
        }
        for t in after_tags
        if t not in set(_before_tags or [])
    ]
    webhook_payload = {
        "event": "doc_edited",
        "document_id": doc["id"],
        "slug": doc["slug"],
        "title": doc["title"],
        "version": doc["version"],
        "actor_user_id": actor_id,
        "change_log": log,
    }

    if background_tasks is not None:
        # H9: 응답 후 백그라운드에서 reindex + refresh + webhook 실행
        background_tasks.add_task(
            run_post_save_hooks,
            doc_id=doc["id"],
            webhook_event="doc_edited",
            webhook_payload=webhook_payload,
            target_part_id=part_id,
            archived=False,
            tag_added_events=tag_events,
        )
    else:
        # 호환: BackgroundTasks 가 없으면 종전대로 동기 실행 (테스트/배치)
        await refresh_search_view(s)
        await reindex_meili(s, doc_id=existing["id"])
        await fire_webhook("doc_edited", webhook_payload, target_part_id=part_id)
        await _fire_tag_added_events(
            doc_id=doc["id"], slug=doc["slug"], actor_id=actor_id,
            before=_before_tags, after=after_tags,
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

    # Capture before-tags for `tag_added` automation trigger (Cycle 0025).
    _before_tags = _extract_tag_names(existing.get("content_json") or {})

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
    await _fire_tag_added_events(
        doc_id=fresh["id"], slug=fresh["slug"], actor_id=actor_id,
        before=_before_tags, after=_extract_tag_names(validated),
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
    sec, _parent_list, _idx, parent_level = found

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
    # `layout` is the visual template choice (stack / two-col / image-left
    # / image-right / title-only / full-bleed). `null` clears the field
    # back to the implicit default ('stack') so the JSON stays minimal.
    if "layout" in patch:
        if patch["layout"] is None:
            sec.pop("layout", None)
        else:
            sec["layout"] = patch["layout"]

    # layoutWidths — per-pane percentages for two-pane layouts. Drop the
    # field if cleared or if layout is reset to a non-two-pane mode so
    # the JSON stays minimal.
    if "layoutWidths" in patch:
        widths = patch["layoutWidths"]
        if widths is None:
            sec.pop("layoutWidths", None)
        elif isinstance(widths, list) and len(widths) == 2:
            sec["layoutWidths"] = [float(w) for w in widths]
    # Auto-clear when layout switches to one that doesn't use it.
    cur_layout = sec.get("layout")
    if cur_layout in (None, "stack", "title-only", "full-bleed"):
        sec.pop("layoutWidths", None)

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
    """Block PATCH (RFC 5789-style merge).

    Accepts a partial body (e.g. ``{caption: 'new'}``) and merges it into
    the existing block. ``id`` and ``type`` may be omitted — the URL's
    ``block_id`` and the existing block's ``type`` are used. If either is
    sent it must match (we don't allow id rewrites or type changes through
    PATCH; use insert+delete for that).

    Earlier behaviour was full-replace, which forced every FE call site to
    re-send the entire block and made tiny edits (caption / alt / width)
    return 422 because the FE only ships the changed fields.
    """
    if not isinstance(new_block, dict):
        raise ValidationFailed("block payload must be an object")
    body_id = new_block.get("id")
    if body_id is not None and body_id != block_id:
        raise ValidationFailed(
            "block id in URL must match body.id",
            details={"url_id": block_id, "body_id": body_id},
        )

    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    found = _find_block(content, block_id)
    if not found:
        raise NotFound(f"block not found: {block_id}")
    current_block, parent_list, idx, _owner = found

    body_type = new_block.get("type")
    if body_type is not None and body_type != current_block.get("type"):
        # type-change request → full replace (the legacy "block 통째 교체"
        # behaviour). Caller must supply a complete block body; downstream
        # `validate_documentjson` enforces the per-type schema.
        replacement = {**new_block, "id": block_id}
        parent_list[idx] = replacement
    else:
        # Same type (or omitted) → RFC 5789-style merge of the partial body
        # into the existing block. Lets the FE ship `{caption: 'new'}` etc.
        merged = {**current_block, **new_block}
        merged["id"] = block_id
        merged["type"] = current_block.get("type")
        parent_list[idx] = merged

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
    index: int | None = None,
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

    if after_block_id is not None:
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
    elif isinstance(index, int) and 0 <= index <= len(blocks):
        # FE contract — `index` is the slot to insert *at* (0..N). -1 ⇒ append
        # (handled by the next branch). The slash-menu and dropzone send this.
        blocks.insert(index, new_block)
    else:
        blocks.append(new_block)

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
    to_index: int | None = None,
) -> dict[str, Any]:
    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    src = _find_block(content, block_id)
    if not src:
        raise NotFound(f"block not found: {block_id}")
    _blk_obj, src_parent, src_idx, _ = src
    # remove from source
    moved = src_parent.pop(src_idx)

    tgt = _find_section(content, target_section_id)
    if not tgt:
        raise NotFound(f"target section not found: {target_section_id}")
    tgt_blocks: list[dict[str, Any]] = tgt[0].setdefault("blocks", [])
    if after_block_id is not None:
        target_idx = next(
            (i for i, b in enumerate(tgt_blocks) if isinstance(b, dict) and b.get("id") == after_block_id),
            None,
        )
        if target_idx is None:
            raise NotFound(
                f"after_block_id not found in target section.blocks: {after_block_id}"
            )
        tgt_blocks.insert(target_idx + 1, moved)
    elif isinstance(to_index, int) and 0 <= to_index <= len(tgt_blocks):
        # FE contract — `to_index` is the slot to land at within the target
        # section. The BlockToolbar ↑/↓ buttons send this. Out-of-range falls
        # through to the append branch.
        tgt_blocks.insert(to_index, moved)
    else:
        tgt_blocks.append(moved)

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
    """Rebuild the section tree from the FE-supplied `outline`.

    * Honours the same `MAX_DEPTH` cap that `renumber_sections` uses.
    * When an outline entry references an `id` that doesn't exist in
      the current document, we treat it as a *new* section with empty
      blocks. This lets the FE's "+ 하위 / + 섹션" buttons round-trip
      through this single endpoint instead of having to create the
      section ahead of time.
    """
    if seen is None:
        seen = set()
    if depth > section_numbering.MAX_DEPTH and outline:
        raise ValidationFailed(
            f"section depth exceeds limit (max={section_numbering.MAX_DEPTH})",
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
        # Recurse into children regardless — the depth check above will
        # catch absurd nesting.
        children_refs = ref.get("children") or []
        new_subs = _build_reordered_sections(children_refs, index, depth + 1, seen)
        if original is None:
            # New section emitted by the FE in the same payload as a
            # reorder. Title comes from the outline; blocks start empty.
            new_sec = {
                "id": sid,
                "level": depth,
                "title": str(ref.get("title") or "새 섹션"),
                "blocks": [],
                "subsections": new_subs,
            }
        else:
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


async def patch_title(
    s: AsyncSession,
    *,
    slug: str,
    title: str,
    summary: str | None = None,
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
    update_summary: bool = False,
) -> dict[str, Any]:
    """문서 title (그리고 옵션으로 summary) 만 갱신한다.

    `update_summary=True` 일 때 summary 도 함께 갱신. 빈 문자열은 summary 필드를 제거.
    """
    if not isinstance(title, str):
        raise ValidationFailed("title must be a string")
    title = title.strip()
    if not title:
        raise ValidationFailed("title must not be empty")
    if len(title) > 200:
        raise ValidationFailed("title too long (max 200)")

    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    content["title"] = title
    if update_summary:
        if summary is None or (isinstance(summary, str) and not summary.strip()):
            content.pop("summary", None)
        else:
            s_text = str(summary).strip()
            if len(s_text) > 500:
                raise ValidationFailed("summary too long (max 500)")
            content["summary"] = s_text

    log = normalize_change_log(change_log, default="title.patch")
    return await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.title.patch",
        target_suffix="#title",
    )


async def patch_infobox(
    s: AsyncSession,
    *,
    slug: str,
    infobox: dict[str, Any],
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> dict[str, Any]:
    """문서의 `infobox` 맵을 통째로 교체.

    Schema: `additionalProperties: string | string[] | null` 같은 자유로운
    key/value. 빈 문자열 / 빈 배열 / None 은 제거해서 잡 데이터가 누적되지
    않게 한다.
    """
    if not isinstance(infobox, dict):
        raise ValidationFailed("infobox payload must be an object")
    cleaned: dict[str, Any] = {}
    for k, v in infobox.items():
        if not isinstance(k, str) or not k:
            continue
        if v is None:
            continue
        if isinstance(v, list):
            arr = [str(item) for item in v if item is not None and str(item).strip()]
            if arr:
                cleaned[k] = arr
            continue
        if isinstance(v, (str, int, float, bool)):
            text = str(v).strip()
            if text:
                cleaned[k] = text
            continue
        raise ValidationFailed(
            "infobox values must be string or string list",
            details={"key": k, "value_type": type(v).__name__},
        )

    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    if cleaned:
        content["infobox"] = cleaned
    else:
        content.pop("infobox", None)

    log = normalize_change_log(change_log, default="infobox.patch")
    return await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.infobox.patch",
        target_suffix="#infobox",
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


async def patch_custom_css(
    s: AsyncSession,
    *,
    slug: str,
    raw_css: str | None,
    if_match: str | None,
    actor_id: str,
    change_log: str | None = None,
) -> tuple[dict[str, Any], str, list[str]]:
    """문서의 ``custom_css`` 필드를 sanitize 후 교체.

    Cycle 18 — admin-only branding CSS. 빈 문자열/None 이면 필드를 제거한다.
    Sanitizer 가 ``<script>`` / ``expression()`` / ``url(javascript:)`` 등을
    제거하며, 잘려나간 패턴 라벨을 warnings 로 반환해 호출자가 UI 에 노출할
    수 있게 한다.

    Returns:
        (persisted_document_row, sanitized_css, warnings)
    """
    from app.services.css_sanitizer import MAX_CUSTOM_CSS_LEN, sanitize_css

    if raw_css is not None and not isinstance(raw_css, str):
        raise ValidationFailed("custom_css must be a string")
    if isinstance(raw_css, str) and len(raw_css) > MAX_CUSTOM_CSS_LEN:
        raise ValidationFailed(
            f"custom_css exceeds {MAX_CUSTOM_CSS_LEN} chars",
            details={"length": len(raw_css), "max": MAX_CUSTOM_CSS_LEN},
        )

    safe_css, warnings = sanitize_css(raw_css)

    existing = await get_document_or_404(s, slug)
    _check_etag(existing, if_match)

    content = copy.deepcopy(existing["content_json"])
    if safe_css:
        content["custom_css"] = safe_css
    else:
        content.pop("custom_css", None)

    log = normalize_change_log(change_log, default="custom_css.patch")
    persisted = await _persist_content_change(
        s,
        existing=existing,
        new_content=content,
        actor_id=actor_id,
        change_log=log,
        action="document.custom_css.patch",
        target_suffix="#custom_css",
    )
    return persisted, safe_css, warnings


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
