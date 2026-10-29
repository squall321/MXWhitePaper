# 위키 점검 · 지속 질의 · 예산 표(W7) — 점검 실행 · 결함(한 줄로 이어짐) · 묻기 우선 표지 · LLM 쓴 양 장부 · 일정 · 질문의 시도 칸
"""wiki_lint_runs · wiki_lint_findings · wiki_llm_turns · wiki_llm_usage · wiki_schedule + wiki_questions 칸 셋(docs/llm-wiki W7).

- 결함은 `fingerprint`(규칙 + 대상)로 한 줄 — 밤마다 새로 쌓지 않고 `last_seen_at` 만 옮긴다(request §5-8). `audience` 는 그 결함을 볼 수
  있는 사람(대상 문서 · 원천의 좁은 토큰) — 좁은 문서의 결함 제목이 넓은 사람에게 새지 않게.
- `wiki_llm_turns` — 사람이 기다리는 묻기가 LLM 을 쓰는 동안 한 줄(끝나면 지운다 · 죽으면 `expires_at` 뒤 무시). 배경 호출은 이 줄이
  있는 동안 기다린다(묻기 우선 — CONTRACTS §8).
- `wiki_llm_usage` — LLM 호출마다 쓴 토큰. 하루 예산(규칙서 budget.daily_tokens)은 배경 줄을 KST 하루로 더해 본다(작업이 실패 · 보류로
  끝나도 쓴 양은 남는다).
- `wiki_schedule` — 밤 점검 · 상시 질문 · 지속 질의를 하루 한 번만 줄 세우는 표지(워커가 여럿이어도).
- 덤프(dump_data)는 허용 목록이라 이 표들을 싣지 않는다(WK-D8). 스냅숏에는 있다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0059_wiki_lint_inquiry"
down_revision: str | Sequence[str] | None = "0058_wiki_source_dedup_audience"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_RULES = ("'orphan', 'uncited', 'stale', 'contradiction', 'missing_page', 'missing_link', 'gap', 'schema', "
          "'stuck_review'")


def upgrade() -> None:
    op.execute("""
        CREATE TABLE wiki_lint_runs (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            scope          TEXT NOT NULL,
            llm            BOOLEAN NOT NULL DEFAULT FALSE,
            job_id         UUID,
            started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            finished_at    TIMESTAMPTZ,
            counts         JSONB NOT NULL DEFAULT '{}'::jsonb,
            report_doc_id  UUID REFERENCES documents(id) ON DELETE SET NULL,
            error          TEXT
        )
    """)
    op.execute("CREATE INDEX idx_wiki_lint_runs_started ON wiki_lint_runs (started_at DESC)")
    op.execute(f"""
        CREATE TABLE wiki_lint_findings (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            fingerprint         TEXT NOT NULL UNIQUE,
            rule                TEXT NOT NULL CHECK (rule IN ({_RULES})),
            severity            TEXT NOT NULL CHECK (severity IN ('info', 'warn', 'error')),
            title               TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
            doc_ids             UUID[] NOT NULL DEFAULT '{{}}',
            source_ids          UUID[] NOT NULL DEFAULT '{{}}',
            entity_ids          UUID[] NOT NULL DEFAULT '{{}}',
            detail              JSONB NOT NULL DEFAULT '{{}}'::jsonb,
            audience            TEXT[] NOT NULL CHECK (cardinality(audience) > 0),
            status              TEXT NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'fixed', 'dismissed', 'question_raised')),
            run_id              UUID REFERENCES wiki_lint_runs(id) ON DELETE SET NULL,
            last_run_id         UUID REFERENCES wiki_lint_runs(id) ON DELETE SET NULL,
            first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            question_id         UUID REFERENCES wiki_questions(id) ON DELETE SET NULL,
            fixed_by_changeset  UUID REFERENCES wiki_changesets(id) ON DELETE SET NULL,
            closed_by           TEXT,
            closed_at           TIMESTAMPTZ,
            note                TEXT
        )
    """)
    op.execute("CREATE INDEX idx_wiki_lint_findings_status ON wiki_lint_findings (status, rule, last_seen_at DESC)")
    op.execute("CREATE INDEX idx_wiki_lint_findings_docs ON wiki_lint_findings USING GIN (doc_ids)")

    op.execute("""
        CREATE TABLE wiki_llm_turns (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            role        TEXT NOT NULL CHECK (role IN ('interactive')),
            started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at  TIMESTAMPTZ NOT NULL
        )
    """)
    op.execute("""
        CREATE TABLE wiki_llm_usage (
            id      BIGSERIAL PRIMARY KEY,
            at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            role    TEXT NOT NULL CHECK (role IN ('background', 'interactive')),
            tokens  INTEGER NOT NULL CHECK (tokens >= 0),
            job_id  UUID,
            name    TEXT
        )
    """)
    op.execute("CREATE INDEX idx_wiki_llm_usage_at ON wiki_llm_usage (role, at DESC)")
    op.execute("""
        CREATE TABLE wiki_schedule (
            key      TEXT PRIMARY KEY,
            last_at  TIMESTAMPTZ NOT NULL,
            detail   JSONB NOT NULL DEFAULT '{}'::jsonb
        )
    """)

    op.execute("""
        ALTER TABLE wiki_questions
            ADD COLUMN attempts     INTEGER NOT NULL DEFAULT 0,
            ADD COLUMN detail       JSONB NOT NULL DEFAULT '{}'::jsonb,
            ADD COLUMN answered_at  TIMESTAMPTZ
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE wiki_questions DROP COLUMN IF EXISTS answered_at, DROP COLUMN IF EXISTS detail, "
               "DROP COLUMN IF EXISTS attempts")
    op.execute("DROP TABLE IF EXISTS wiki_schedule")
    op.execute("DROP TABLE IF EXISTS wiki_llm_usage")
    op.execute("DROP TABLE IF EXISTS wiki_llm_turns")
    op.execute("DROP TABLE IF EXISTS wiki_lint_findings")
    op.execute("DROP TABLE IF EXISTS wiki_lint_runs")
