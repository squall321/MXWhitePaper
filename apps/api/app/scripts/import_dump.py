"""Merge JSONL dump (from dump_data.py) into the local DB — additive only.

Conflict policies:
  --on-conflict=skip       (default) — keep existing row unchanged
  --on-conflict=overwrite  — source row replaces title/summary/content_json/status

Other flags:
  --dry-run                — count only, no DB writes
  --no-tags                — skip tags + document_tags tables
  --owner-email=<email>    — assign all new docs to this user (looked up locally).
                             default: first user with role='admin'.
  --dir=<path>             — extracted dump dir (contains documents.jsonl etc.)

Usage:
  python -m app.scripts.import_dump --dir /tmp/dump --dry-run
  python -m app.scripts.import_dump --dir /tmp/dump --on-conflict=skip
  python -m app.scripts.import_dump --dir /tmp/dump --on-conflict=overwrite --owner-email=me@corp.com
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# ── env loader ───────────────────────────────────────────────────────────────
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


# ── helpers ──────────────────────────────────────────────────────────────────

def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


async def _resolve_owner(s: AsyncSession, owner_email: str | None) -> str:
    """Return a local user id to assign to imported docs."""
    if owner_email:
        row = (await s.execute(
            text("SELECT id FROM users WHERE email = :e AND is_active = TRUE"),
            {"e": owner_email},
        )).first()
        if row:
            return str(row[0])
        raise SystemExit(f"✗ owner-email '{owner_email}' not found in local users table")

    # fallback: first admin
    row = (await s.execute(
        text("SELECT id FROM users WHERE role = 'admin' AND is_active = TRUE ORDER BY created_at LIMIT 1"),
    )).first()
    if row:
        return str(row[0])
    raise SystemExit("✗ No admin user found and --owner-email not specified")


# ── per-entity import functions ───────────────────────────────────────────────

async def _import_divisions(
    s: AsyncSession,
    rows: list[dict],
    dry_run: bool,
) -> tuple[int, int]:
    """Returns (inserted, skipped)."""
    inserted = skipped = 0
    for row in rows:
        existing = (await s.execute(
            text("SELECT id FROM divisions WHERE id = :id"),
            {"id": row["id"]},
        )).first()
        if existing:
            skipped += 1
            continue
        if not dry_run:
            await s.execute(
                text("""
                    INSERT INTO divisions (id, slug, name, description)
                    VALUES (:id, :slug, :name, :desc)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": row["id"],
                    "slug": row["slug"],
                    "name": row["name"],
                    "desc": row.get("description"),
                },
            )
        inserted += 1
    return inserted, skipped


async def _import_teams(
    s: AsyncSession,
    rows: list[dict],
    dry_run: bool,
) -> tuple[int, int]:
    inserted = skipped = 0
    for row in rows:
        existing = (await s.execute(
            text("SELECT id FROM teams WHERE id = :id"),
            {"id": row["id"]},
        )).first()
        if existing:
            skipped += 1
            continue
        # Ensure parent division exists
        div = (await s.execute(
            text("SELECT id FROM divisions WHERE id = :id"),
            {"id": row["division_id"]},
        )).first()
        if not div:
            print(f"  ⚠ team {row['slug']}: parent division {row['division_id']} not found — skipping")
            skipped += 1
            continue
        if not dry_run:
            await s.execute(
                text("""
                    INSERT INTO teams (id, division_id, slug, name, lead_user_id)
                    VALUES (:id, :div, :slug, :name, :lead)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": row["id"],
                    "div": row["division_id"],
                    "slug": row["slug"],
                    "name": row["name"],
                    "lead": row.get("lead_user_id"),
                },
            )
        inserted += 1
    return inserted, skipped


async def _import_groups(
    s: AsyncSession,
    rows: list[dict],
    dry_run: bool,
) -> tuple[int, int]:
    inserted = skipped = 0
    for row in rows:
        existing = (await s.execute(
            text("SELECT id FROM groups WHERE id = :id"),
            {"id": row["id"]},
        )).first()
        if existing:
            skipped += 1
            continue
        team = (await s.execute(
            text("SELECT id FROM teams WHERE id = :id"),
            {"id": row["team_id"]},
        )).first()
        if not team:
            print(f"  ⚠ group {row['slug']}: parent team {row['team_id']} not found — skipping")
            skipped += 1
            continue
        if not dry_run:
            await s.execute(
                text("""
                    INSERT INTO groups (id, team_id, slug, name)
                    VALUES (:id, :team, :slug, :name)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": row["id"],
                    "team": row["team_id"],
                    "slug": row["slug"],
                    "name": row["name"],
                },
            )
        inserted += 1
    return inserted, skipped


async def _import_parts(
    s: AsyncSession,
    rows: list[dict],
    dry_run: bool,
) -> tuple[int, int]:
    inserted = skipped = 0
    for row in rows:
        existing = (await s.execute(
            text("SELECT id FROM parts WHERE id = :id"),
            {"id": row["id"]},
        )).first()
        if existing:
            skipped += 1
            continue
        grp = (await s.execute(
            text("SELECT id FROM groups WHERE id = :id"),
            {"id": row["group_id"]},
        )).first()
        if not grp:
            print(f"  ⚠ part {row['slug']}: parent group {row['group_id']} not found — skipping")
            skipped += 1
            continue
        if not dry_run:
            await s.execute(
                text("""
                    INSERT INTO parts (id, group_id, slug, name)
                    VALUES (:id, :grp, :slug, :name)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "id": row["id"],
                    "grp": row["group_id"],
                    "slug": row["slug"],
                    "name": row["name"],
                },
            )
        inserted += 1
    return inserted, skipped


async def _import_tags(
    s: AsyncSession,
    rows: list[dict],
    dry_run: bool,
) -> tuple[dict[str, str], int, int]:
    """Returns (source_id -> local_id mapping, new_count, reused_count)."""
    id_map: dict[str, str] = {}
    new_count = reused = 0
    for row in rows:
        src_id = str(row["id"])
        name = row["name"]
        # Lookup by name (the uniqueness key)
        existing = (await s.execute(
            text("SELECT id FROM tags WHERE name = :n"),
            {"n": name},
        )).first()
        if existing:
            id_map[src_id] = str(existing[0])
            reused += 1
            continue
        if not dry_run:
            new_id = (await s.execute(
                text("""
                    INSERT INTO tags (name)
                    VALUES (:n)
                    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                    RETURNING id
                """),
                {"n": name},
            )).scalar_one()
            id_map[src_id] = str(new_id)
        else:
            # In dry-run we don't write; use a placeholder so doc_tags counting works
            id_map[src_id] = src_id
        new_count += 1
    return id_map, new_count, reused


async def _import_documents(
    s: AsyncSession,
    rows: list[dict],
    on_conflict: str,
    owner_id: str,
    dry_run: bool,
) -> tuple[dict[str, str], int, int, int]:
    """Returns (source_id -> local_id map, inserted, skipped, overwritten)."""
    id_map: dict[str, str] = {}
    inserted = skipped = overwritten = 0

    for idx, row in enumerate(rows):
        src_id = str(row["id"])
        slug = row["slug"]

        # Resolve part_id: use source part_id if it exists locally, else NULL
        part_id = row.get("part_id")
        if part_id:
            local_part = (await s.execute(
                text("SELECT id FROM parts WHERE id = :id"),
                {"id": part_id},
            )).first()
            if not local_part:
                part_id = None

        existing = (await s.execute(
            text("SELECT id FROM documents WHERE slug = :slug"),
            {"slug": slug},
        )).first()

        if existing:
            local_id = str(existing[0])
            id_map[src_id] = local_id
            if on_conflict == "skip":
                skipped += 1
            elif on_conflict == "overwrite":
                if not dry_run:
                    content = row.get("content_json")
                    content_str = (
                        json.dumps(content, ensure_ascii=False)
                        if isinstance(content, (dict, list))
                        else content
                    )
                    await s.execute(
                        text("""
                            UPDATE documents
                            SET title       = :title,
                                summary     = :summary,
                                status      = :status,
                                content_json = CAST(:body AS JSONB),
                                updated_at  = NOW()
                            WHERE id = :id
                        """),
                        {
                            "id": local_id,
                            "title": row.get("title"),
                            "summary": row.get("summary"),
                            "status": row.get("status", "published"),
                            "body": content_str,
                        },
                    )
                overwritten += 1
            else:
                skipped += 1
        else:
            # New document — issue a fresh UUID, do not reuse source id
            content = row.get("content_json")
            content_str = (
                json.dumps(content, ensure_ascii=False)
                if isinstance(content, (dict, list))
                else content
            )
            if not dry_run:
                new_id = (await s.execute(
                    text("""
                        INSERT INTO documents
                          (slug, part_id, title, summary, status,
                           content_json, schema_ver, version, owner_id,
                           created_at, updated_at)
                        VALUES
                          (:slug, :part, :title, :summary, :status,
                           CAST(:body AS JSONB), :schema_ver, :version, :owner,
                           :cat, :uat)
                        RETURNING id
                    """),
                    {
                        "slug": slug,
                        "part": part_id,
                        "title": row.get("title"),
                        "summary": row.get("summary"),
                        "status": row.get("status", "published"),
                        "body": content_str,
                        "schema_ver": row.get("schema_ver", 1),
                        "version": row.get("version", 1),
                        "owner": owner_id,
                        "cat": row.get("created_at"),
                        "uat": row.get("updated_at"),
                    },
                )).scalar_one()
                id_map[src_id] = str(new_id)
            else:
                id_map[src_id] = src_id  # placeholder
            inserted += 1

        if (idx + 1) % 1000 == 0:
            print(f"  documents: {idx + 1} processed…")

    return id_map, inserted, skipped, overwritten


async def _import_document_tags(
    s: AsyncSession,
    rows: list[dict],
    doc_id_map: dict[str, str],
    tag_id_map: dict[str, str],
    dry_run: bool,
) -> int:
    inserted = 0
    for row in rows:
        local_doc = doc_id_map.get(str(row["document_id"]))
        local_tag = tag_id_map.get(str(row["tag_id"]))
        if not local_doc or not local_tag:
            continue
        if not dry_run:
            await s.execute(
                text("""
                    INSERT INTO document_tags (document_id, tag_id)
                    VALUES (:d, :t)
                    ON CONFLICT DO NOTHING
                """),
                {"d": local_doc, "t": local_tag},
            )
        inserted += 1
    return inserted


# ── main ─────────────────────────────────────────────────────────────────────

async def _run(args: argparse.Namespace) -> None:
    dump_dir = Path(args.dir)
    if not dump_dir.is_dir():
        raise SystemExit(f"✗ dump directory not found: {dump_dir}")

    manifest_path = dump_dir / "manifest.json"
    if not manifest_path.exists():
        raise SystemExit("✗ manifest.json not found — is this a valid dump directory?")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    print(f"→ dump from {manifest.get('source_host', '?')} at {manifest.get('dumped_at', '?')}")
    print(f"  on-conflict: {args.on_conflict}  dry-run: {args.dry_run}")
    print()

    # Load JSONL files
    divisions_rows = _read_jsonl(dump_dir / "divisions.jsonl")
    teams_rows = _read_jsonl(dump_dir / "teams.jsonl")
    groups_rows = _read_jsonl(dump_dir / "groups.jsonl")
    parts_rows = _read_jsonl(dump_dir / "parts.jsonl")
    tags_rows = _read_jsonl(dump_dir / "tags.jsonl")
    docs_rows = _read_jsonl(dump_dir / "documents.jsonl")
    doc_tags_rows = _read_jsonl(dump_dir / "document_tags.jsonl")

    async with session_scope() as s:
        # Resolve owner before the big transaction
        owner_id = await _resolve_owner(s, args.owner_email)
        print(f"  owner: {owner_id}")
        print()

        # 1) Org hierarchy
        div_ins, div_skip = await _import_divisions(s, divisions_rows, args.dry_run)
        print(f"  divisions  : +{div_ins} inserted / {div_skip} skipped")

        teams_ins, teams_skip = await _import_teams(s, teams_rows, args.dry_run)
        print(f"  teams      : +{teams_ins} inserted / {teams_skip} skipped")

        grp_ins, grp_skip = await _import_groups(s, groups_rows, args.dry_run)
        print(f"  groups     : +{grp_ins} inserted / {grp_skip} skipped")

        part_ins, part_skip = await _import_parts(s, parts_rows, args.dry_run)
        print(f"  parts      : +{part_ins} inserted / {part_skip} skipped")

        # 2) Tags
        tag_id_map: dict[str, str] = {}
        tag_new = tag_reused = 0
        if not args.no_tags:
            tag_id_map, tag_new, tag_reused = await _import_tags(s, tags_rows, args.dry_run)
            print(f"  tags       : {tag_reused} reused / +{tag_new} new")
        else:
            print("  tags       : skipped (--no-tags)")

        # 3) Documents
        doc_id_map, doc_ins, doc_skip, doc_over = await _import_documents(
            s, docs_rows, args.on_conflict, owner_id, args.dry_run
        )
        print(
            f"  docs       : +{doc_ins} inserted / {doc_skip} skipped"
            f" / {doc_over} overwritten"
        )

        # 4) Document tags
        dt_ins = 0
        if not args.no_tags and doc_tags_rows:
            dt_ins = await _import_document_tags(
                s, doc_tags_rows, doc_id_map, tag_id_map, args.dry_run
            )
            print(f"  doc_tags   : +{dt_ins}")
        else:
            print("  doc_tags   : skipped")

        print()
        print("  links      : skipped — rebuild via refresh_links")

        if args.dry_run:
            # Explicitly rollback so session_scope's auto-commit is a no-op
            await s.rollback()
            print()
            print("  (dry-run: no changes written)")

    print()
    if args.dry_run:
        print("dry-run complete — would insert/overwrite as above")
    else:
        print("merge complete")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge a MXWP data dump into the local DB (additive)"
    )
    parser.add_argument("--dir", required=True, help="Extracted dump directory")
    parser.add_argument(
        "--on-conflict",
        choices=["skip", "overwrite"],
        default="skip",
        help="What to do when a slug already exists locally (default: skip)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Count only — no DB writes",
    )
    parser.add_argument(
        "--no-tags",
        action="store_true",
        help="Skip tags + document_tags tables",
    )
    parser.add_argument(
        "--owner-email",
        default=None,
        help="Assign new docs to this user email. Default: first admin.",
    )
    args = parser.parse_args()
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
