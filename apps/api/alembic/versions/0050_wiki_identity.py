# 포털 위임 신원(docs/llm-wiki W1) — 사용자 포털 소속 · 플랫폼 칸 · 위임 세대 · 소속→팀 표 · 진입 토큰 jti 원장
"""wiki identity (W1 — CONTRACTS §2-10 · §9).

- users.portal_affiliation · portal_plat · portal_access_at — 포털 진입 토큰(affiliation 클레임 · groups 의 plat:)이 채운다.
  portal_plat 의 빈 배열은 '권한 없음을 안다', NULL 은 '모른다' 다.
- sso_delegations — 위임 토큰의 세대(사람 × 클라이언트). 세대를 올리면 그 클라이언트로 나간 토큰이 모두 죽는다.
  클라이언트마다 줄이 따로라 gateway 발급이 hwax-portal 발급 · 웹 세션을 회수하지 않는다.
- wiki_aff_team_map — 처음 들어온 SSO 사용자의 팀을 소속으로 정한다(비면 지금처럼 첫 팀).
- portal_launch_jti — 진입 토큰 재사용 막기. 프로세스 메모리에 두면 워커가 둘이 될 때 뚫린다.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0050_wiki_identity"
down_revision: str | Sequence[str] | None = "0049_triple_inverse_predicate"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE users
            ADD COLUMN portal_affiliation TEXT,
            ADD COLUMN portal_plat TEXT[],
            ADD COLUMN portal_access_at TIMESTAMPTZ
    """)
    op.execute("""
        CREATE TABLE sso_delegations (
            user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            client         TEXT NOT NULL,
            generation     INTEGER NOT NULL DEFAULT 1,
            issued_count   INTEGER NOT NULL DEFAULT 0,
            last_issued_at TIMESTAMPTZ,
            PRIMARY KEY (user_id, client)
        )
    """)
    op.execute("""
        CREATE TABLE wiki_aff_team_map (
            affiliation TEXT PRIMARY KEY,
            team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE TABLE portal_launch_jti (
            jti TEXT PRIMARY KEY,
            exp TIMESTAMPTZ NOT NULL
        )
    """)
    op.execute("CREATE INDEX idx_portal_launch_jti_exp ON portal_launch_jti(exp)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS portal_launch_jti")
    op.execute("DROP TABLE IF EXISTS wiki_aff_team_map")
    op.execute("DROP TABLE IF EXISTS sso_delegations")
    op.execute("""
        ALTER TABLE users
            DROP COLUMN IF EXISTS portal_access_at,
            DROP COLUMN IF EXISTS portal_plat,
            DROP COLUMN IF EXISTS portal_affiliation
    """)
