# 위키 변경 묶음 · 근거 · 엔티티 유형(첫 판) · 엔티티 등록부 표(docs/llm-wiki W4, CONTRACTS §2-3 · §2-4 · §2-6)
"""wiki changesets · citations · entity types · entities (W4).

- wiki_changesets — AI 의 쓰기 하나 = 묶음 하나. 함께 검증하고 함께 반영하고 함께 되돌린다. `plan` 은 계획 단계의 출력(건드릴 문서 ·
  까닭 · 그 문서를 읽은 판) — V6(계획 밖 문서)과 반영 때 버전 CAS 가 본다. `applied` = {doc_id: [from, to]}(만든 문서는 from 0).
- wiki_citations — 블록 → 원천. 블록이 지워지면 반영 트랜잭션이 근거도 지운다. 같은 블록 · 원천 · 위치는 한 줄.
- wiki_entity_types — 첫 판 14 가지(SCHEMA-DRAFT §4)를 approved 로 넣는다. `abbr` 는 slug 약어(§3). 제안 → 승인 길은 W5.
- wiki_entities — 들이기의 결정적 해석(외부 id → 별칭 → 정규화 이름)이 찾는 등록부. 한 엔티티의 문서는 범위마다 한 장일 수 있어
  문서 연결은 `wiki_pages.entity_id` 로 한다(이 표에 page_doc_id 를 두지 않는다). 그 외래 키를 여기서 단다(0051 이 미뤄 둔 것).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0054_wiki_changesets"
down_revision: str | Sequence[str] | None = "0053_wiki_source_owner_email"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (key, 이름, 영어, slug 약어) — SCHEMA-DRAFT §3 · §4
_TYPES = [
    ("product-model", "제품 모델", "product model", "model"),
    ("project", "과제", "project", "proj"),
    ("dev-stage", "개발 단계", "development stage", "stage"),
    ("part", "부품", "part", "part"),
    ("supplier", "공급사", "supplier", "supp"),
    ("material", "재료", "material", "mat"),
    ("failure-mode", "불량 유형", "failure mode", "fm"),
    ("mechanism", "고장 메커니즘", "failure mechanism", "mech"),
    ("field-case", "시장 사례", "field case", "fcase"),
    ("sim-case", "해석 사례", "simulation case", "scase"),
    ("sim-type", "해석 종류", "simulation type", "simt"),
    ("reliability-test", "신뢰성 시험", "reliability test", "test"),
    ("countermeasure", "대책", "countermeasure", "cm"),
    ("concept", "공학 개념", "engineering concept", "concept"),
]


def upgrade() -> None:
    op.execute("""
        CREATE TABLE wiki_entity_types (
            key          TEXT PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9-]{1,40}$'),
            label_ko     TEXT NOT NULL,
            label_en     TEXT,
            parent_key   TEXT REFERENCES wiki_entity_types(key),
            abbr         TEXT NOT NULL UNIQUE CHECK (abbr ~ '^[a-z][a-z0-9]{0,11}$'),
            description  TEXT,
            ext_axes     JSONB NOT NULL DEFAULT '{}'::jsonb,
            status       TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('approved', 'proposed')),
            proposed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
            approved_by  UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    values = ", ".join(f"('{k}', '{ko}', '{en}', '{ab}', 'approved')" for k, ko, en, ab in _TYPES)
    op.execute(f"INSERT INTO wiki_entity_types (key, label_ko, label_en, abbr, status) VALUES {values}")

    op.execute("""
        CREATE TABLE wiki_entities (
            id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            type_key             TEXT NOT NULL REFERENCES wiki_entity_types(key),
            canonical_name       TEXT NOT NULL CHECK (char_length(canonical_name) BETWEEN 1 AND 200),
            aliases              TEXT[] NOT NULL DEFAULT '{}',
            ext_ids              JSONB NOT NULL DEFAULT '{}'::jsonb,
            attrs                JSONB NOT NULL DEFAULT '{}'::jsonb,
            audience             TEXT[] NOT NULL CHECK (cardinality(audience) > 0),
            status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'retired')),
            merged_into          UUID REFERENCES wiki_entities(id),
            created_by_changeset UUID,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_wiki_entities_name ON wiki_entities (type_key, lower(canonical_name))
            WHERE status = 'active'
    """)
    op.execute("CREATE INDEX idx_wiki_entities_aliases ON wiki_entities USING GIN (aliases)")
    op.execute("CREATE INDEX idx_wiki_entities_ext ON wiki_entities USING GIN (ext_ids jsonb_path_ops)")
    op.execute("""
        ALTER TABLE wiki_pages ADD CONSTRAINT fk_wiki_pages_entity
            FOREIGN KEY (entity_id) REFERENCES wiki_entities(id) ON DELETE SET NULL
    """)

    op.execute("""
        CREATE TABLE wiki_changesets (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            op              TEXT NOT NULL CHECK (op IN ('ingest', 'fileback', 'lint_fix', 'inquiry', 'human_request',
                                                        'revert')),
            trigger         JSONB NOT NULL DEFAULT '{}'::jsonb,
            job_id          UUID REFERENCES wiki_jobs(id) ON DELETE SET NULL,
            schema_version  INTEGER NOT NULL DEFAULT 0,
            model           TEXT,
            prompt_hash     TEXT,
            plan            JSONB NOT NULL DEFAULT '{}'::jsonb,
            ops             JSONB NOT NULL DEFAULT '[]'::jsonb,
            validation      JSONB NOT NULL DEFAULT '[]'::jsonb,
            status          TEXT NOT NULL DEFAULT 'proposed'
                            CHECK (status IN ('proposed', 'validating', 'auto_applied', 'pending_review', 'failed',
                                              'approved', 'applied', 'rejected', 'reverted')),
            audience        TEXT[] NOT NULL CHECK (cardinality(audience) > 0),
            decided_by      UUID REFERENCES users(id) ON DELETE SET NULL,
            decided_at      TIMESTAMPTZ,
            decision_note   TEXT,
            applied         JSONB NOT NULL DEFAULT '{}'::jsonb,
            usage           JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at     TIMESTAMPTZ,
            error           TEXT
        )
    """)
    op.execute("CREATE INDEX idx_wiki_changesets_status ON wiki_changesets (status, created_at DESC)")

    op.execute("""
        CREATE TABLE wiki_citations (
            doc_id        UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            block_id      TEXT NOT NULL,
            source_id     UUID NOT NULL REFERENCES wiki_sources(id),
            locator       JSONB NOT NULL DEFAULT '{}'::jsonb,
            quote         TEXT CHECK (quote IS NULL OR char_length(quote) <= 300),
            changeset_id  UUID REFERENCES wiki_changesets(id) ON DELETE SET NULL,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_wiki_citations ON wiki_citations (doc_id, block_id, source_id, md5(locator::text))
    """)
    op.execute("CREATE INDEX idx_wiki_citations_source ON wiki_citations (source_id)")
    op.execute("CREATE INDEX idx_wiki_citations_changeset ON wiki_citations (changeset_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS wiki_citations")
    op.execute("DROP TABLE IF EXISTS wiki_changesets")
    op.execute("ALTER TABLE wiki_pages DROP CONSTRAINT IF EXISTS fk_wiki_pages_entity")
    op.execute("DROP TABLE IF EXISTS wiki_entities")
    op.execute("DROP TABLE IF EXISTS wiki_entity_types")
