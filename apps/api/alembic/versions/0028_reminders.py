"""reminders — time-based ping/follow-up reminders (Cycle 0028).

Users schedule a notification for some time in the future ("ping me about this
doc in 2 weeks"). The `reminder_runner` ticker (asyncio in-process, mirrors
`backup_runner` / `digest_runner`) wakes every 60s, finds rows whose
`remind_at <= NOW() AND fired_at IS NULL`, fans them out as `notifications`
of kind `'reminder'`, and stamps `fired_at`.

Tables / columns:
  - ``reminders``                  — schedule rows (one per ping)
  - ``idx_reminders_user_unfired`` — partial index for `/me/reminders` list
  - ``idx_reminders_due``          — partial index for the runner sweep

Also extends `notifications.kind` CHECK to include `'reminder'` so the runner
can insert without bumping the constraint at runtime.

Reversible — downgrade drops both indexes + the table and restores the prior
notifications.kind CHECK shape.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0028_reminders"
down_revision: str | Sequence[str] | None = "0027_retention_policies"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Allow `reminder` as a notifications.kind. Reuses the canonical CHECK
    # shape from 0025 with the new value appended.
    op.execute(
        "ALTER TABLE notifications "
        "DROP CONSTRAINT IF EXISTS notifications_kind_check"
    )
    op.execute(
        """
        ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN (
          'comment_mention', 'comment_reply',
          'review_request', 'review_decision',
          'subscription_event', 'subscription_digest',
          'reaction_added',
          'automation_blast',
          'retention_warning',
          'reminder'
        ))
        """
    )

    op.execute(
        """
        CREATE TABLE reminders (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          message      TEXT NULL,
          remind_at    TIMESTAMPTZ NOT NULL,
          fired_at     TIMESTAMPTZ NULL,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_reminders_user_unfired "
        "ON reminders(user_id, remind_at) WHERE fired_at IS NULL"
    )
    op.execute(
        "CREATE INDEX idx_reminders_due "
        "ON reminders(remind_at) WHERE fired_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_reminders_due")
    op.execute("DROP INDEX IF EXISTS idx_reminders_user_unfired")
    op.execute("DROP TABLE IF EXISTS reminders CASCADE")
    # Restore the previous notifications.kind CHECK shape (sans `reminder`).
    op.execute(
        "ALTER TABLE notifications "
        "DROP CONSTRAINT IF EXISTS notifications_kind_check"
    )
    op.execute(
        """
        ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN (
          'comment_mention', 'comment_reply',
          'review_request', 'review_decision',
          'subscription_event', 'subscription_digest',
          'reaction_added',
          'automation_blast',
          'retention_warning'
        ))
        """
    )
