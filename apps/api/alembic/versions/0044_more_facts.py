"""Additional fact tables for the full widget set.

Tables:
  - cohort_retention   per-cohort retention curve (cohort_label, day_offset, pct)
  - funnel_metrics     conversion funnel (step_label, users, sort)
  - audit_summary_daily   per-day audit-event counts (already aggregated)
  - incidents_log      operational incidents (severity, status, owner, duration)
  - marketing_campaigns campaign-level KPIs (impressions, clicks, conversions)
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0044_more_facts"
down_revision: str | Sequence[str] | None = "0043_export_artifacts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE cohort_retention (
          cohort_label TEXT NOT NULL,           -- '2025-Q4', '2026-01' etc.
          day_offset   INT  NOT NULL,           -- 0, 1, 7, 14, 30, 60, 90
          retention_pct NUMERIC(5,2) NOT NULL,
          PRIMARY KEY (cohort_label, day_offset)
        )
    """)

    op.execute("""
        CREATE TABLE funnel_metrics (
          funnel_key TEXT NOT NULL,             -- 'signup-to-active' etc.
          step_label TEXT NOT NULL,
          users      INT  NOT NULL,
          sort_order INT  NOT NULL,
          PRIMARY KEY (funnel_key, step_label)
        )
    """)

    op.execute("""
        CREATE TABLE audit_summary_daily (
          day        DATE NOT NULL,
          event_kind TEXT NOT NULL,             -- 'login', 'doc_edit', 'search', etc.
          count      INT  NOT NULL,
          PRIMARY KEY (day, event_kind)
        )
    """)
    op.execute("CREATE INDEX ix_audit_summary_day ON audit_summary_daily(day DESC)")

    op.execute("""
        CREATE TABLE incidents_log (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          incident_id TEXT UNIQUE NOT NULL,     -- 'INC-2026-001' etc.
          severity    TEXT NOT NULL,            -- 'P1' | 'P2' | 'P3' | 'P4'
          status      TEXT NOT NULL,            -- 'open' | 'mitigated' | 'resolved'
          title       TEXT NOT NULL,
          owner       TEXT,
          duration_min INT,                     -- minutes from open to resolved
          started_at  TIMESTAMPTZ NOT NULL,
          resolved_at TIMESTAMPTZ
        )
    """)

    op.execute("""
        CREATE TABLE marketing_campaigns (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          campaign_id   TEXT UNIQUE NOT NULL,
          name          TEXT NOT NULL,
          status        TEXT NOT NULL,          -- 'active' | 'paused' | 'ended'
          impressions   INT NOT NULL DEFAULT 0,
          clicks        INT NOT NULL DEFAULT 0,
          conversions   INT NOT NULL DEFAULT 0,
          spent         NUMERIC(14,2) NOT NULL DEFAULT 0,
          started_at    DATE NOT NULL,
          ended_at      DATE
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS marketing_campaigns")
    op.execute("DROP TABLE IF EXISTS incidents_log")
    op.execute("DROP TABLE IF EXISTS audit_summary_daily")
    op.execute("DROP TABLE IF EXISTS funnel_metrics")
    op.execute("DROP TABLE IF EXISTS cohort_retention")
