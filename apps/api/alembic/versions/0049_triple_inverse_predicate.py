"""doc_triples.inverse_predicate — 엣지의 역방향 자연어 설명.

graph-triple-inverse 사이클. 기존 엣지는 (subject) --predicate--> (object) 한
방향만 서술했다. object 쪽에서 "이 문서를 가리키는 관계"를 자연어로 읽으려면
역방향 술어가 필요하다 (예: predicate='인용한다' ↔ inverse='에 인용된다').

nullable — 기존 행과 inverse 없는 manual 입력은 NULL 로 두고, 표시 측이
generic fallback 한다. UNIQUE 키에는 영향 없음(방향/술어 동일성은 predicate 로).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0049_triple_inverse_predicate"
down_revision: str | Sequence[str] | None = "0048_glossary_extended"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE doc_triples ADD COLUMN inverse_predicate TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE doc_triples DROP COLUMN IF EXISTS inverse_predicate")
