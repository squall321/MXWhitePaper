"""home-knowledge-hero — 인덱스 5개 + indegree 컬럼 + 백필.

T1 트랙 (home-knowledge-hero plan §3.4-b):

  - idx_document_tags_tag_id    ON document_tags(tag_id)
  - idx_document_tags_doc_id    ON document_tags(document_id)
  - idx_links_source_slug       ON links(source_slug)   ← source_slug 컬럼이
                                                          존재할 때만 생성
  - idx_links_target_slug       ON links(target_slug)   ← 이미 존재할 수 있음
  - idx_documents_created_at    ON documents(created_at)
  - documents.indegree integer NOT NULL DEFAULT 0
  - idx_documents_indegree      ON documents(indegree DESC)

NOTE: links.source_slug 는 0001_init 스키마에 없는 컬럼이다.
      IF EXISTS 로 조건부 처리하여 forward-compatible 하게 유지.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0046_knowledge_hero_indexes"
down_revision: str | Sequence[str] | None = "0045_signup_users_groups"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1) document_tags 인덱스 — PK (document_id, tag_id) 는 document_id 조회를
    #    커버하지만, tag_id 단독 조회(super-domain → doc 목록)는 커버 안 함.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id "
        "ON document_tags(tag_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_document_tags_doc_id "
        "ON document_tags(document_id)"
    )

    # 2) links 인덱스 — source_slug 컬럼은 현재 스키마에 없을 수 있음.
    #    DO $$ 블록으로 컬럼 존재 시에만 생성.
    op.execute("""
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'links' AND column_name = 'source_slug'
          ) THEN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_links_source_slug ON links(source_slug)';
          END IF;
        END$$
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_links_target_slug "
        "ON links(target_slug)"
    )

    # 3) documents.created_at — trend SQL 의 generate_series × join 용
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_created_at "
        "ON documents(created_at)"
    )

    # 4) indegree cache 컬럼 + 인덱스
    op.execute(
        "ALTER TABLE documents "
        "ADD COLUMN IF NOT EXISTS indegree integer NOT NULL DEFAULT 0"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_documents_indegree "
        "ON documents(indegree DESC)"
    )

    # 5) 초기 백필 — links 테이블에서 target_slug 를 documents.slug 와 매칭.
    #    documents.slug 는 UNIQUE NOT NULL 이므로 서브쿼리 스캔 1회.
    op.execute("""
        UPDATE documents d
        SET indegree = (
          SELECT COUNT(*) FROM links l WHERE l.target_slug = d.slug
        )
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_documents_indegree")
    op.execute("ALTER TABLE documents DROP COLUMN IF EXISTS indegree")
    op.execute("DROP INDEX IF EXISTS idx_documents_created_at")
    op.execute("DROP INDEX IF EXISTS idx_links_target_slug")
    op.execute("DROP INDEX IF EXISTS idx_links_source_slug")
    op.execute("DROP INDEX IF EXISTS idx_document_tags_doc_id")
    op.execute("DROP INDEX IF EXISTS idx_document_tags_tag_id")
