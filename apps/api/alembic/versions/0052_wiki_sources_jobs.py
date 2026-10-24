# 위키 원천(불변) · 작업 큐 · 기록(덧붙이기만) · 워커 심장박동 표(docs/llm-wiki W3, CONTRACTS §2-2 · §2-5 · §2-9)
"""wiki sources · jobs · log (W3).

- wiki_sources — 원천은 불변이다. 바꿀 수 있는 칸은 status · ingest_state · doc_id(원천 문서) · owner_user_id · submitted_by
  (사람이 지워지면 SET NULL)뿐이고 나머지를 바꾸는 UPDATE 는 트리거가 거부한다. 멱등 열쇠는
  (origin_system, origin_ref, COALESCE(origin_rev, ''), payload_sha256).
- wiki_jobs — DB 큐. 워커가 `FOR UPDATE SKIP LOCKED` 로 집고 lease 를 늘려 가며 돈다. lease 가 지나면 다른 워커가 다시 집는다.
- wiki_log — 덧붙이기만. UPDATE 는 늘, DELETE 는 `SET LOCAL mxwp.wiki_purge = 'on'` 일 때만(시험 정리 · 운영자 손 정리).
  원천도 DELETE 는 같은 스위치로만 — 보존은 무기한이다(사용자 결정 Q10).
- wiki_workers — 워커가 돌 때마다 남기는 마지막 신호(/api/v1/wiki/health 가 읽는다).
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0052_wiki_sources_jobs"
down_revision: str | Sequence[str] | None = "0051_wiki_pages"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE wiki_sources (
            id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            kind           TEXT NOT NULL CHECK (kind IN ('sim_result', 'field_defect', 'qa', 'deliberation', 'report',
                                                         'card', 'document', 'correction', 'inquiry_answer', 'note')),
            origin_system  TEXT NOT NULL,
            origin_ref     TEXT NOT NULL,
            origin_rev     TEXT,
            origin_url     TEXT,
            title          TEXT NOT NULL,
            summary        TEXT,
            payload        JSONB NOT NULL,
            payload_sha256 CHAR(64) NOT NULL,
            blobs          JSONB NOT NULL DEFAULT '[]'::jsonb,
            subject_hints  JSONB NOT NULL DEFAULT '[]'::jsonb,
            audience       TEXT[] NOT NULL CHECK (cardinality(audience) > 0),
            sensitivity    TEXT NOT NULL CHECK (sensitivity IN ('public', 'internal', 'restricted')),
            owner_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
            submitted_by   UUID REFERENCES users(id) ON DELETE SET NULL,
            via            TEXT NOT NULL,
            consent        JSONB,
            captured_at    TIMESTAMPTZ NOT NULL,
            received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            supersedes_id  UUID REFERENCES wiki_sources(id),
            status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'withdrawn')),
            ingest_state   TEXT NOT NULL DEFAULT 'new'
                           CHECK (ingest_state IN ('new', 'queued', 'running', 'done', 'failed', 'skipped', 'held')),
            doc_id         UUID REFERENCES documents(id) ON DELETE SET NULL
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX uq_wiki_sources_dedup
            ON wiki_sources (origin_system, origin_ref, COALESCE(origin_rev, ''), payload_sha256)
    """)
    op.execute("CREATE INDEX idx_wiki_sources_origin ON wiki_sources (origin_system, origin_ref)")
    op.execute("CREATE INDEX idx_wiki_sources_received ON wiki_sources (received_at DESC)")
    op.execute("""
        CREATE FUNCTION wiki_sources_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF current_setting('mxwp.wiki_purge', true) IS DISTINCT FROM 'on' THEN
                    RAISE EXCEPTION 'wiki_sources is immutable — withdraw instead of delete'
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN OLD;
            END IF;
            IF (NEW.id, NEW.kind, NEW.origin_system, NEW.origin_ref, NEW.origin_rev, NEW.origin_url, NEW.title,
                NEW.summary, NEW.payload, NEW.payload_sha256, NEW.blobs, NEW.subject_hints, NEW.audience,
                NEW.sensitivity, NEW.via, NEW.consent, NEW.captured_at, NEW.received_at, NEW.supersedes_id)
               IS DISTINCT FROM
               (OLD.id, OLD.kind, OLD.origin_system, OLD.origin_ref, OLD.origin_rev, OLD.origin_url, OLD.title,
                OLD.summary, OLD.payload, OLD.payload_sha256, OLD.blobs, OLD.subject_hints, OLD.audience,
                OLD.sensitivity, OLD.via, OLD.consent, OLD.captured_at, OLD.received_at, OLD.supersedes_id) THEN
                RAISE EXCEPTION 'wiki_sources is immutable — send a new revision (supersedes_id) instead'
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END $$
    """)
    op.execute("""
        CREATE TRIGGER trg_wiki_sources_guard BEFORE UPDATE OR DELETE ON wiki_sources
            FOR EACH ROW EXECUTE FUNCTION wiki_sources_guard()
    """)

    op.execute("""
        CREATE TABLE wiki_jobs (
            id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            op           TEXT NOT NULL CHECK (op IN ('ingest', 'query', 'lint', 'inquire', 'reindex', 'apply', 'noop')),
            args         JSONB NOT NULL DEFAULT '{}'::jsonb,
            state        TEXT NOT NULL DEFAULT 'queued'
                         CHECK (state IN ('queued', 'running', 'done', 'failed', 'cancelled', 'held')),
            priority     INTEGER NOT NULL DEFAULT 100,
            not_before   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            attempts     INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER NOT NULL DEFAULT 3,
            lease_until  TIMESTAMPTZ,
            worker       TEXT,
            budget       JSONB NOT NULL DEFAULT '{}'::jsonb,
            usage        JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            started_at   TIMESTAMPTZ,
            finished_at  TIMESTAMPTZ,
            result       JSONB,
            error        TEXT
        )
    """)
    op.execute("CREATE INDEX idx_wiki_jobs_pick ON wiki_jobs (priority, not_before) WHERE state = 'queued'")
    op.execute("CREATE INDEX idx_wiki_jobs_lease ON wiki_jobs (lease_until) WHERE state = 'running'")

    op.execute("""
        CREATE TABLE wiki_log (
            id            BIGSERIAL PRIMARY KEY,
            at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            op            TEXT NOT NULL CHECK (op IN ('ingest', 'query', 'fileback', 'lint', 'inquire', 'review',
                                                      'revert', 'withdraw', 'schema')),
            title         TEXT NOT NULL,
            detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
            actor         TEXT,
            job_id        UUID,
            changeset_id  UUID,
            audience      TEXT[] NOT NULL CHECK (cardinality(audience) > 0)
        )
    """)
    op.execute("CREATE INDEX idx_wiki_log_at ON wiki_log (at DESC)")
    op.execute("""
        CREATE FUNCTION wiki_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND current_setting('mxwp.wiki_purge', true) = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'wiki_log is append-only' USING ERRCODE = 'check_violation';
        END $$
    """)
    op.execute("""
        CREATE TRIGGER trg_wiki_log_guard BEFORE UPDATE OR DELETE ON wiki_log
            FOR EACH ROW EXECUTE FUNCTION wiki_log_guard()
    """)

    op.execute("""
        CREATE TABLE wiki_workers (
            worker     TEXT PRIMARY KEY,
            seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            state      TEXT NOT NULL DEFAULT 'idle',
            job_id     UUID
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS wiki_workers")
    op.execute("DROP TABLE IF EXISTS wiki_log")
    op.execute("DROP FUNCTION IF EXISTS wiki_log_guard()")
    op.execute("DROP TABLE IF EXISTS wiki_jobs")
    op.execute("DROP TABLE IF EXISTS wiki_sources")
    op.execute("DROP FUNCTION IF EXISTS wiki_sources_guard()")
