"""share_links — public document share with optional expiry/password.

Revision ID: 0011_share_links
Revises: 0010_snippets
Create Date: 2026-05-09 12:00:00

A `share_links` row publishes a single document at `/share/:token`. The token
is a `secrets.token_urlsafe(24)` value (≈32 url-safe characters). Optional
fields:

  - `expires_at` — link returns 410 once `NOW() > expires_at`.
  - `password_hash` — argon2-style hash of the share password; the public GET
     requires the plain password (header or query) and returns 401 until it
     matches.
  - `revoked_at` — soft revoke. The row stays around for audit; the GET
     endpoint returns 410 once it's set.

`view_count` is incremented on every successful public read (including reads
that come back through the password gate). It surfaces in the share manager
modal as a "이 링크는 N번 열렸습니다" hint.

Reversible: downgrade drops the table.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0011_share_links"
down_revision: str | Sequence[str] | None = "0010_snippets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE share_links (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          token           TEXT NOT NULL UNIQUE,
          document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          created_by      UUID NOT NULL REFERENCES users(id),
          expires_at      TIMESTAMPTZ NULL,
          password_hash   TEXT NULL,
          view_count      INT NOT NULL DEFAULT 0,
          revoked_at      TIMESTAMPTZ NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_share_links_doc ON share_links(document_id)")
    op.execute("CREATE INDEX idx_share_links_token ON share_links(token)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS share_links CASCADE")
