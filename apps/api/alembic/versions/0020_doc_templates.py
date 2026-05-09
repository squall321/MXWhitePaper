"""doc_templates — server-side shared document templates.

Revision ID: 0020_doc_templates
Revises: 0019_notification_prefs
Create Date: 2026-05-09 11:00:00

Cycle 7 shipped 14 hard-coded templates baked into the FE bundle. This
migration introduces a server-backed template store so admins (and any
editor with publish rights) can publish their own DocumentJSON section
seeds org-wide. Mirrors the snippets table (per-block, cycle 5) but stores
a per-document `sections` array instead of `blocks`.

Scope ladder mirrors snippets exactly:
  - private — only the owner
  - team    — anyone in the same `users.team_id`
  - org     — everyone in the org

`use_count` is bumped on `GET /:slug` and on the `/use` "import to doc"
helper, so the gallery can sort popular templates first.

Reversible: downgrade drops the table.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0020_doc_templates"
down_revision: str | Sequence[str] | None = "0019_notification_prefs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE doc_templates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          description TEXT NULL,
          category TEXT NOT NULL,
          thumb_image_id TEXT NULL,
          sections JSONB NOT NULL,
          scope TEXT NOT NULL CHECK (scope IN ('private', 'team', 'org')),
          use_count INT NOT NULL DEFAULT 0,
          created_by UUID NOT NULL REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute(
        "CREATE INDEX idx_doc_templates_scope_category "
        "ON doc_templates(scope, category)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_doc_templates_scope_category")
    op.execute("DROP TABLE IF EXISTS doc_templates CASCADE")
