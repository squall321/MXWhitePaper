"""images_pending — staging table for two-phase image upload (init/finalize)

Revision ID: 0003_images_pending
Revises: 0002_search_view
Create Date: 2026-05-07 09:00:00

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0003_images_pending"
down_revision: str | Sequence[str] | None = "0002_search_view"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # init 단계에서 발급한 ULID 와 메타를 임시로 저장.
    # finalize 시 사이즈/sha256 검증 + 매 호출마다 만료된 행 정리.
    op.execute("""
        CREATE TABLE images_pending (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          upload_id   TEXT UNIQUE NOT NULL,
          uploader_id UUID NOT NULL REFERENCES users(id),
          filename    TEXT NOT NULL,
          mime_type   TEXT NOT NULL,
          sha256      CHAR(64) NOT NULL,
          size_bytes  BIGINT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at  TIMESTAMPTZ NOT NULL
        )
    """)
    op.execute("CREATE INDEX idx_images_pending_upload_id ON images_pending(upload_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS images_pending CASCADE")
