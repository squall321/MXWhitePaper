"""anchor_samples — per-flush record of the topmost-visible block.

Revision ID: 0016_anchor_samples
Revises: 0015_backups
Create Date: 2026-05-09 12:00:00

Cycle 0016 — fuel for the per-document section heat-map.

The reading-time tracker (cycle 4) flushes accumulated read_seconds every
30s. From this cycle on, the same flush also POSTs the *current* anchor
block id (the topmost block in the viewport's middle slice). Each POST
inserts one row here. The per-doc analytics endpoint groups consecutive
samples per anchor to estimate how long each section retains a reader.

The table is intentionally lossy: 30s sample interval, 30-day TTL pruned
by ``analytics_pruner``. Index on (document_id, sampled_at DESC) supports
the heat-map aggregate; (user_id, sampled_at DESC) supports a possible
"my reading trail" feature later.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0016_anchor_samples"
down_revision: str | Sequence[str] | None = "0015_backups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE anchor_samples (
          id           BIGSERIAL PRIMARY KEY,
          user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          section_id   TEXT NULL,
          block_id     TEXT NULL,
          sampled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute(
        "CREATE INDEX idx_anchor_samples_doc_time "
        "ON anchor_samples(document_id, sampled_at DESC)"
    )
    op.execute(
        "CREATE INDEX idx_anchor_samples_user "
        "ON anchor_samples(user_id, sampled_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_anchor_samples_user")
    op.execute("DROP INDEX IF EXISTS idx_anchor_samples_doc_time")
    op.execute("DROP TABLE IF EXISTS anchor_samples CASCADE")
