# 위키 문서 표(wiki_pages) — 문서 한 장의 종류 · 관리 주체 · 보이기 범위(docs/llm-wiki W2, CONTRACTS §2-1)
"""wiki_pages (W2 — 보이기 범위가 사는 자리라 원천 · 작업 표(W3)보다 먼저).

DocumentJSON 은 바꾸지 않는다(WK-D2) — 위키 상태는 이 옆 표에 둔다. 줄이 있는 문서가 위키 문서다.
audience 는 토큰의 그리고(AND)이고 빈 배열은 금지(모두는 ["org"]). entity_id 의 외래 키는 wiki_entities 가 생길 때(W5) 단다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0051_wiki_pages"
down_revision: str | Sequence[str] | None = "0050_wiki_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE wiki_pages (
            doc_id            UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
            kind              TEXT NOT NULL CHECK (kind IN ('source', 'entity', 'concept', 'case', 'analysis', 'qa',
                                                           'overview', 'index', 'lint-report', 'schema')),
            managed           TEXT NOT NULL DEFAULT 'ai' CHECK (managed IN ('ai', 'human')),
            entity_id         UUID,
            audience          TEXT[] NOT NULL CHECK (cardinality(audience) > 0),
            review_lock       BOOLEAN NOT NULL DEFAULT FALSE,
            schema_version    INTEGER,
            last_changeset_id UUID,
            stale_since       TIMESTAMPTZ,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS wiki_pages")
