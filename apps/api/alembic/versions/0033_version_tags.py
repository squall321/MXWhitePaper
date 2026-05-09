"""version_tags — named version labels and branch-from-tag (Cycle 16).

Cycle 5 added document_versions (numeric v1, v2, …). Editors and admins want
human-friendly labels on specific snapshots — "v1.0 release", "RC1" — and
optionally branch a brand-new document from any tagged snapshot. This
migration creates a single ``version_tags`` table that joins
``documents.id × document_versions.version`` to a free-text tag name.

Schema:

  - ``id`` UUID PK
  - ``document_id`` → documents.id (cascade)
  - ``version`` INT — the document_versions row this tag points at
  - ``tag_name`` TEXT — human label, unique per document
  - ``description`` TEXT NULL — optional release notes
  - ``tagged_by`` → users.id (audit attribution)
  - ``tagged_at`` TIMESTAMPTZ default NOW()
  - ``is_locked`` BOOLEAN default false — locked tags require admin to delete

A unique index on ``(document_id, tag_name)`` keeps tag names
disambiguated within a single doc. ``idx_version_tags_doc`` accelerates the
common "list all tags for a document" lookup.

This migration also acts as a **merge** of the parallel heads
``0031_automation_cron`` and ``0032_audit_retention`` (the latter shipped
in a sibling agent's branch) so the chain returns to a single tip.

Reversible.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0033_version_tags"
# Merge revision — two heads exist alongside our changes.
down_revision: str | Sequence[str] | None = (
    "0031_automation_cron",
    "0032_audit_retention",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE version_tags (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          version      INT NOT NULL,
          tag_name     TEXT NOT NULL,
          description  TEXT NULL,
          tagged_by    UUID NOT NULL REFERENCES users(id),
          tagged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          is_locked    BOOLEAN NOT NULL DEFAULT false,
          UNIQUE (document_id, tag_name)
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_version_tags_doc "
        "ON version_tags(document_id, version)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_version_tags_doc")
    op.execute("DROP TABLE IF EXISTS version_tags CASCADE")
