"""comments threading + mentions + notifications.

Revision ID: 0009_comments_threading
Revises: 0008_bookmarks
Create Date: 2026-05-08 16:00:00

`parent_id` 는 0006 에서 이미 추가됐다. 이 마이그레이션은 그 위에:

  1. comments.mention_user_ids JSONB[]  — '@melon' 멘션 대상 UUID 배열.
  2. notifications 테이블          — 멘션 시 row 1개 INSERT.

기존 `idx_comments_parent_id` 인덱스도 0006 에서 같이 생성됐으므로
여기서는 다시 만들지 않는다.

down_revision 은 0008_bookmarks (J2) 이후가 되도록 체인해 multi-head
상황을 피한다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0009_comments_threading"
down_revision: str | Sequence[str] | None = "0008_bookmarks"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1) mention_user_ids: JSONB array of UUID strings.
    #    NULL 보다 빈 배열이 깔끔해서 NOT NULL DEFAULT '[]' 로 둔다.
    op.execute("""
        ALTER TABLE comments
          ADD COLUMN mention_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb
    """)

    # 1b) status CHECK 에 'resolved' 추가 — 스레드 단위 해결 표시.
    op.execute("ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_status_check")
    op.execute("""
        ALTER TABLE comments
          ADD CONSTRAINT comments_status_check
          CHECK (status IN ('visible','hidden','deleted','resolved'))
    """)

    # 2) notifications 테이블 (BE 푸시 알림 — 클라이언트 store 와 별개).
    op.execute("""
        CREATE TABLE notifications (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          kind        TEXT NOT NULL CHECK (kind IN ('comment_mention','comment_reply')),
          payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
          read_at     TIMESTAMPTZ,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute(
        "CREATE INDEX idx_notifications_user_unread "
        "ON notifications(user_id, read_at) "
        "WHERE read_at IS NULL"
    )
    op.execute(
        "CREATE INDEX idx_notifications_user_created "
        "ON notifications(user_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS notifications CASCADE")
    # 'resolved' 상태가 남아있으면 다시 visible 로 되돌리고 CHECK 복구.
    op.execute("UPDATE comments SET status='visible' WHERE status='resolved'")
    op.execute("ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_status_check")
    op.execute("""
        ALTER TABLE comments
          ADD CONSTRAINT comments_status_check
          CHECK (status IN ('visible','hidden','deleted'))
    """)
    op.execute("ALTER TABLE comments DROP COLUMN IF EXISTS mention_user_ids")
