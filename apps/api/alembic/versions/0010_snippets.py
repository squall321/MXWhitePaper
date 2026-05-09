"""snippets — reusable block library.

Revision ID: 0010_snippets
Revises: 0009_comments_threading
Create Date: 2026-05-09 09:00:00

Users save N blocks (a "snippet") and paste them into any document later.
Scope ladder:
  - private — only the owner
  - team    — anyone in the same `users.team_id`
  - org     — everyone in the org

`use_count` is bumped each time the snippet is fetched (or via the explicit
POST /snippets/:id/use marker), so the manager page can surface popular
snippets first.

Reversible: downgrade drops the table.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0010_snippets"
down_revision: str | Sequence[str] | None = "0009_comments_threading"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE snippets (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          scope           TEXT NOT NULL CHECK (scope IN ('private', 'team', 'org')),
          name            TEXT NOT NULL,
          description     TEXT NULL,
          blocks          JSONB NOT NULL,
          tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
          use_count       INT NOT NULL DEFAULT 0,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_snippets_owner ON snippets(owner_user_id)")
    op.execute("CREATE INDEX idx_snippets_scope ON snippets(scope)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS snippets CASCADE")
