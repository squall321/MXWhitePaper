"""saved_views — saved searches / smart folders (Cycle 0030).

Users persist a complex search filter (e.g. "내가 작성 + 태그=결산 + 최근 30일")
as a named view. Saved views show up in the left rail under "📂 내 보기" with
an icon + name + live count badge, and have their own detail route at
`/views/:id` which re-applies the stored filters and renders matching docs.

Filters are stored as JSONB so we can grow new fields (status, fulltext q, …)
without further migrations. The shape today is:

  {
    part?: string,    // part slug (matches parts.slug)
    tag?: string,     // single tag (matches tags.tag)
    author?: string,  // user_id (UUID) or email
    from?: string,    // YYYY-MM-DD lower bound on updated_at
    to?: string,      // YYYY-MM-DD upper bound on updated_at
    q?: string,       // freeform query (title/summary ILIKE)
    status?: string   // draft|published|archived
  }

`ordering` controls the order rows are listed in the left rail. dnd-kit on the
FE writes new ordering values via PATCH after a drag. Default 0 — new rows
land at the top until reordered.

Reversible — downgrade drops the index + the table.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0030_saved_views"
down_revision: str | Sequence[str] | None = "0028_reminders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE saved_views (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name        TEXT NOT NULL,
          icon        TEXT NULL,
          filters     JSONB NOT NULL DEFAULT '{}',
          ordering    INT NOT NULL DEFAULT 0,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_saved_views_user_order "
        "ON saved_views(user_id, ordering)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_saved_views_user_order")
    op.execute("DROP TABLE IF EXISTS saved_views CASCADE")
