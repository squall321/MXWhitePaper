"""widget_fact_tables — backing data for widgets.

Replaces the hardcoded mock arrays in ``app/routers/widgets.py`` with
real tables that widget handlers can query. Three fact tables:

  - ``sales_daily``       per-day revenue + expense per team
  - ``region_metrics``    region-level rollup (revenue / qoq / share)
  - ``kpi_snapshots``     key indicators captured at a point in time

Seed data lives in ``app/scripts/seed_widget_facts.py``; this migration
only creates the schema.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0040_widget_fact_tables"
down_revision: str | Sequence[str] | None = "0039_sso_providers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE sales_daily (
          day         DATE        NOT NULL,
          team        TEXT        NOT NULL,
          revenue     NUMERIC(14,2) NOT NULL,
          expense     NUMERIC(14,2) NOT NULL,
          PRIMARY KEY (day, team)
        )
        """
    )
    op.execute("CREATE INDEX ix_sales_daily_team ON sales_daily(team)")
    op.execute("CREATE INDEX ix_sales_daily_day  ON sales_daily(day DESC)")

    op.execute(
        """
        CREATE TABLE region_metrics (
          region          TEXT        NOT NULL,
          period          TEXT        NOT NULL,         -- '2026-Q1' etc.
          revenue         NUMERIC(14,2) NOT NULL,
          qoq_pct         NUMERIC(6,2)  NOT NULL,        -- quarter-over-quarter %
          share_pct       NUMERIC(6,2)  NOT NULL,        -- % of total
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (region, period)
        )
        """
    )

    op.execute(
        """
        CREATE TABLE kpi_snapshots (
          key             TEXT        NOT NULL,         -- 'finance.daily.revenue' etc
          captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          value           NUMERIC(14,2) NOT NULL,
          delta_pct       NUMERIC(6,2),                  -- vs previous period
          trend           TEXT,                          -- 'up' | 'down' | 'flat'
          meta            JSONB,
          PRIMARY KEY (key, captured_at)
        )
        """
    )
    op.execute("CREATE INDEX ix_kpi_snapshots_key ON kpi_snapshots(key, captured_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS kpi_snapshots")
    op.execute("DROP TABLE IF EXISTS region_metrics")
    op.execute("DROP TABLE IF EXISTS sales_daily")
