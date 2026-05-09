"""share_links.short_id — 6-char Crockford-base32 alias for share tokens.

Revision ID: 0022_share_short_id
Revises: 0021_reactions
Create Date: 2026-05-09 13:00:00

Cycle 8 ships a QR code beside each share link in the modal. The token
itself is a ~32-char `secrets.token_urlsafe(24)` string — fine for
clipboards, but unwieldy on a phone. This migration adds a short,
human-readable alias so we can later expose `/share/short/:short_id`
which 302s to `/share/:token`.

  - 6-char Crockford-base32 (avoids I, L, O, U → less ambiguous on phones)
  - 30 random bits → ~1B values, plenty of room with retry-on-collision
  - NULL means "legacy row, no alias" — partial unique index keeps
    duplicates only when the column is set

Reversible: downgrade drops the index + column.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0022_share_short_id"
down_revision: str | Sequence[str] | None = "0021_reactions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE share_links ADD COLUMN short_id TEXT NULL")
    op.execute(
        "CREATE UNIQUE INDEX idx_share_links_short_id "
        "ON share_links(short_id) WHERE short_id IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_share_links_short_id")
    op.execute("ALTER TABLE share_links DROP COLUMN IF EXISTS short_id")
