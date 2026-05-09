"""automation_rules.cron_timezone — per-rule IANA tz for cron triggers.

Cycle 17 W4 follow-up. Cron rules previously fired in UTC only; ops asked
for ``Asia/Seoul`` (and other regional offsets) so business-hours digests
land at the right local time.

Schema delta:
  - new ``cron_timezone TEXT NOT NULL DEFAULT 'UTC'`` — IANA name; we don't
    enforce a CHECK because the parsing site (Python ``zoneinfo.ZoneInfo``)
    is the source of truth and a CHECK on a finite list would rot every
    time the IANA db ships a new zone.

The cron ticker (``automation_cron.tick_once``) reads this column and
passes ``ZoneInfo(rule['cron_timezone'])`` to ``cron_parser.next_run`` so
the schedule advances in the rule's local time. ``parse_cron`` itself is
timezone-agnostic — only ``next_run`` consumes the tz.

Reversible — downgrade drops the column.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0037_cron_timezone"
# 0036 is intentionally unused — the brief reserved 0037 for this slot so
# parallel branches could land 0036 if needed. Skipping a number is fine
# for alembic; it walks the down_revision graph, not the filename.
down_revision: str | Sequence[str] | None = "0035_workflow_chains"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE automation_rules "
        "ADD COLUMN cron_timezone TEXT NOT NULL DEFAULT 'UTC'"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE automation_rules DROP COLUMN IF EXISTS cron_timezone"
    )
