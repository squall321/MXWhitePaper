"""glossary-knowledge-graph Sprint AB — terms 확장 + term_domains + term_proposals.

기존 0001 의 `terms (id, term UNIQUE, definition, related_docs)` 를 확장:
- term UNIQUE 제거 → (term, domain) 복합 UNIQUE 로 교체
- 분류 (domain, subdomain), 다국어 (term_en), 동의어 (aliases TEXT[])
- 모더레이션 라이프사이클 (status, proposed_by/at, approved_by/at, rejected_by, reject_reason)
- 페이지 연결 (page_doc_id)
- 분야 마스터 (term_domains, 계층형)
- 제안 이력 (term_proposals)
- 초기 5개 도메인 seed
- 기존 row 백필 (status='approved', domain='general')
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0048_glossary_extended"
down_revision: str | Sequence[str] | None = "0047_doc_triples"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. 분야 마스터 테이블 (계층형) ──
    op.execute("""
        CREATE TABLE term_domains (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            slug        TEXT UNIQUE NOT NULL,
            name        TEXT NOT NULL,
            parent_id   UUID REFERENCES term_domains(id) ON DELETE SET NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)

    # ── 2. terms 컬럼 확장 ──
    op.execute("""
        ALTER TABLE terms
          ADD COLUMN domain        TEXT REFERENCES term_domains(slug) ON DELETE SET NULL,
          ADD COLUMN subdomain     TEXT,
          ADD COLUMN term_en       TEXT,
          ADD COLUMN aliases       TEXT[] NOT NULL DEFAULT '{}',
          ADD COLUMN status        TEXT NOT NULL DEFAULT 'approved'
                                     CHECK (status IN ('proposed','approved','rejected','deprecated')),
          ADD COLUMN proposed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN approved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN rejected_by   UUID REFERENCES users(id) ON DELETE SET NULL,
          ADD COLUMN reject_reason TEXT,
          ADD COLUMN proposed_at   TIMESTAMPTZ,
          ADD COLUMN approved_at   TIMESTAMPTZ,
          ADD COLUMN page_doc_id   UUID REFERENCES documents(id) ON DELETE SET NULL
    """)

    # ── 3. 기존 term UNIQUE 제거 → (term, domain) 복합 UNIQUE (domain NOT NULL 일 때) ──
    op.execute("ALTER TABLE terms DROP CONSTRAINT IF EXISTS terms_term_key")
    op.execute(
        "CREATE UNIQUE INDEX terms_term_domain_uidx ON terms (term, domain) "
        "WHERE domain IS NOT NULL"
    )

    # ── 4. 검색/필터 인덱스 ──
    op.execute("CREATE INDEX terms_aliases_gin ON terms USING GIN (aliases)")
    op.execute("CREATE INDEX terms_term_en_lower_idx ON terms (lower(term_en))")
    op.execute("CREATE INDEX terms_status_idx ON terms (status)")
    op.execute("CREATE INDEX terms_domain_idx ON terms (domain)")

    # ── 5. 제안 이력 테이블 ──
    op.execute("""
        CREATE TABLE term_proposals (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            term_id      UUID REFERENCES terms(id) ON DELETE CASCADE,
            action       TEXT NOT NULL CHECK (action IN ('propose','approve','reject','edit','deprecate')),
            actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
            payload      JSONB,
            reason       TEXT,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX term_proposals_term_id_idx ON term_proposals (term_id)")
    op.execute("CREATE INDEX term_proposals_created_at_idx ON term_proposals (created_at DESC)")

    # ── 6. 분야 마스터 seed ──
    op.execute("""
        INSERT INTO term_domains (slug, name) VALUES
          ('general',      '일반'),
          ('ml',           'Machine Learning'),
          ('network',      '네트워크'),
          ('semiconductor','반도체'),
          ('ev',           '전기차')
        ON CONFLICT (slug) DO NOTHING
    """)

    # ── 7. 기존 terms row 백필 (도메인 seed *이후* 에야 FK 충족) ──
    op.execute("""
        UPDATE terms
           SET status = 'approved',
               domain = 'general'
         WHERE status = 'approved' AND domain IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS term_proposals_created_at_idx")
    op.execute("DROP INDEX IF EXISTS term_proposals_term_id_idx")
    op.execute("DROP TABLE IF EXISTS term_proposals")
    op.execute("DROP INDEX IF EXISTS terms_domain_idx")
    op.execute("DROP INDEX IF EXISTS terms_status_idx")
    op.execute("DROP INDEX IF EXISTS terms_term_en_lower_idx")
    op.execute("DROP INDEX IF EXISTS terms_aliases_gin")
    op.execute("DROP INDEX IF EXISTS terms_term_domain_uidx")
    op.execute("ALTER TABLE terms ADD CONSTRAINT terms_term_key UNIQUE (term)")
    op.execute("""
        ALTER TABLE terms
          DROP COLUMN IF EXISTS page_doc_id,
          DROP COLUMN IF EXISTS approved_at,
          DROP COLUMN IF EXISTS proposed_at,
          DROP COLUMN IF EXISTS reject_reason,
          DROP COLUMN IF EXISTS rejected_by,
          DROP COLUMN IF EXISTS approved_by,
          DROP COLUMN IF EXISTS proposed_by,
          DROP COLUMN IF EXISTS status,
          DROP COLUMN IF EXISTS aliases,
          DROP COLUMN IF EXISTS term_en,
          DROP COLUMN IF EXISTS subdomain,
          DROP COLUMN IF EXISTS domain
    """)
    op.execute("DROP TABLE IF EXISTS term_domains")
