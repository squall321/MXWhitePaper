"""Re-seed (idempotent upsert) every DocumentJSON sample under
`packages/shared/samples/*.json` into the running BE database.

Why a second seeder when `app.scripts.seed` already loads samples?
- `app.scripts.seed` is a one-shot bootstrap: orgs, admin user, samples.
- This script is the "samples-only refresh" used after editing or adding
  golden samples. It assumes the org tree + admin user already exist.

Run inside the api container or with the local venv:
    python -m apps.api.scripts.seed_samples         # repo root
    docker compose exec api python -m scripts.seed_samples   # container

Idempotent — safe to re-run. Resolves owner/part by querying the rows
populated by `app.scripts.seed`. If those don't exist yet, the script bails
out with a clear hint.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy import text

# Allow running this file directly from anywhere — append apps/api so
# `app.core.db` resolves whether or not it's installed as a package.
HERE = Path(__file__).resolve()
APPS_API = HERE.parent.parent
if str(APPS_API) not in sys.path:
    sys.path.insert(0, str(APPS_API))

from app.core.db import session_scope  # noqa: E402

# In container the repo is mounted at /workspace; outside, walk up from here.
SAMPLES_DIR = Path("/workspace/packages/shared/samples")
if not SAMPLES_DIR.exists():
    SAMPLES_DIR = APPS_API.parent.parent / "packages" / "shared" / "samples"


async def _resolve_owner_and_part(s) -> tuple[str, str]:
    """Look up the admin user + closing part populated by the bootstrap seed.

    The samples are stored under `documents.part_id` and `documents.owner_id`
    (FKs). We don't try to recreate them here — that's `app.scripts.seed`'s
    job. We just fail fast with a hint if the bootstrap hasn't run.
    """
    owner = (
        await s.execute(text("SELECT id FROM users WHERE email = 'admin@mx.local'"))
    ).scalar_one_or_none()
    part = (
        await s.execute(text("SELECT id FROM parts WHERE slug = 'closing' LIMIT 1"))
    ).scalar_one_or_none()
    if not owner or not part:
        raise SystemExit(
            "✗ admin@mx.local / parts.slug='closing' not found.\n"
            "  Run the bootstrap seed first:  python -m app.scripts.seed"
        )
    return owner, part


async def _upsert_samples(s, owner_id: str, part_id: str) -> int:
    """Upsert every JSON file under SAMPLES_DIR; ensure version=1 row exists."""
    if not SAMPLES_DIR.exists():
        raise SystemExit(f"✗ samples dir missing: {SAMPLES_DIR}")
    files = sorted(SAMPLES_DIR.glob("*.json"))
    if not files:
        raise SystemExit(f"✗ no *.json found under {SAMPLES_DIR}")

    count = 0
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        slug = data["slug"]
        body_json = json.dumps(data, ensure_ascii=False)
        await s.execute(
            text(
                """
                INSERT INTO documents (slug, part_id, title, summary, status, content_json, owner_id)
                VALUES (:slug, :part, :title, :summary, 'published', CAST(:body AS JSONB), :owner)
                ON CONFLICT (slug) DO UPDATE SET
                  title = EXCLUDED.title,
                  summary = EXCLUDED.summary,
                  content_json = EXCLUDED.content_json,
                  updated_at = NOW()
                """
            ),
            {
                "slug": slug,
                "part": part_id,
                "title": data["title"],
                "summary": data.get("summary"),
                "body": body_json,
                "owner": owner_id,
            },
        )
        # Ensure a v1 row so /documents/:slug/versions/1 doesn't 404.
        await s.execute(
            text(
                """
                INSERT INTO document_versions
                  (document_id, version, content_json, edited_by, change_log)
                SELECT d.id, 1, CAST(:body AS JSONB), :owner, 'seed_samples'
                FROM documents d
                WHERE d.slug = :slug
                ON CONFLICT (document_id, version) DO NOTHING
                """
            ),
            {"slug": slug, "body": body_json, "owner": owner_id},
        )
        count += 1
        print(f"  ✓ {slug}")
    return count


async def main() -> None:
    print(f"📂 sample dir: {SAMPLES_DIR}")
    async with session_scope() as s:
        owner, part = await _resolve_owner_and_part(s)
        n = await _upsert_samples(s, owner, part)
    print(f"✓ upserted {n} sample documents")


if __name__ == "__main__":
    asyncio.run(main())
