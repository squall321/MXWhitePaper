"""api_tokens — per-user personal access tokens (Cycle 0023).

Users mint tokens to give scripts/CI access to the JSON API without sharing
their JWT (which expires) or password. Tokens are stored as argon2 hashes —
the plaintext is shown ONLY once at create/rotate time.

  - `token_prefix` is the first 8 chars after the `mxwp_` namespace and is
    indexed so the auth middleware can look up the row without a full scan.
    The remaining bytes are matched via argon2 against `token_hash`.
  - `scopes` is a JSONB list of allowed verbs ('read', 'write', 'admin').
    Enforcement is deferred — see TODO in routers/api_tokens.py.
  - `expires_at` and `revoked_at` are both NULL for live tokens. Auth
    middleware rejects on either being in the past or set respectively.
  - UNIQUE (user_id, name) so a user can't have two tokens with the same
    label. Not application-critical, but stops accidental re-use.

Reversible: downgrade drops the table and indexes.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0023_api_tokens"
down_revision: str | Sequence[str] | None = "0022_share_short_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE api_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          token_prefix TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
          last_used_at TIMESTAMPTZ NULL,
          expires_at TIMESTAMPTZ NULL,
          revoked_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, name)
        )
    """)
    op.execute("CREATE INDEX idx_api_tokens_user ON api_tokens(user_id)")
    op.execute("CREATE INDEX idx_api_tokens_prefix ON api_tokens(token_prefix)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_api_tokens_prefix")
    op.execute("DROP INDEX IF EXISTS idx_api_tokens_user")
    op.execute("DROP TABLE IF EXISTS api_tokens CASCADE")
