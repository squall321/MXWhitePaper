"""workflow_chains — multi-step automation chains (Cycle 18).

Cycle 15/17 fired ONE action per trigger. This migration adds the
ability to compose ordered sequences of actions, each with its own
delay + fail strategy:

  - ``workflow_chains``        — chain definition (name, enabled, audit)
  - ``workflow_chain_steps``   — ordered steps; either reuse an existing
                                  ``automation_rules`` row OR pin an
                                  inline ``action_kind``/``action_payload``
                                  pair. ``CHECK`` enforces XOR.
  - ``workflow_chain_runs``    — append-only execution log per chain fire.

Chains are explicitly fired through the existing automation_dispatcher
via a new ``action_kind = 'trigger_chain'`` entry (no implicit recursion).

Reversible — downgrade drops all three tables (CASCADE).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0035_workflow_chains"
down_revision: str | Sequence[str] | None = "0034_totp"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The automation_rules.action_kind CHECK from 0025 doesn't allow
    # ``trigger_chain``. Widen it so a rule can fan out to a chain.
    op.execute(
        "ALTER TABLE automation_rules "
        "DROP CONSTRAINT IF EXISTS automation_rules_action_kind_check"
    )
    op.execute(
        """
        ALTER TABLE automation_rules
        ADD CONSTRAINT automation_rules_action_kind_check
        CHECK (action_kind IN (
          'webhook','notification_blast','add_tag','remove_tag',
          'transition','email_subscribers','trigger_chain'
        ))
        """
    )

    op.execute(
        """
        CREATE TABLE workflow_chains (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name         TEXT NOT NULL,
          description  TEXT NULL,
          enabled      BOOLEAN NOT NULL DEFAULT TRUE,
          created_by   UUID NOT NULL REFERENCES users(id),
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )

    op.execute(
        """
        CREATE TABLE workflow_chain_steps (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chain_id        UUID NOT NULL REFERENCES workflow_chains(id)
                            ON DELETE CASCADE,
          ordering        INT NOT NULL,
          rule_id         UUID NULL REFERENCES automation_rules(id)
                            ON DELETE SET NULL,
          action_kind     TEXT NULL,
          action_payload  JSONB NOT NULL DEFAULT '{}'::jsonb,
          delay_seconds   INT NOT NULL DEFAULT 0,
          fail_strategy   TEXT NOT NULL DEFAULT 'halt'
                            CHECK (fail_strategy IN ('halt','continue','rollback')),
          CONSTRAINT chain_step_action_xor
            CHECK ((rule_id IS NULL) != (action_kind IS NULL))
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_chain_steps "
        "ON workflow_chain_steps(chain_id, ordering)"
    )

    op.execute(
        """
        CREATE TABLE workflow_chain_runs (
          id               BIGSERIAL PRIMARY KEY,
          chain_id         UUID NOT NULL REFERENCES workflow_chains(id)
                              ON DELETE CASCADE,
          triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          trigger_payload  JSONB NOT NULL,
          status           TEXT NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running','ok','failed','rolled_back')),
          steps_completed  INT NOT NULL DEFAULT 0,
          steps_failed     INT NOT NULL DEFAULT 0,
          finished_at      TIMESTAMPTZ NULL,
          error_message    TEXT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_workflow_chain_runs "
        "ON workflow_chain_runs(chain_id, triggered_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_workflow_chain_runs")
    op.execute("DROP TABLE IF EXISTS workflow_chain_runs CASCADE")
    op.execute("DROP INDEX IF EXISTS idx_workflow_chain_steps")
    op.execute("DROP TABLE IF EXISTS workflow_chain_steps CASCADE")
    op.execute("DROP TABLE IF EXISTS workflow_chains CASCADE")
    # Restore the previous automation_rules.action_kind CHECK shape.
    op.execute(
        "ALTER TABLE automation_rules "
        "DROP CONSTRAINT IF EXISTS automation_rules_action_kind_check"
    )
    op.execute(
        """
        ALTER TABLE automation_rules
        ADD CONSTRAINT automation_rules_action_kind_check
        CHECK (action_kind IN (
          'webhook','notification_blast','add_tag','remove_tag',
          'transition','email_subscribers'
        ))
        """
    )
