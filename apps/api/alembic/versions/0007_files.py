"""files — generic file attachment table for FileBlock uploads.

Revision ID: 0007_files
Revises: 0006_comments
Create Date: 2026-05-08 14:00:00

이미지와 동일한 2-phase presigned-PUT 패턴이지만, EXIF/리사이즈가 없으므로
별도 테이블로 단순하게 보관한다. id 는 ULID(TEXT, 26자) 를 PK 로 사용해
DocumentJSON 의 FileBlock.fileId(Ulid) 와 1:1 로 매핑된다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0007_files"
down_revision: str | Sequence[str] | None = "0006_comments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE files (
          id              TEXT PRIMARY KEY,
          owner_user_id   UUID NOT NULL REFERENCES users(id),
          filename        TEXT NOT NULL,
          mime            TEXT NOT NULL,
          size_bytes      BIGINT NOT NULL,
          storage_key     TEXT NOT NULL,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_files_owner_user_id ON files(owner_user_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS files CASCADE")
