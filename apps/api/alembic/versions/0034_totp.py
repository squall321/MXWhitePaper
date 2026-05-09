"""totp — two-factor authentication via TOTP (Cycle 17).

Adds three columns on ``users`` to support optional TOTP-based 2FA
(RFC 6238, Google Authenticator compatible):

  - ``totp_secret``        TEXT NULL — base32-encoded shared secret. NULL
                           means 2FA is not configured.
  - ``totp_enabled_at``    TIMESTAMPTZ NULL — when the user successfully
                           verified the first code and 2FA was activated.
                           NULL = staged or not yet enabled. Login flow
                           gates on this column (NOT on ``totp_secret``)
                           so abandoned setups don't lock anyone out.
  - ``totp_backup_codes``  JSONB NOT NULL DEFAULT '[]' — list of argon2
                           hashes for 8 single-use backup codes. Each
                           entry is consumed by writing it back as the
                           literal string "USED" (to preserve list
                           length and avoid a separate audit table).

Reversible. Downgrade drops all three columns.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0034_totp"
down_revision: str | Sequence[str] | None = "0033_version_tags"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT NULL"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "totp_enabled_at TIMESTAMPTZ NULL"
    )
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes JSONB "
        "NOT NULL DEFAULT '[]'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_backup_codes")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled_at")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS totp_secret")
