"""launch_facts — DB tables backing product launch sample (06).

Replaces the hardcoded inline Gantt tasks / timeline / demand forecast
in `samples/06-product-launch-plan.json` with DB rows.

Tables:
  - launch_tasks       Gantt chart (task, start, end, progress%, owner)
  - launch_timeline    week-by-week (week, activity, owner, deliverable)
  - demand_forecast    quarterly (quarter, scenario, units)

Each row has a `program_slug` so multiple launches can coexist.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0041_launch_facts"
down_revision: str | Sequence[str] | None = "0040_widget_fact_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE launch_tasks (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          program_slug  TEXT NOT NULL,
          task          TEXT NOT NULL,
          start_date    DATE NOT NULL,
          end_date      DATE NOT NULL,
          progress_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
          owner         TEXT,
          sort_order    INT  NOT NULL DEFAULT 0,
          UNIQUE (program_slug, task)
        )
        """
    )
    op.execute("CREATE INDEX ix_launch_tasks_program ON launch_tasks(program_slug, sort_order)")

    op.execute(
        """
        CREATE TABLE launch_timeline (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          program_slug  TEXT NOT NULL,
          week_label    TEXT NOT NULL,
          activity      TEXT NOT NULL,
          owner         TEXT,
          deliverable   TEXT,
          sort_order    INT  NOT NULL DEFAULT 0,
          UNIQUE (program_slug, week_label, activity)
        )
        """
    )
    op.execute("CREATE INDEX ix_launch_timeline_program ON launch_timeline(program_slug, sort_order)")

    op.execute(
        """
        CREATE TABLE demand_forecast (
          program_slug  TEXT NOT NULL,
          quarter       TEXT NOT NULL,
          scenario      TEXT NOT NULL,    -- baseline | bull | bear
          units         NUMERIC(14,2) NOT NULL,
          PRIMARY KEY (program_slug, quarter, scenario)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS demand_forecast")
    op.execute("DROP TABLE IF EXISTS launch_timeline")
    op.execute("DROP TABLE IF EXISTS launch_tasks")
