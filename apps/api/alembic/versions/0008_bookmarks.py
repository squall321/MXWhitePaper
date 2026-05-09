"""bookmarks + document_reads — server-persisted reading list.

Revision ID: 0008_bookmarks
Revises: 0007_files
Create Date: 2026-05-08 16:00:00

`bookmarks` 는 유저별 문서 책갈피이며 `folder` 텍스트 컬럼으로 임의 그룹핑이
가능하다 (NULL = "default"). `document_reads` 는 실제 열람 기록 — read_seconds
를 누적해 "이 문서를 얼마나 읽었는가" 를 추적한다 (FE 가 30초마다 flush).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0008_bookmarks"
down_revision: str | Sequence[str] | None = "0007_files"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE bookmarks (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          folder       TEXT,
          notes        TEXT,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, document_id)
        )
    """)
    op.execute("CREATE INDEX idx_bookmarks_user ON bookmarks(user_id)")

    op.execute("""
        CREATE TABLE document_reads (
          user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          document_id   UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          read_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          read_seconds  INT NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, document_id)
        )
    """)
    op.execute("CREATE INDEX idx_document_reads_user_read_at ON document_reads(user_id, read_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS document_reads CASCADE")
    op.execute("DROP TABLE IF EXISTS bookmarks CASCADE")
