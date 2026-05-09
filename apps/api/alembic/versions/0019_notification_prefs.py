"""notification preferences — per-event-per-channel toggles (Cycle 0019).

Adds `users.notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb`. Empty `{}` is
treated as "use defaults" by the BE helper so that legacy users get the same
notification behaviour they had before this migration.

Downgrade is fully reversible — drops the column.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0019_notification_prefs"
down_revision: str | Sequence[str] | None = "0018_subscriptions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users "
        "ADD COLUMN notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS notification_prefs")
