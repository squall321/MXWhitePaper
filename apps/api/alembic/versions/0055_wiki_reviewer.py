# 위키 검토자 표지 — users.wiki_reviewer(사용자 결정 Q7 — 새 표지 + 대상 문서 owners · docs/llm-wiki W4)
"""users.wiki_reviewer (W4).

검토 큐(변경 묶음)를 보고 승인 · 거절 · 되돌릴 수 있는 사람의 표지. 묶음의 범위 토큰을 모두 가져야 하는 것은 따로 본다(범위 밖 묶음은
표지가 있어도 안 보인다). admin 은 표지 없이도 검토자다. 관리자가 `PATCH /api/v1/admin/users/{id}` 로 켠다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0055_wiki_reviewer"
down_revision: str | Sequence[str] | None = "0054_wiki_changesets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN wiki_reviewer BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS wiki_reviewer")
