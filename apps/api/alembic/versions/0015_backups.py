"""backups — scheduled backups + run history.

Revision ID: 0015_backups
Revises: 0013_series
Create Date: 2026-05-09 19:00:00

Introduces:
  - `backup_schedules` — recurring backup definitions (full / user / doc).
    `cadence` is daily|weekly|monthly, `hour_utc` is 0..23. `format` selects
    the export renderer (json/html/md/docx/pptx).
  - `backup_runs` — per-execution audit row referencing the schedule (or
    NULL for ad-hoc admin "run-now"). Stores MinIO key, size, doc count,
    and final status.

Downgrade is fully reversible — both tables and the index are dropped.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0015_backups"
down_revision: str | Sequence[str] | None = "0014_webhooks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE backup_schedules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          scope TEXT NOT NULL CHECK (scope IN ('full', 'user', 'doc')),
          cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
          hour_utc INT NOT NULL DEFAULT 3,
          format TEXT NOT NULL CHECK (format IN ('json', 'html', 'md', 'docx', 'pptx')),
          target_user_id UUID NULL REFERENCES users(id),
          target_doc_slug TEXT NULL,
          enabled BOOLEAN NOT NULL DEFAULT true,
          last_run_at TIMESTAMPTZ NULL,
          next_run_at TIMESTAMPTZ NULL,
          created_by UUID NOT NULL REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE TABLE backup_runs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          schedule_id UUID NULL REFERENCES backup_schedules(id) ON DELETE SET NULL,
          scope TEXT NOT NULL,
          format TEXT NOT NULL,
          storage_key TEXT NOT NULL,
          size_bytes BIGINT NOT NULL,
          doc_count INT NULL,
          status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
          error_message TEXT NULL,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          finished_at TIMESTAMPTZ NULL
        )
    """)
    op.execute(
        "CREATE INDEX idx_backup_runs_started ON backup_runs(started_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_backup_runs_started")
    op.execute("DROP TABLE IF EXISTS backup_runs CASCADE")
    op.execute("DROP TABLE IF EXISTS backup_schedules CASCADE")
