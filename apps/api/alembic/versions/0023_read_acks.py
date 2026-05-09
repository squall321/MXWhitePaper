"""read_acks — explicit "I've read this" acknowledgments (Cycle 0023).

`document_reads` (cycle 4 / migration 0008) tracks *implicit* views — every
time the FE flushes a heartbeat we accumulate `read_seconds`. That signal is
useful for "popular docs" / analytics but it doesn't tell the author "this
specific reviewer has confirmed they've read the latest revision".

`read_acks` is the explicit, user-driven counterpart:

  - One row per (user, document). Idempotent re-acks update `acknowledged_at`
    + `comment` so the FE button can be pressed twice.
  - `comment` stays optional; reviewers/required readers may leave a short
    note ("LGTM", "1.2 절 추가 의견 있음 …").
  - Cascade on `documents.id` so archive/delete leaves no orphan rows.

Reversible: downgrade drops the table + index.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0023_read_acks"
down_revision: str | Sequence[str] | None = "0022_share_short_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE read_acks (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id         UUID NOT NULL REFERENCES users(id),
          document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          comment         TEXT NULL,
          UNIQUE (user_id, document_id)
        )
    """)
    op.execute("CREATE INDEX idx_read_acks_doc ON read_acks(document_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_read_acks_doc")
    op.execute("DROP TABLE IF EXISTS read_acks CASCADE")
