# 위키 원천 멱등 열쇠에 범위를 더한다 — 후보(주인만 보는 held 원천)를 승인하면 고른 범위의 새 줄이 생겨야 한다(docs/llm-wiki W6, WK-D32)
"""wiki_sources dedup key + audience (W6).

후보 승인은 범위를 고르므로 같은 봉투(시스템 · ref · 판 · payload 해시)의 새 줄이 된다 — 옛 열쇠로는 승인한 줄이 후보 줄과 겹쳐 받기가
'같은 것' 으로 돌려보냈다(WK-D32 가 W6 에 미뤄 둔 것). 같은 봉투를 다른 범위로 보내는 것은 다른 원천이고, 받기의 '새 판' 길이 앞 줄을
superseded 로 둔다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0058_wiki_source_dedup_audience"
down_revision: str | Sequence[str] | None = "0057_wiki_questions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP INDEX uq_wiki_sources_dedup")
    op.execute("""
        CREATE UNIQUE INDEX uq_wiki_sources_dedup
            ON wiki_sources (origin_system, origin_ref, COALESCE(origin_rev, ''), payload_sha256, audience)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX uq_wiki_sources_dedup")
    op.execute("""
        CREATE UNIQUE INDEX uq_wiki_sources_dedup
            ON wiki_sources (origin_system, origin_ref, COALESCE(origin_rev, ''), payload_sha256)
    """)
