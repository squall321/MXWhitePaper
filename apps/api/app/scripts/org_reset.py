"""Cycle 14 — radical org-tree reset.

Goal: leave the DB with exactly one org chain:

    division 'mx'        → 'MX 사업부'
      team 'dev'         → '개발실'
        group 'he-team'  → 'HE팀'
          part 'cae'     → 'CAE그룹'

The 5 sample documents (month-end-closing / onboarding-guide /
product-photo-guide / kpi-dashboard-guide / team-meeting-template) are
preserved with `part_id = NULL` (미배치). All other documents and their
dependents (versions, links, document_tags) are hard-deleted. All teams /
groups / parts under MX outside the new chain are removed (FK CASCADE
takes care of children); `users.team_id` references that dangle are
nulled out by ON DELETE SET NULL.

The script is **idempotent** — re-running it converges to the same
final state. It runs everything inside a single transaction.

Usage:
    apptainer exec instance://mxwp_api \
        /bin/sh -c "cd /workspace && python3 -m app.scripts.org_reset"
"""
from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import text

from app.core.db import session_scope

SAMPLE_SLUGS: tuple[str, ...] = (
    "month-end-closing",
    "onboarding-guide",
    "product-photo-guide",
    "kpi-dashboard-guide",
    "team-meeting-template",
)

TARGET_DIVISION_SLUG = "mx"
TARGET_DIVISION_NAME = "MX 사업부"
TARGET_TEAM_SLUG = "dev"
TARGET_TEAM_NAME = "개발실"
TARGET_GROUP_SLUG = "he-team"
TARGET_GROUP_NAME = "HE팀"
TARGET_PART_SLUG = "cae"
TARGET_PART_NAME = "CAE그룹"


async def _stats(s: Any) -> dict[str, int]:
    out: dict[str, int] = {}
    for tbl in ("divisions", "teams", "groups", "parts", "documents"):
        out[tbl] = (await s.execute(text(f"SELECT COUNT(*) FROM {tbl}"))).scalar_one()
    return out


async def reset_org() -> dict[str, Any]:
    async with session_scope() as s:
        before = await _stats(s)

        # 1) Sample doc rescue — set part_id = NULL so they survive.
        await s.execute(
            text(
                """
                UPDATE documents
                   SET part_id = NULL
                 WHERE slug = ANY(:slugs)
                """
            ),
            {"slugs": list(SAMPLE_SLUGS)},
        )

        # 2) Delete every document NOT in the rescue list (CASCADE clears
        #    document_versions, document_tags, links via FK ON DELETE CASCADE).
        deleted_docs = (
            await s.execute(
                text(
                    """
                    DELETE FROM documents
                     WHERE slug <> ALL(:slugs)
                     RETURNING id
                    """
                ),
                {"slugs": list(SAMPLE_SLUGS)},
            )
        ).rowcount or 0  # type: ignore[attr-defined]  # DML result is CursorResult

        # 3) Wipe every division except MX (CASCADE drops nested teams/
        #    groups/parts; users.team_id is ON DELETE SET NULL).
        await s.execute(
            text("DELETE FROM divisions WHERE slug <> :slug"),
            {"slug": TARGET_DIVISION_SLUG},
        )

        # 4) Ensure target MX division exists with the canonical name.
        await s.execute(
            text(
                """
                INSERT INTO divisions (slug, name, description)
                VALUES (:slug, :name, 'Mobile eXperience')
                ON CONFLICT (slug) DO UPDATE
                SET name = EXCLUDED.name
                """
            ),
            {"slug": TARGET_DIVISION_SLUG, "name": TARGET_DIVISION_NAME},
        )
        division_id = (
            await s.execute(
                text("SELECT id FROM divisions WHERE slug = :slug"),
                {"slug": TARGET_DIVISION_SLUG},
            )
        ).scalar_one()

        # 5) Drop any team in MX that is not the target. CASCADE handles
        #    the team's groups/parts.
        await s.execute(
            text(
                """
                DELETE FROM teams
                 WHERE division_id = :div AND slug <> :target
                """
            ),
            {"div": division_id, "target": TARGET_TEAM_SLUG},
        )

        # 6) Upsert the target team.
        await s.execute(
            text(
                """
                INSERT INTO teams (division_id, slug, name)
                VALUES (:div, :slug, :name)
                ON CONFLICT (division_id, slug) DO UPDATE
                SET name = EXCLUDED.name
                """
            ),
            {
                "div": division_id,
                "slug": TARGET_TEAM_SLUG,
                "name": TARGET_TEAM_NAME,
            },
        )
        team_id = (
            await s.execute(
                text(
                    "SELECT id FROM teams WHERE division_id = :div AND slug = :slug"
                ),
                {"div": division_id, "slug": TARGET_TEAM_SLUG},
            )
        ).scalar_one()

        # 7) Drop any group under target team that is not the target group.
        await s.execute(
            text(
                """
                DELETE FROM groups
                 WHERE team_id = :t AND slug <> :target
                """
            ),
            {"t": team_id, "target": TARGET_GROUP_SLUG},
        )

        # 8) Upsert the target group.
        await s.execute(
            text(
                """
                INSERT INTO groups (team_id, slug, name)
                VALUES (:t, :slug, :name)
                ON CONFLICT (team_id, slug) DO UPDATE
                SET name = EXCLUDED.name
                """
            ),
            {
                "t": team_id,
                "slug": TARGET_GROUP_SLUG,
                "name": TARGET_GROUP_NAME,
            },
        )
        group_id = (
            await s.execute(
                text(
                    "SELECT id FROM groups WHERE team_id = :t AND slug = :slug"
                ),
                {"t": team_id, "slug": TARGET_GROUP_SLUG},
            )
        ).scalar_one()

        # 9) Drop any part under target group that is not the target part.
        await s.execute(
            text(
                """
                DELETE FROM parts
                 WHERE group_id = :g AND slug <> :target
                """
            ),
            {"g": group_id, "target": TARGET_PART_SLUG},
        )

        # 10) Upsert the target part.
        await s.execute(
            text(
                """
                INSERT INTO parts (group_id, slug, name)
                VALUES (:g, :slug, :name)
                ON CONFLICT (group_id, slug) DO UPDATE
                SET name = EXCLUDED.name
                """
            ),
            {
                "g": group_id,
                "slug": TARGET_PART_SLUG,
                "name": TARGET_PART_NAME,
            },
        )

        # 11) Audit-log the reset event. (cast via CAST to avoid :name::type
        #     ambiguity with SQLAlchemy parameter binding.)
        await s.execute(
            text(
                """
                INSERT INTO audit_logs (user_id, action, target, payload)
                VALUES (NULL, 'org.reset', 'system', CAST(:payload AS jsonb))
                """
            ),
            {
                "payload": (
                    f'{{"deleted_docs": {deleted_docs}, '
                    f'"sample_slugs_preserved": {len(SAMPLE_SLUGS)}}}'
                )
            },
        )

        after = await _stats(s)

    return {
        "before": before,
        "after": after,
        "deleted_docs": deleted_docs,
        "sample_slugs_preserved": list(SAMPLE_SLUGS),
        "target": {
            "division": {"slug": TARGET_DIVISION_SLUG, "name": TARGET_DIVISION_NAME},
            "team": {"slug": TARGET_TEAM_SLUG, "name": TARGET_TEAM_NAME},
            "group": {"slug": TARGET_GROUP_SLUG, "name": TARGET_GROUP_NAME},
            "part": {"slug": TARGET_PART_SLUG, "name": TARGET_PART_NAME},
        },
    }


def main() -> None:
    result = asyncio.run(reset_org())
    print("=== org_reset complete ===")
    print(f"  before : {result['before']}")
    print(f"  after  : {result['after']}")
    print(f"  deleted_docs       : {result['deleted_docs']}")
    print(f"  preserved samples  : {result['sample_slugs_preserved']}")
    tgt = result["target"]
    print(
        f"  tree               : {tgt['division']['name']} "
        f"({tgt['division']['slug']}) → {tgt['team']['name']} "
        f"({tgt['team']['slug']}) → {tgt['group']['name']} "
        f"({tgt['group']['slug']}) → {tgt['part']['name']} "
        f"({tgt['part']['slug']})"
    )


if __name__ == "__main__":
    main()
