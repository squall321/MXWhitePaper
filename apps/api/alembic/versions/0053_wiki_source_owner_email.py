# 원천 주인의 이메일 칸(불변) — 주인이 아직 MXWP 사용자가 아니어도 받은 그대로 남긴다(docs/llm-wiki W3)
"""wiki_sources.owner_email (W3).

`owner_user_id` 는 받을 때 그 이메일로 찾은 사람이다(없으면 null — 그 사람이 나중에 들어오면 이을 수 있게 바꿀 수 있는 칸으로 두었다).
이메일은 봉투에 온 그대로라 불변 칸에 든다 — 트리거가 새 칸까지 보게 함수를 바꾼다. 철회 권한 · restricted 원천의 주인 판정이 이 칸을 본다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0053_wiki_source_owner_email"
down_revision: str | Sequence[str] | None = "0052_wiki_sources_jobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_IMMUTABLE = [
    "id", "kind", "origin_system", "origin_ref", "origin_rev", "origin_url", "title", "summary", "payload",
    "payload_sha256", "blobs", "subject_hints", "audience", "sensitivity", "via", "consent", "captured_at",
    "received_at", "supersedes_id",
]


def _guard(cols: list[str]) -> str:
    new = ", ".join(f"NEW.{c}" for c in cols)
    old = ", ".join(f"OLD.{c}" for c in cols)
    return f"""
        CREATE OR REPLACE FUNCTION wiki_sources_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE' THEN
                IF current_setting('mxwp.wiki_purge', true) IS DISTINCT FROM 'on' THEN
                    RAISE EXCEPTION 'wiki_sources is immutable — withdraw instead of delete'
                        USING ERRCODE = 'check_violation';
                END IF;
                RETURN OLD;
            END IF;
            IF ({new}) IS DISTINCT FROM ({old}) THEN
                RAISE EXCEPTION 'wiki_sources is immutable — send a new revision (supersedes_id) instead'
                    USING ERRCODE = 'check_violation';
            END IF;
            RETURN NEW;
        END $$
    """


def upgrade() -> None:
    op.execute("ALTER TABLE wiki_sources ADD COLUMN owner_email TEXT")
    op.execute(_guard([*_IMMUTABLE, "owner_email"]))


def downgrade() -> None:
    op.execute(_guard(_IMMUTABLE))
    op.execute("ALTER TABLE wiki_sources DROP COLUMN owner_email")
