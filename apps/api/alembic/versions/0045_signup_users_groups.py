"""Signup feature — groups.kind, users.group_id, seed MX division.

Adds the minimal data shape for the self-signup flow:

  - groups.kind ∈ {'group','lab'}   — lab is officially team-direct, lives
                                       in the same table with kind='lab'.
  - users.group_id (nullable)        — picked at signup time; null is fine
                                       if the user only knows their team.
  - MX division seed                 — so the first signup form has at
                                       least one selectable division.
  - 2 indexes for the cascading dropdowns to stay fast as the org tree
    grows.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0045_signup_users_groups"
down_revision: str | Sequence[str] | None = "0044_more_facts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # groups.kind — single column lets us treat groups + labs uniformly
    # from the FE dropdown's POV while preserving the official distinction.
    op.execute(
        "ALTER TABLE groups "
        "ADD COLUMN kind TEXT NOT NULL DEFAULT 'group' "
        "CHECK (kind IN ('group','lab'))"
    )

    # users.group_id — nullable so signup can complete with just team_id.
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN group_id UUID REFERENCES groups(id) ON DELETE SET NULL"
    )

    # Seed at least one division so the very first signup isn't blocked
    # waiting on an admin to register one. Slug 'mx' is idempotent.
    op.execute(
        "INSERT INTO divisions (slug, name, description) "
        "VALUES ('mx', 'MX', 'Default division (seeded by 0045_signup_users_groups)') "
        "ON CONFLICT (slug) DO NOTHING"
    )

    # Cascading dropdowns: division → teams → groups. Both hops need fast
    # lookups; (team_id, kind) lets the FE filter labs separately if it wants.
    op.execute("CREATE INDEX IF NOT EXISTS idx_teams_division ON teams(division_id)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_groups_team_kind ON groups(team_id, kind)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_groups_team_kind")
    op.execute("DROP INDEX IF EXISTS idx_teams_division")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS group_id")
    op.execute("ALTER TABLE groups DROP COLUMN IF EXISTS kind")
    # MX division seed is intentionally not deleted — it may already hold
    # production data via FK references that DROP would break.
