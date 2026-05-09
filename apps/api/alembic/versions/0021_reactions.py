"""reactions — emoji reactions on docs and blocks (Cycle 0021).

Lightweight social signals separate from the comment thread. A user may
react with at most one of each emoji per (document, block_id) pair —
reacting with the same emoji twice removes it (toggle). `block_id NULL`
denotes a doc-level reaction.

Indexed on (document_id, block_id) for the aggregate counts query the
`GET /documents/:slug/reactions` endpoint runs on every page render.

Reversible: downgrade drops the table.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0021_reactions"
down_revision: str | Sequence[str] | None = "0020_doc_templates"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Extend notifications.kind CHECK so dispatcher can insert
    # `reaction_added` rows. Mirrors the 0018 pattern.
    op.execute(
        "ALTER TABLE notifications "
        "DROP CONSTRAINT IF EXISTS notifications_kind_check"
    )
    op.execute("""
        ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN (
          'comment_mention', 'comment_reply',
          'review_request', 'review_decision',
          'subscription_event', 'subscription_digest',
          'reaction_added'
        ))
    """)
    # Note: the spec's `UNIQUE (user_id, document_id, block_id, emoji)` is
    # implemented as two partial unique indexes because Postgres treats NULL
    # as distinct in standard UNIQUE constraints — which would silently allow
    # duplicate doc-level reactions.
    op.execute("""
        CREATE TABLE reactions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id),
          document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          block_id TEXT NULL,
          emoji TEXT NOT NULL CHECK (
            emoji IN ('thumbs-up', 'heart', 'thinking', 'pray', 'tada')
          ),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute(
        "CREATE UNIQUE INDEX uq_reactions_user_doc_block_emoji "
        "ON reactions(user_id, document_id, block_id, emoji) "
        "WHERE block_id IS NOT NULL"
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_reactions_user_doc_emoji "
        "ON reactions(user_id, document_id, emoji) "
        "WHERE block_id IS NULL"
    )
    op.execute(
        "CREATE INDEX idx_reactions_doc_block "
        "ON reactions(document_id, block_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_reactions_doc_block")
    op.execute("DROP INDEX IF EXISTS uq_reactions_user_doc_emoji")
    op.execute("DROP INDEX IF EXISTS uq_reactions_user_doc_block_emoji")
    op.execute("DROP TABLE IF EXISTS reactions CASCADE")
    # Restore the 0018 view of notifications.kind so the schema matches the
    # state we found.
    op.execute(
        "ALTER TABLE notifications "
        "DROP CONSTRAINT IF EXISTS notifications_kind_check"
    )
    op.execute("""
        ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN (
          'comment_mention', 'comment_reply',
          'review_request', 'review_decision',
          'subscription_event', 'subscription_digest'
        ))
    """)
