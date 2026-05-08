"""comments — linear thread per document/section/block (Tier 2C).

Revision ID: 0006_comments
Revises: 0005_admin_dashboard
Create Date: 2026-05-08 12:00:00

`comments` 테이블은 anchor_kind in ('document','section','block') 으로
범위를 가지며, parent_id 로 reply 트리를 구성한다. 삭제는 soft delete
(`status='deleted'`) 로 처리해 reply 체인이 끊기지 않도록 한다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0006_comments"
down_revision: str | Sequence[str] | None = "0005_admin_dashboard"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE comments (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          anchor_kind  TEXT NOT NULL CHECK (anchor_kind IN ('document','section','block')),
          anchor_id    TEXT,
          body_md      TEXT NOT NULL,
          author_id    UUID NOT NULL REFERENCES users(id),
          parent_id    UUID REFERENCES comments(id) ON DELETE SET NULL,
          status       TEXT NOT NULL DEFAULT 'visible'
                       CHECK (status IN ('visible','hidden','deleted')),
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_comments_document_id ON comments(document_id)")
    op.execute("CREATE INDEX idx_comments_parent_id   ON comments(parent_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS comments CASCADE")
