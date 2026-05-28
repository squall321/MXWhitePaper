#!/usr/bin/env python3
"""MXWhitePaper → AX Hub (Mobile eXperience AI Data Hub) 동기화 어댑터.

사용:
    python aidatahub_sync.py --mode=push-all --config=config.yml
    python aidatahub_sync.py --mode=push-recent --since-minutes=35 --config=config.yml
    python aidatahub_sync.py --help

DocumentJSON v1.0 → AX Hub record 변환:
    - sections (트리) → DFS 평탄화 + blocks markdown 직렬화 → content.sections[]
    - images (MinIO URL) → record_attachments (url_ref or download_upload)
    - 메타: document_id → _external_id, status/version/etag 등 매핑

본 어댑터는 표준 라이브러리 + httpx + pyyaml 만 사용.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml

logger = logging.getLogger("aidatahub_sync")


# ===========================================================================
# DocumentJSON → record 변환
# ===========================================================================
def _parse_year(iso: str | None) -> int:
    if not iso:
        return datetime.now().year
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).year
    except Exception:
        return datetime.now().year


def _parse_date(iso: str | None) -> str | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).date().isoformat()
    except Exception:
        return None


def _classify_doc_type(doc: dict[str, Any]) -> str:
    """tags / keywords / category 보고 doc_type 선택."""
    cat_hint = (doc.get("category") or "").lower()
    tags = [t.lower() for t in (doc.get("tags") or [])]
    if any("feasibility" in t for t in tags) or "feasibility" in cat_hint:
        return "feasibility_study"
    return "whitepaper"


def _collect_tags(doc: dict[str, Any]) -> list[str]:
    tags: list[str] = []
    tags.extend(doc.get("tags") or [])
    for a in (doc.get("authors") or []):
        tags.append(f"author:{a}")
    if doc.get("status"):
        tags.append(f"status:{doc['status']}")
    if doc.get("category"):
        tags.append(f"category:{doc['category']}")
    seen: set[str] = set()
    return [t for t in tags if not (t in seen or seen.add(t))][:30]


def _render_table(block: dict[str, Any]) -> str:
    rows = block.get("rows") or []
    if not rows:
        return ""
    header = rows[0]
    body_rows = rows[1:]
    out = ["| " + " | ".join(str(c) for c in header) + " |"]
    out.append("|" + " --- |" * len(header))
    for r in body_rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(out)


def _render_blocks(blocks: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for b in blocks or []:
        bt = b.get("type")
        if bt == "paragraph":
            parts.append(b.get("text") or "")
        elif bt == "heading":
            level = max(1, min(6, int(b.get("level", 1))))
            parts.append(f"{'#' * level} {b.get('text', '')}")
        elif bt == "list":
            ordered = bool(b.get("ordered"))
            items = b.get("items") or []
            lines = []
            for i, it in enumerate(items, start=1):
                prefix = f"{i}. " if ordered else "- "
                lines.append(f"{prefix}{it}")
            parts.append("\n".join(lines))
        elif bt == "table":
            parts.append(_render_table(b))
        elif bt == "code":
            lang = b.get("lang", "")
            parts.append(f"```{lang}\n{b.get('code', '')}\n```")
        elif bt == "math":
            parts.append(f"$$\n{b.get('tex', '')}\n$$")
        elif bt == "quote":
            parts.append(f"> {b.get('text', '')}")
        elif bt == "callout":
            kind = b.get("kind", "note")
            parts.append(f"**[{kind}]** {b.get('text', '')}")
        elif bt in ("image-attachment", "image"):
            alt = b.get("alt") or ""
            url = b.get("url") or f"attachment://{b.get('image_id', '?')}"
            parts.append(f"![{alt}]({url})")
        elif bt == "raw_html":
            # strip tags 단순화
            text = re.sub(r"<[^>]+>", "", b.get("html", ""))
            parts.append(text)
        else:
            # 알 수 없는 type 은 무시 + warn
            txt = b.get("text") or json.dumps(b, ensure_ascii=False)[:200]
            parts.append(txt)
    return "\n\n".join(p for p in parts if p)


def _collect_image_ids(blocks: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for b in blocks or []:
        if b.get("type") in ("image-attachment", "image"):
            iid = b.get("image_id") or b.get("url")
            if iid:
                out.append(str(iid))
    return out


def flatten_sections(
    sections: list[dict[str, Any]], parent_path: str = ""
) -> list[dict[str, Any]]:
    """sections 트리 → 평탄 리스트 (DFS)."""
    out: list[dict[str, Any]] = []
    for s in sections or []:
        sid = str(s.get("number") or s.get("id") or s.get("section_id") or len(out) + 1)
        out.append({
            "section_id": sid,
            "level": int(s.get("level") or 1),
            "title": s.get("title") or "",
            "content_text": _render_blocks(s.get("blocks") or []),
            "figure_refs": _collect_image_ids(s.get("blocks") or []),
            "table_refs": [],
        })
        if s.get("children"):
            out.extend(flatten_sections(s["children"], parent_path=sid))
    return out


def doc_to_record(doc: dict[str, Any]) -> dict[str, Any]:
    sections_flat = flatten_sections(doc.get("sections") or [])
    return {
        "_external_id": str(doc.get("document_id") or doc.get("id") or ""),
        "data_type": "DOC",
        "team": "MX",
        "group": "WP",
        "year": _parse_year(doc.get("created_at")),
        "title": doc.get("title") or "[untitled]",
        "summary": doc.get("summary") or "",
        "doc_type": _classify_doc_type(doc),
        "tags": _collect_tags(doc),
        "agents": ["mx-whitepaper-analyst"],
        "classification": "internal",
        "language": doc.get("lang") or "ko",
        "author": "mxwp",
        "department": "MX/WP",
        "valid_from": _parse_date(doc.get("created_at")),
        "subject_keywords": doc.get("keywords") or [],
        "version": doc.get("version") or "1.0",
        "content": {"sections": sections_flat},
    }


# ===========================================================================
# MXWP API fetch
# ===========================================================================
async def fetch_document_list(
    client: httpx.AsyncClient,
    *,
    base_url: str,
    api_key: str,
    status_filter: str = "published",   # MXWP 는 자동 published — 보낼 필요 없음
    updated_since: datetime | None = None,   # MXWP 는 server-side 미지원 — client-side 필터
    offset: int = 0,                     # Sprint 3 — limit/offset 페이지네이션
    limit: int = 100,                    # MXWP max 100 per page
) -> dict[str, Any]:
    """`GET /api/v1/documents?limit=...&offset=...` — limit/offset 페이지네이션.

    Sprint 3 에서 offset 추가됨. 응답 meta.next_offset 이 다음 offset 제공.

    응답 envelope: {data: [...], meta: {count, limit, offset, next_offset}}.
    """
    params: dict[str, Any] = {
        "limit": min(int(limit), 100),
        "offset": max(0, int(offset)),
    }
    headers = {"X-API-Key": api_key} if api_key else {}
    resp = await client.get(
        f"{base_url.rstrip('/')}/api/v1/documents",
        params=params, headers=headers, timeout=30.0,
    )
    resp.raise_for_status()
    body = resp.json()
    if isinstance(body, dict) and "data" in body:
        meta = body.get("meta") or {}
        return {
            "items": body.get("data") or [],
            "next_offset": meta.get("next_offset"),
        }
    return body


async def fetch_document_detail(
    client: httpx.AsyncClient,
    *, base_url: str, api_key: str, slug: str,
) -> dict[str, Any]:
    """`GET /api/v1/documents/{slug}` — 단건 전체 (sections 포함).

    응답 envelope: {"data": {id, slug, title, summary, status, version, ...,
                              content: {...DocumentJSON...}}, "meta": {"etag"}}.
    """
    headers = {"X-API-Key": api_key} if api_key else {}
    resp = await client.get(
        f"{base_url.rstrip('/')}/api/v1/documents/{slug}",
        headers=headers, timeout=30.0,
    )
    resp.raise_for_status()
    body = resp.json()
    # envelope 풀기
    if isinstance(body, dict) and "data" in body:
        d = body["data"]
        # ETag 보존
        meta = body.get("meta") or {}
        if "etag" in meta:
            d["etag"] = meta["etag"]
        # content.sections 를 doc.sections 로 평탄화 (호환성)
        content = d.get("content") or {}
        if "sections" in content and "sections" not in d:
            d["sections"] = content["sections"]
        # MXWP 의 document_id = id 또는 doc["id"] (UUID)
        if "document_id" not in d and "id" in d:
            d["document_id"] = d["id"]
        return d
    return body


async def fetch_all_documents(
    *, base_url: str, api_key: str,
    updated_since: datetime | None = None,
    page_size: int = 100,
    max_rps: float = 2.0,
    status_filter: str = "published",
    max_pages: int = 200,   # 안전 한도 — 20,000 건
) -> list[dict[str, Any]]:
    """offset 페이지네이션 + detail 보강 — 모든 published 문서 수집.

    Sprint 3 limit/offset 페이지네이션을 사용. 응답 meta.next_offset 이 None
    이 될 때까지 반복. ``updated_since`` 는 MXWP server-side 미지원이므로
    client-side 에서 ``updated_at >= updated_since`` 인 것만 detail 가져와 push
    (목록 조회는 모두 받지만 detail 호출은 변경된 것만 — 비용 절감).
    """
    docs: list[dict[str, Any]] = []
    offset = 0
    interval = 1.0 / max(0.1, max_rps)
    pages = 0
    skipped_old = 0

    async with httpx.AsyncClient() as client:
        while pages < max_pages:
            page = await fetch_document_list(
                client, base_url=base_url, api_key=api_key,
                status_filter=status_filter,
                updated_since=None,   # 서버는 무시 — client-side 만
                offset=offset, limit=page_size,
            )
            pages += 1
            items = page.get("items") or []
            if not items:
                break
            for meta in items:
                if updated_since and meta.get("updated_at"):
                    try:
                        uat = datetime.fromisoformat(
                            meta["updated_at"].replace("Z", "+00:00")
                        )
                        if uat < updated_since:
                            skipped_old += 1
                            continue
                    except Exception:
                        pass
                slug = meta.get("slug") or meta.get("document_id") or meta.get("id")
                if not slug:
                    continue
                try:
                    detail = await fetch_document_detail(
                        client, base_url=base_url, api_key=api_key, slug=slug,
                    )
                    merged = {**meta, **detail}
                    docs.append(merged)
                except httpx.HTTPError as exc:
                    logger.warning("detail fetch failed slug=%s: %s", slug, exc)
                await asyncio.sleep(interval)

            # 다음 페이지 결정 — next_offset 있으면 그걸로, 없으면 종료
            next_offset = page.get("next_offset")
            if next_offset is None:
                break
            offset = int(next_offset)

    logger.info(
        "fetched %s documents (pages=%s, skipped_old=%s)",
        len(docs), pages, skipped_old,
    )
    return docs


# ===========================================================================
# AX Hub push
# ===========================================================================
async def push_to_aidh(
    records: list[dict[str, Any]],
    *,
    aidh_base_url: str,
    aidh_api_key: str,
    batch_size: int = 50,
    dry_run: bool = False,
) -> dict[str, Any]:
    ok = failed = batches = 0
    dead_letter: list[dict[str, Any]] = []
    headers = {"X-API-Key": aidh_api_key, "Content-Type": "application/json"}
    url = f"{aidh_base_url.rstrip('/')}/api/records/import"
    params = {
        "auto_seq": "true",
        "external_source": "mxwp",
        "dry_run": "true" if dry_run else "false",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        for i in range(0, len(records), batch_size):
            batch = records[i: i + batch_size]
            payload = {
                "auto_seq": True,
                "external_source": "mxwp",
                "records": batch,
            }
            try:
                resp = await client.post(url, params=params, headers=headers, json=payload)
                resp.raise_for_status()
                body = resp.json()
                batches += 1
                ok += body.get("ok", 0)
                failed += body.get("failed", 0)
                for row in body.get("results", []):
                    if row.get("error"):
                        dead_letter.append(row)
                logger.info(
                    "batch %s count=%s ok=%s failed=%s",
                    batches, len(batch), body.get("ok", 0), body.get("failed", 0),
                )
            except httpx.HTTPError as exc:
                logger.exception("batch failed: %s", exc)
                failed += len(batch)
                dead_letter.append({"error": f"batch http: {exc}", "batch_size": len(batch)})

    return {"ok": ok, "failed": failed, "batches": batches, "dead_letter": dead_letter}


# ===========================================================================
# CLI
# ===========================================================================
def _load_config(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        logger.error("config not found: %s", p)
        sys.exit(2)
    body = p.read_text(encoding="utf-8")
    body = re.sub(
        r"\$\{([A-Z_][A-Z0-9_]*)\}",
        lambda m: os.environ.get(m.group(1), ""),
        body,
    )
    return yaml.safe_load(body) or {}


async def run(args: argparse.Namespace) -> int:
    cfg = _load_config(args.config)
    aidh = cfg.get("aidatahub") or {}
    mxwp = cfg.get("mxwp") or {}
    sync_cfg = cfg.get("sync") or {}

    aidh_url = args.aidh_url or aidh.get("base_url")
    aidh_key = args.aidh_key or aidh.get("api_key") or ""
    if not aidh_url:
        logger.error("aidh base_url missing")
        return 2

    mxwp_url = mxwp.get("base_url")
    mxwp_key = mxwp.get("api_key") or ""
    if not mxwp_url:
        logger.error("mxwp base_url missing")
        return 2

    updated_since: datetime | None = None
    if args.mode == "push-recent":
        if args.since:
            updated_since = datetime.fromisoformat(args.since.replace("Z", "+00:00"))
        else:
            updated_since = datetime.now(timezone.utc) - timedelta(minutes=int(args.since_minutes))

    logger.info(
        "fetching documents: url=%s since=%s status=%s",
        mxwp_url, updated_since, mxwp.get("filter", {}).get("status", "published"),
    )

    docs = await fetch_all_documents(
        base_url=mxwp_url,
        api_key=mxwp_key,
        updated_since=updated_since,
        page_size=sync_cfg.get("page_size", 50),
        max_rps=sync_cfg.get("max_rps", 2.0),
        status_filter=mxwp.get("filter", {}).get("status", "published"),
    )

    logger.info("fetched %s documents", len(docs))
    if not docs:
        return 0

    records = [doc_to_record(d) for d in docs]
    logger.info("transformed %s records", len(records))

    summary = await push_to_aidh(
        records,
        aidh_base_url=aidh_url,
        aidh_api_key=aidh_key,
        batch_size=sync_cfg.get("batch_size", 50),
        dry_run=args.dry_run,
    )
    logger.info(
        "push complete: ok=%s failed=%s batches=%s dead_letter=%s",
        summary["ok"], summary["failed"], summary["batches"], len(summary["dead_letter"]),
    )

    if summary["dead_letter"]:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dump_path = Path(f"dead_letter_{ts}.json")
        dump_path.write_text(
            json.dumps(summary["dead_letter"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.warning("dead_letter dumped: %s", dump_path)

    return 0 if summary["failed"] == 0 else 1


def main() -> None:
    ap = argparse.ArgumentParser(
        description="MXWhitePaper → AX Hub 동기화 어댑터"
    )
    ap.add_argument(
        "--mode", choices=["push-all", "push-recent"], default="push-recent"
    )
    ap.add_argument("--config", default="config.yml")
    ap.add_argument("--since", default=None, help="ISO 8601")
    ap.add_argument("--since-minutes", type=int, default=35)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--aidh-url", default=None)
    ap.add_argument("--aidh-key", default=None)
    ap.add_argument(
        "--log-level", default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
    )
    args = ap.parse_args()

    logging.basicConfig(
        level=args.log_level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    sys.exit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
