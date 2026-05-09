"""share-link email opt-out plumbing.

Cycle 13 S2 follow-up. ``sharing.notify_emails`` blasts share-link emails
to external addresses without consulting any preference; recipients who
no longer want our mail had no recourse short of asking the sender.

Schema delta:

  - ``email_optout_list``         — global per-address opt-out state.
                                    UNIQUE(email) so re-opting-out is a no-op.
  - ``share_email_optout_tokens`` — per-email-send unsubscribe token,
                                    embedded as a link in the body. Marked
                                    ``used_at`` once the recipient clicks
                                    the GET handler.

Reversible — downgrade drops both tables (CASCADE so any FKs from future
work go with them).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0038_email_optout"
down_revision: str | Sequence[str] | None = "0037_cron_timezone"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE email_optout_list (
          email        TEXT PRIMARY KEY,
          opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          source       TEXT NOT NULL DEFAULT 'share-email-optout'
        )
        """
    )

    op.execute(
        """
        CREATE TABLE share_email_optout_tokens (
          token        TEXT PRIMARY KEY,
          email        TEXT NOT NULL,
          document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          used_at      TIMESTAMPTZ NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_share_email_optout_tokens_email "
        "ON share_email_optout_tokens(email)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_share_email_optout_tokens_email")
    op.execute("DROP TABLE IF EXISTS share_email_optout_tokens CASCADE")
    op.execute("DROP TABLE IF EXISTS email_optout_list CASCADE")
