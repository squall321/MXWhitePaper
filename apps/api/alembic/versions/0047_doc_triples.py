"""doc_triples — 의미 엣지 (subject, predicate, object) 테이블.

graph-edge-predicates 사이클 1차 (DB+API). 그래프 엣지에 술어를 붙이기 위한
별도 테이블. wiki/tag 엣지는 기존 links/doc_tags 가 그대로 담당하고, 이 표는
LLM 추출 (source='llm') 과 사용자 수동 입력 (source='manual') 만 보관한다.

subject_slug/object_slug 는 FK 로 강제하지 않음 — 문서 삭제 시 orphan 으로
남겨두고, 그래프 응답에서 존재하지 않는 slug 의 triple 만 런타임에 제외한다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0047_doc_triples"
down_revision: str | Sequence[str] | None = "0046_knowledge_hero_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE doc_triples (
            id             TEXT PRIMARY KEY,
            subject_slug   TEXT NOT NULL,
            predicate      TEXT NOT NULL,
            object_slug    TEXT NOT NULL,
            source         TEXT NOT NULL CHECK (source IN ('llm','manual')),
            confidence     REAL,
            created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (subject_slug, predicate, object_slug, source)
        )
        """
    )
    op.execute("CREATE INDEX idx_triples_subject ON doc_triples(subject_slug)")
    op.execute("CREATE INDEX idx_triples_object  ON doc_triples(object_slug)")
    op.execute("CREATE INDEX idx_triples_pred    ON doc_triples(predicate)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS doc_triples")
