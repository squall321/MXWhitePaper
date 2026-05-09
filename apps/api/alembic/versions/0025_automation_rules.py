"""automation_rules — workflow automation (Cycle 0025).

A configurable rules engine that fires actions in response to document
events. Sits on top of the existing webhooks system (Cycle 0014) and
subscriptions (Cycle 0018) but is more general — admins compose
``trigger × action`` pairs via the UI rather than wiring code per case.

Tables:
  - ``automation_rules``      — rule definitions (trigger + action + filter)
  - ``automation_run_log``    — append-only execution log per rule fire

This migration is a *merge* of the two parallel heads ``0023_api_tokens``
and ``0023_read_acks`` so subsequent revisions have a single tip.

Reversible — downgrade drops both tables (CASCADE).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0025_automation_rules"
# Merge revision — two parallel heads existed at 0023.
down_revision: str | Sequence[str] | None = (
    "0023_api_tokens",
    "0023_read_acks",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Allow `automation_blast` as a notifications.kind so the
    # `notification_blast` action can insert rows. Reuses the canonical
    # CHECK shape from 0021.
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
          'automation_blast'
        ))
        """
    )

    op.execute(
        """
        CREATE TABLE automation_rules (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name            TEXT NOT NULL,
          trigger_kind    TEXT NOT NULL CHECK (trigger_kind IN (
              'doc_published','doc_archived','review_decided',
              'status_transition','comment_added','tag_added'
          )),
          trigger_filter  JSONB NOT NULL DEFAULT '{}'::jsonb,
          action_kind     TEXT NOT NULL CHECK (action_kind IN (
              'webhook','notification_blast','add_tag','remove_tag',
              'transition','email_subscribers'
          )),
          action_payload  JSONB NOT NULL DEFAULT '{}'::jsonb,
          enabled         BOOLEAN NOT NULL DEFAULT TRUE,
          created_by      UUID NOT NULL REFERENCES users(id),
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_fired_at   TIMESTAMPTZ NULL,
          fire_count      INT NOT NULL DEFAULT 0
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_automation_rules_trigger "
        "ON automation_rules(trigger_kind, enabled)"
    )

    op.execute(
        """
        CREATE TABLE automation_run_log (
          id               BIGSERIAL PRIMARY KEY,
          rule_id          UUID NOT NULL REFERENCES automation_rules(id)
                              ON DELETE CASCADE,
          triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          trigger_payload  JSONB NOT NULL,
          status           TEXT NOT NULL CHECK (status IN (
              'ok','failed','skipped'
          )),
          error_message    TEXT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_automation_log_rule_time "
        "ON automation_run_log(rule_id, triggered_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_automation_log_rule_time")
    op.execute("DROP TABLE IF EXISTS automation_run_log CASCADE")
    op.execute("DROP INDEX IF EXISTS idx_automation_rules_trigger")
    op.execute("DROP TABLE IF EXISTS automation_rules CASCADE")
    # Restore the previous notifications.kind CHECK shape (sans automation_blast).
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
          'reaction_added'
        ))
        """
    )
