"""auth_tokens — email verification + password reset tokens (Cycle 0026).

Adds:
  - ``users.email_verified_at`` — TIMESTAMPTZ, NULL when unverified.
  - ``auth_tokens`` — short-lived single-use tokens for ``email_verify`` and
    ``password_reset`` flows. Plaintext is hashed with argon2 (same scheme as
    api_tokens / users.password_hash); only the hash is persisted.

Reversible — downgrade drops the table + indexes and removes the column.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0026_auth_tokens"
down_revision: str | Sequence[str] | None = "0025_automation_rules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL"
    )
    op.execute(
        """
        CREATE TABLE auth_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('email_verify', 'password_reset')),
          token_hash TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_auth_tokens_kind_expiry ON auth_tokens(kind, expires_at)"
    )
    op.execute(
        "CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id, kind)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_auth_tokens_user")
    op.execute("DROP INDEX IF EXISTS idx_auth_tokens_kind_expiry")
    op.execute("DROP TABLE IF EXISTS auth_tokens CASCADE")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at")
