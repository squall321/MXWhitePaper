"""audit_retention — admin-tunable retention for `audit_logs` (Cycle 0032).

Audit logs grow unbounded. Cycle 11 Q1 added the admin viewer; this cycle
adds the prune side. A single-row `audit_retention_config` table holds the
operator-tunable knobs (`retain_days`, `enabled`) plus run telemetry
(`last_run_at`, `rows_pruned_total`). A 24h asyncio ticker
(`audit_pruner`) consumes the row and DELETEs `audit_logs` rows older
than `retain_days`.

Mirrors `retention_policies` (Cycle 0027) shape-wise but the prune target
is `audit_logs` (single fixed table) instead of `documents`, so the
policy collapses to a single-row config.

Reversible — downgrade drops the table.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0032_audit_retention"
down_revision: str | Sequence[str] | None = "0031_automation_cron"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE audit_retention_config (
          id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          retain_days       INT NOT NULL DEFAULT 365
                                CHECK (retain_days > 0),
          enabled           BOOLEAN NOT NULL DEFAULT TRUE,
          last_run_at       TIMESTAMPTZ NULL,
          rows_pruned_total BIGINT NOT NULL DEFAULT 0,
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    # Seed the singleton row. Default retention = 365 days (typical legal
    # hold window). Operators tune via PATCH /admin/audit-retention.
    op.execute(
        "INSERT INTO audit_retention_config (id, retain_days) VALUES (1, 365)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_retention_config")
