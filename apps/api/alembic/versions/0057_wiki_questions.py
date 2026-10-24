# 위키 질문 대기열 — 묻기가 답하지 못한 물음 · 사람이 남긴 물음(docs/llm-wiki W6, CONTRACTS §2-7 — 지속 질의는 W7)
"""wiki_questions (W6).

같은 물음이 쌓이지 않게 정규화 문장(공백 · 흔한 구두점 무시 · casefold)의 해시와 범위로 한 줄 — 다시 오면 `asked_count` 를 올린다.
범위(`audience`)는 그 물음을 볼 수 있는 사람 — 묻기가 남기는 물음은 물은 사람만(`user:<id>`)이 기본이다(물음 글에 좁은 범위의 말이
섞일 수 있다). 덤프(dump_data)에는 싣지 않는다(위키 표 — WK-D8). 스냅숏에는 있다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0057_wiki_questions"
down_revision: str | Sequence[str] | None = "0056_wiki_ontology"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE wiki_questions (
            id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            text              TEXT NOT NULL CHECK (char_length(text) BETWEEN 2 AND 2000),
            norm_hash         TEXT NOT NULL,
            origin            TEXT NOT NULL CHECK (origin IN ('lint', 'ingest', 'user', 'query_miss', 'standing')),
            origin_ref        TEXT,
            about_entities    UUID[] NOT NULL DEFAULT '{}',
            audience          TEXT[] NOT NULL CHECK (cardinality(audience) > 0),
            priority          INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
            status            TEXT NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'asking', 'answered', 'needs_human', 'needs_experiment', 'closed',
                                                'dropped')),
            asked_count       INTEGER NOT NULL DEFAULT 1,
            last_asked_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            answer_source_id  UUID REFERENCES wiki_sources(id) ON DELETE SET NULL,
            assignee          UUID REFERENCES users(id) ON DELETE SET NULL,
            created_by        UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE UNIQUE INDEX uq_wiki_questions ON wiki_questions (norm_hash, audience)")
    op.execute("CREATE INDEX idx_wiki_questions_status ON wiki_questions (status, priority, last_asked_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS wiki_questions")
