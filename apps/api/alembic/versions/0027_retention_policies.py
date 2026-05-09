"""retention_policies — time-driven document retention rules (Cycle 0027).

A configurable time-based janitor that complements automation_rules
(Cycle 0025, event-driven). Admins compose
``trigger_age × scope_filter × action`` records that an in-process
ticker (`retention_runner`) walks once an hour. Sits next to
``backup_schedules`` (Cycle 0015) cadence-wise but its own table because
the data shape — age + scope filter + action — is unrelated.

Tables:
  - ``retention_policies`` — rule definitions (scope filter + age + action)
  - ``retention_runs``     — append-only execution log per policy fire

Adds the ``retention_warning`` notifications.kind so the ``notify_owner``
action can insert rows.

Reversible — downgrade drops both tables (CASCADE) and shrinks the
notifications.kind CHECK back to the cycle-0026 shape.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0027_retention_policies"
down_revision: str | Sequence[str] | None = "0026_auth_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Allow `retention_warning` as a notifications.kind so the
    # `notify_owner` retention action can insert rows.
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

    op.execute(
        """
        CREATE TABLE retention_policies (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name              TEXT NOT NULL,
          scope_filter      JSONB NOT NULL DEFAULT '{}'::jsonb,
          action            TEXT NOT NULL CHECK (action IN (
              'archive', 'notify_owner', 'transition'
          )),
          action_payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
          trigger_age_days  INT NOT NULL CHECK (trigger_age_days > 0),
          trigger_field     TEXT NOT NULL CHECK (trigger_field IN (
              'updated_at', 'last_read_at', 'created_at'
          )),
          enabled           BOOLEAN NOT NULL DEFAULT TRUE,
          last_run_at       TIMESTAMPTZ NULL,
          next_run_at       TIMESTAMPTZ NULL,
          created_by        UUID NOT NULL REFERENCES users(id),
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_retention_policies_enabled_next "
        "ON retention_policies(enabled, next_run_at) "
        "WHERE enabled = true"
    )

    op.execute(
        """
        CREATE TABLE retention_runs (
          id                  BIGSERIAL PRIMARY KEY,
          policy_id           UUID NOT NULL REFERENCES retention_policies(id)
                                 ON DELETE CASCADE,
          run_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          affected_doc_count  INT NOT NULL,
          status              TEXT NOT NULL CHECK (status IN (
              'ok', 'failed', 'dry_run'
          )),
          error_message       TEXT NULL,
          doc_slugs           JSONB NOT NULL DEFAULT '[]'::jsonb
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_retention_runs_policy "
        "ON retention_runs(policy_id, run_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_retention_runs_policy")
    op.execute("DROP TABLE IF EXISTS retention_runs CASCADE")
    op.execute("DROP INDEX IF EXISTS idx_retention_policies_enabled_next")
    op.execute("DROP TABLE IF EXISTS retention_policies CASCADE")

    # Restore the previous notifications.kind CHECK shape (sans retention_warning).
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
