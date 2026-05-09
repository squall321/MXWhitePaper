"""automation_rules — cron-style scheduled triggers (Cycle 15 U4).

Extends the event-driven automation engine (Cycle 0025) with **time-driven**
triggers. A rule with ``trigger_kind='cron'`` carries a ``cron_expression``
(5-field standard cron) and a precomputed ``next_cron_run_at`` timestamp.

The new ``automation_cron`` ticker (asyncio in-process, every 30s) finds rows
whose ``next_cron_run_at <= NOW()``, dispatches the rule via the existing
``automation_dispatcher.run_rule`` (kind='cron'), then advances
``next_cron_run_at`` to the next firing time.

Schema delta:
  - widen ``automation_rules.trigger_kind`` CHECK to admit ``'cron'``
  - new ``cron_expression TEXT NULL``
  - new ``next_cron_run_at TIMESTAMPTZ NULL``
  - new partial index on ``next_cron_run_at`` for the ticker sweep

This migration also acts as a **merge** of the parallel heads
``0029_quiz_attempts`` and ``0030_saved_views`` (shipped in adjacent
cycles by sibling agents) so the chain returns to a single tip.

Reversible — downgrade restores the prior CHECK, drops the new columns/index,
and explicitly deletes any cron rows beforehand so the CHECK doesn't blow up
mid-migration on lingering data.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0031_automation_cron"
# Merge revision — two parallel heads exist alongside our changes.
down_revision: str | Sequence[str] | None = (
    "0029_quiz_attempts",
    "0030_saved_views",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE automation_rules "
        "ADD COLUMN cron_expression TEXT NULL"
    )
    op.execute(
        "ALTER TABLE automation_rules "
        "ADD COLUMN next_cron_run_at TIMESTAMPTZ NULL"
    )
    op.execute(
        "ALTER TABLE automation_rules "
        "DROP CONSTRAINT IF EXISTS automation_rules_trigger_kind_check"
    )
    op.execute(
        """
        ALTER TABLE automation_rules ADD CONSTRAINT
          automation_rules_trigger_kind_check
        CHECK (trigger_kind IN (
          'doc_published','doc_archived','review_decided',
          'status_transition','comment_added','tag_added','cron'
        ))
        """
    )
    op.execute(
        "CREATE INDEX idx_automation_rules_cron_next "
        "ON automation_rules(next_cron_run_at) "
        "WHERE trigger_kind = 'cron' AND enabled = true"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_automation_rules_cron_next")
    # Strip any cron rules so the narrowed CHECK constraint accepts the data.
    op.execute("DELETE FROM automation_rules WHERE trigger_kind = 'cron'")
    op.execute(
        "ALTER TABLE automation_rules "
        "DROP CONSTRAINT IF EXISTS automation_rules_trigger_kind_check"
    )
    op.execute(
        """
        ALTER TABLE automation_rules ADD CONSTRAINT
          automation_rules_trigger_kind_check
        CHECK (trigger_kind IN (
          'doc_published','doc_archived','review_decided',
          'status_transition','comment_added','tag_added'
        ))
        """
    )
    op.execute(
        "ALTER TABLE automation_rules DROP COLUMN IF EXISTS next_cron_run_at"
    )
    op.execute(
        "ALTER TABLE automation_rules DROP COLUMN IF EXISTS cron_expression"
    )
