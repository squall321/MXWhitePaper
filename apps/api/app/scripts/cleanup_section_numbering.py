"""Strip leading-number prefixes from existing section titles.

Usage:
    python -m app.scripts.cleanup_section_numbering            # dry-run (default)
    python -m app.scripts.cleanup_section_numbering --apply    # write changes
    python -m app.scripts.cleanup_section_numbering --slug=foo # one doc only

Background
----------
`docx_import._strip_leading_numbering` was added late in the project
lifecycle: any document imported before that patch landed has section
titles like "1.1 Background" / "37. database" still in storage, which
then get visually doubled by the renderer ("1.1 1.1 Background") because
the BE separately renumbers every section as a dotted ordinal at save
time.

This script walks every persisted document, applies the stripping
function in place, and re-pushes the affected docs through the normal
PUT-document pipeline so the section number recomputation + Meili
reindex stay in sync.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any

from sqlalchemy import text

from app.core.db import session_scope
from app.services.document_service import reindex_meili
from app.services.docx_import import _strip_leading_numbering


def _strip_section_titles(section: dict[str, Any]) -> int:
    """Recursively strip number prefixes from this section + descendants.
    Returns the number of titles changed."""
    changed = 0
    if isinstance(section.get("title"), str):
        old = section["title"]
        new = _strip_leading_numbering(old) or old
        if new != old:
            section["title"] = new
            changed += 1
    for sub in section.get("subsections") or []:
        if isinstance(sub, dict):
            changed += _strip_section_titles(sub)
    return changed


async def _walk_docs(apply: bool, slug_filter: str | None) -> dict[str, int]:
    """Returns {slug: titles_changed} for every affected doc."""
    summary: dict[str, int] = {}
    async with session_scope() as s:
        where = ""
        params: dict[str, Any] = {}
        if slug_filter:
            where = " WHERE slug = :slug"
            params["slug"] = slug_filter
        rows = (await s.execute(
            text(f"SELECT id::text, slug, content_json FROM documents{where}"),
            params,
        )).all()

        for row in rows:
            doc_id, slug, content = row[0], row[1], row[2]
            if not isinstance(content, dict):
                continue
            sections = content.get("sections") or []
            total = 0
            for sec in sections:
                if isinstance(sec, dict):
                    total += _strip_section_titles(sec)
            if total == 0:
                continue
            summary[slug] = total
            if apply:
                await s.execute(
                    text(
                        "UPDATE documents SET content_json = :c, "
                        "updated_at = NOW(), version = version + 1 "
                        "WHERE id = CAST(:id AS uuid)"
                    ),
                    {"c": _to_jsonb(content), "id": doc_id},
                )
                await reindex_meili(s, doc_id=doc_id)
        if apply:
            await s.commit()
    return summary


def _to_jsonb(obj: dict[str, Any]) -> str:
    import json
    return json.dumps(obj, ensure_ascii=False)


async def _amain() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    parser.add_argument("--slug", help="limit to a single document slug")
    args = parser.parse_args()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] scanning sections for leading numbering…")
    summary = await _walk_docs(apply=args.apply, slug_filter=args.slug)
    if not summary:
        print("✓ no documents needed cleanup")
        return 0

    print(f"\n{len(summary)} document(s) had titles needing cleanup:")
    total_titles = 0
    for slug, count in sorted(summary.items(), key=lambda kv: -kv[1]):
        print(f"  {count:>4} titles  {slug}")
        total_titles += count
    print(f"\ntotal titles changed: {total_titles}")

    if not args.apply:
        print("\n(dry-run only — re-run with --apply to write changes)")
    else:
        print("\n✓ committed + Meili reindexed")
    return 0


def main() -> int:
    return asyncio.run(_amain())


if __name__ == "__main__":
    sys.exit(main())
