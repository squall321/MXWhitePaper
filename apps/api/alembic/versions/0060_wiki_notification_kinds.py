# 알림 종류에 위키 둘을 더한다 — 밀린 검토(점검 stuck_review) · 사람 답이 필요한 질문(지속 질의 needs_human)
"""notifications.kind CHECK 에 'wiki_stuck_review' · 'wiki_question' 을 더한다(docs/llm-wiki W7).

알림은 읽을 때 한 곳에서 거른다(payload `slug` 의 문서가 보이나 — WK-D31). 위키 알림 둘은 payload 에 slug 가 없고, 보낼 때 그 묶음 ·
질문의 범위 토큰을 다 가진 사람에게만 보낸다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0060_wiki_notification_kinds"
down_revision: str | Sequence[str] | None = "0059_wiki_lint_inquiry"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_KINDS = ("'comment_mention', 'comment_reply', 'review_request', 'review_decision', 'subscription_event', "
          "'subscription_digest', 'reaction_added', 'automation_blast', 'retention_warning', 'reminder'")


def upgrade() -> None:
    op.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check")
    op.execute(f"""
        ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN ({_KINDS}, 'wiki_stuck_review', 'wiki_question'))
    """)


def downgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind IN ('wiki_stuck_review', 'wiki_question')")
    op.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check")
    op.execute(f"ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ({_KINDS}))")
