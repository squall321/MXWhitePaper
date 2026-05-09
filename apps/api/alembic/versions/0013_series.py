"""series — document series / book navigation.

Revision ID: 0013_series
Revises: 0012_approvals
Create Date: 2026-05-09 18:00:00

Introduces:
  - `doc_series`        — one row per series (책 / 시리즈). slug is unique so
    the public URL is stable.
  - `doc_series_items`  — ordered membership: (series_id, document_id) is the
    PK so a doc can't appear twice in the same series; `position` orders.

Downgrade is fully reversible — both tables are dropped.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0013_series"
down_revision: str | Sequence[str] | None = "0012_approvals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE doc_series (
          id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug            TEXT UNIQUE NOT NULL,
          title           TEXT NOT NULL,
          description     TEXT NULL,
          cover_image_id  TEXT NULL,
          owner_user_id   UUID NOT NULL REFERENCES users(id),
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE TABLE doc_series_items (
          series_id    UUID NOT NULL REFERENCES doc_series(id) ON DELETE CASCADE,
          document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          position     INT NOT NULL,
          added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (series_id, document_id)
        )
    """)
    op.execute(
        "CREATE INDEX idx_series_items_position "
        "ON doc_series_items(series_id, position)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS doc_series_items CASCADE")
    op.execute("DROP TABLE IF EXISTS doc_series CASCADE")
