"""Sprint 0 seed: 1 division + 1 team + 1 group + 1 part + 1 admin user
+ load 5 golden DocumentJSON samples from packages/shared/samples/.

Run:  docker compose exec api python -m app.scripts.seed
Idempotent — safe to re-run.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

from sqlalchemy import text

from app.core.db import session_scope
from app.core.security import hash_password

# In container: /workspace/packages/shared/samples (mounted from repo root)
# Outside container: relative from cwd
SAMPLES_DIR = Path("/workspace/packages/shared/samples")
if not SAMPLES_DIR.exists():
    SAMPLES_DIR = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"


async def _ensure_org(s) -> dict[str, str]:
    """Create the MX division → 재무팀 → 회계그룹 → 결산파트 hierarchy."""
    await s.execute(text("""
        INSERT INTO divisions (slug, name, description)
        VALUES ('mx', 'MX 사업부', 'Mobile eXperience')
        ON CONFLICT (slug) DO NOTHING
    """))
    division_id = (await s.execute(text(
        "SELECT id FROM divisions WHERE slug = 'mx'"
    ))).scalar_one()

    await s.execute(
        text("""
            INSERT INTO teams (division_id, slug, name)
            VALUES (:div, 'finance', '재무팀')
            ON CONFLICT (division_id, slug) DO NOTHING
        """),
        {"div": division_id},
    )
    team_id = (await s.execute(text(
        "SELECT id FROM teams WHERE division_id = :d AND slug = 'finance'"
    ), {"d": division_id})).scalar_one()

    await s.execute(
        text("""
            INSERT INTO groups (team_id, slug, name)
            VALUES (:t, 'accounting', '회계그룹')
            ON CONFLICT (team_id, slug) DO NOTHING
        """),
        {"t": team_id},
    )
    group_id = (await s.execute(text(
        "SELECT id FROM groups WHERE team_id = :t AND slug = 'accounting'"
    ), {"t": team_id})).scalar_one()

    await s.execute(
        text("""
            INSERT INTO parts (group_id, slug, name)
            VALUES (:g, 'closing', '결산파트')
            ON CONFLICT (group_id, slug) DO NOTHING
        """),
        {"g": group_id},
    )
    part_id = (await s.execute(text(
        "SELECT id FROM parts WHERE group_id = :g AND slug = 'closing'"
    ), {"g": group_id})).scalar_one()

    return {"division": division_id, "team": team_id, "group": group_id, "part": part_id}


async def _ensure_admin(s) -> str:
    await s.execute(
        text("""
            INSERT INTO users (email, name, password_hash, role)
            VALUES ('admin@mx.local', 'MX Admin', :pw, 'admin')
            ON CONFLICT (email) DO NOTHING
        """),
        {"pw": hash_password("admin1234!")},
    )
    return (await s.execute(text(
        "SELECT id FROM users WHERE email = 'admin@mx.local'"
    ))).scalar_one()


async def _load_samples(s, owner_id: str, part_id: str) -> int:
    """5개 sample 문서를 upsert + version=1 row 보장.

    Sprint 3 QA 발견 — 시드 직후 GET /versions/1 이 404 였음. 시드 시점에
    document_versions 행이 없어서. 이제 INSERT 시 version 1 을 함께 박는다.
    이미 v1 이 있으면 그대로 두고, 없으면 현재 head 의 content 로 v1 생성.
    """
    if not SAMPLES_DIR.exists():
        print(f"⚠ samples dir not found: {SAMPLES_DIR}")
        return 0
    files = sorted(SAMPLES_DIR.glob("*.json"))
    count = 0
    for f in files:
        data = json.loads(f.read_text(encoding="utf-8"))
        slug = data["slug"]
        body_json = json.dumps(data, ensure_ascii=False)
        await s.execute(
            text("""
                INSERT INTO documents (slug, part_id, title, summary, status, content_json, owner_id)
                VALUES (:slug, :part, :title, :summary, 'published', CAST(:body AS JSONB), :owner)
                ON CONFLICT (slug) DO UPDATE SET
                  title = EXCLUDED.title,
                  summary = EXCLUDED.summary,
                  content_json = EXCLUDED.content_json,
                  updated_at = NOW()
            """),
            {
                "slug": slug,
                "part": part_id,
                "title": data["title"],
                "summary": data.get("summary"),
                "body": body_json,
                "owner": owner_id,
            },
        )
        # v1 row 보장 — 이미 있으면 ON CONFLICT 로 skip.
        await s.execute(
            text("""
                INSERT INTO document_versions
                  (document_id, version, content_json, edited_by, change_log)
                SELECT d.id, 1, CAST(:body AS JSONB), :owner, 'seed'
                FROM documents d
                WHERE d.slug = :slug
                ON CONFLICT (document_id, version) DO NOTHING
            """),
            {"slug": slug, "body": body_json, "owner": owner_id},
        )
        count += 1
        print(f"  ✓ {slug}")
    return count


async def main() -> None:
    async with session_scope() as s:
        org = await _ensure_org(s)
        print(f"✓ orgs: division={org['division']} part={org['part']}")
        admin = await _ensure_admin(s)
        print(f"✓ admin user: {admin}")
        n = await _load_samples(s, admin, org["part"])
        print(f"✓ loaded {n} sample documents")

    # Fact tables that back the widget API (alembic 0040). Skipped on
    # any error so a missing migration doesn't block the rest of seed.
    try:
        from app.scripts import seed_widget_facts
        await seed_widget_facts._amain()
        print("✓ widget fact tables seeded")
    except Exception as e:
        print(f"⚠ widget fact seed skipped: {e}")

    # Canonical glossary terms — DB-backs the `glossary-ref` block
    # so samples don't need inline definitions.
    try:
        from app.scripts import seed_glossary
        await seed_glossary._amain()
    except Exception as e:
        print(f"⚠ glossary seed skipped: {e}")

    # Launch tasks / timeline / demand forecast — DB-backs sample 06.
    try:
        from app.scripts import seed_launch_facts
        await seed_launch_facts._amain()
    except Exception as e:
        print(f"⚠ launch facts seed skipped: {e}")

    # Form / quiz canonical definitions lifted from sample 11 / 13.
    try:
        from app.scripts import seed_form_quiz_defs
        await seed_form_quiz_defs._amain()
    except Exception as e:
        print(f"⚠ form/quiz defs seed skipped: {e}")

    # Cohort retention / funnel / audit summary / incidents / campaigns.
    try:
        from app.scripts import seed_more_facts
        await seed_more_facts._amain()
    except Exception as e:
        print(f"⚠ more facts seed skipped: {e}")

    print("✓ seed complete")


if __name__ == "__main__":
    asyncio.run(main())
