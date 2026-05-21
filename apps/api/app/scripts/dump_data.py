"""Dump content tables to JSONL + manifest (for cross-server merge).

Output: a directory (default /tmp/mxwp-data-dump/) with:
  manifest.json       — { dumped_at, source_host, counts: {docs, tags, ...} }
  documents.jsonl     — one doc per line (id, slug, title, status, content_json, ...)
  tags.jsonl
  document_tags.jsonl
  divisions.jsonl, teams.jsonl, groups.jsonl, parts.jsonl

Excluded: users, sessions, api_tokens, audit_logs, backup_*.

Usage:
  apptainer exec instance://mxwp_api /bin/sh -c \\
    'cd /workspace/apps/api && python -m app.scripts.dump_data --out /tmp/dump'
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlalchemy import text

# ── env loader (same pattern as refresh_links) ──────────────────────────────
for _candidate in (
    Path("/workspace/.env"),
    Path(__file__).resolve().parents[3] / ".env",
):
    if _candidate.exists():
        for _line in _candidate.read_text(encoding="utf-8").splitlines():
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _, _v = _line.partition("=")
            _k = _k.strip()
            _v = _v.strip()
            if _v.startswith(('"', "'")):
                _q = _v[0]
                _end = _v.find(_q, 1)
                _v = _v[1:_end] if _end != -1 else _v[1:]
            else:
                _hp = _v.find(" #")
                if _hp != -1:
                    _v = _v[:_hp]
                _v = _v.strip()
            os.environ.setdefault(_k, _v)

from app.core.db import session_scope  # noqa: E402


# ── serialiser ──────────────────────────────────────────────────────────────

def _default(obj: Any) -> Any:
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, (datetime, date)):
        if isinstance(obj, datetime) and obj.tzinfo is None:
            obj = obj.replace(tzinfo=timezone.utc)
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serialisable")


def _row_to_jsonl(row: Any) -> str:
    return json.dumps(dict(row._mapping), default=_default, ensure_ascii=False)


# ── per-table queries ────────────────────────────────────────────────────────

QUERIES: list[tuple[str, str]] = [
    # 일부 조직/태그 테이블은 created_at 컬럼이 없음 — 실제 스키마에 맞춰 ORDER BY id.
    (
        "divisions",
        "SELECT id, slug, name, description FROM divisions ORDER BY id",
    ),
    (
        "teams",
        "SELECT id, division_id, slug, name, lead_user_id FROM teams ORDER BY id",
    ),
    (
        "groups",
        "SELECT id, team_id, slug, name FROM groups ORDER BY id",
    ),
    (
        "parts",
        "SELECT id, group_id, slug, name FROM parts ORDER BY id",
    ),
    (
        "tags",
        "SELECT id, name FROM tags ORDER BY name",
    ),
    (
        "documents",
        """SELECT id, slug, part_id, title, summary, status,
                  content_json, schema_ver, version, owner_id,
                  created_at, updated_at, indegree
           FROM documents
           ORDER BY created_at""",
    ),
    (
        "document_tags",
        "SELECT document_id, tag_id FROM document_tags",
    ),
]


async def _dump_table(s: Any, name: str, query: str, out_dir: Path) -> int:
    """Fetch rows to <name>.jsonl. Returns row count."""
    out_path = out_dir / f"{name}.jsonl"
    result = await s.execute(text(query))
    rows = result.all()
    with out_path.open("w", encoding="utf-8") as fh:
        for i, row in enumerate(rows):
            fh.write(_row_to_jsonl(row))
            fh.write("\n")
            if (i + 1) % 1000 == 0:
                print(f"  {name}: {i + 1} rows written…")
    return len(rows)


async def _run(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    counts: dict[str, int] = {}
    async with session_scope() as s:
        for table_name, query in QUERIES:
            print(f"→ dumping {table_name}")
            n = await _dump_table(s, table_name, query, out_dir)
            counts[table_name] = n
            print(f"  ✓ {table_name}: {n} rows")

    # manifest
    dumped_at = datetime.now(tz=timezone.utc).isoformat()
    manifest = {
        "dump_version": "1",
        "dumped_at": dumped_at,
        "source_host": socket.gethostname(),
        "counts": counts,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print("\n✓ dump complete")
    for k, v in counts.items():
        print(f"  {k:<20}: {v}")
    print(f"  → {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Dump MX Whitepaper content tables to JSONL")
    parser.add_argument(
        "--out",
        default="/tmp/mxwp-data-dump",
        help="Output directory (default: /tmp/mxwp-data-dump)",
    )
    args = parser.parse_args()
    asyncio.run(_run(Path(args.out)))


if __name__ == "__main__":
    main()
