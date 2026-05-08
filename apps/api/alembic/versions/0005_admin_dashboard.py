"""admin dashboard + analytics — users.last_login_at + audit_logs(action) index

Revision ID: 0005_admin_dashboard
Revises: 0004_image_ulid
Create Date: 2026-05-08 09:00:00

Tier 2D 가 필요로 하는 운영/분석용 컬럼·인덱스만 추가.

  1) users.last_login_at TIMESTAMPTZ — 로그인 시 갱신, admin 대시보드의
     "마지막 로그인" 칼럼.
  2) idx_audit_action — analytics 의 top-views / search count 집계가
     `action` 으로 필터링하므로 보조 인덱스가 필요하다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0005_admin_dashboard"
down_revision: str | Sequence[str] | None = "0004_image_ulid"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_audit_user")
    op.execute("DROP INDEX IF EXISTS idx_audit_action")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS last_login_at")
