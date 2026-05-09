"""subscriptions — document follow + digest buffer (Cycle 0018).

Introduces:
  - `subscriptions` — one row per (user, doc) follow. Tracks which event kinds
    the user wants to be alerted on plus the digest cadence. `last_digest_at`
    records the most recent digest emission so the runner can skip until the
    cutoff.
  - `pending_digest_items` — buffer rows for users on `daily` / `weekly`
    cadence. The dispatcher inserts here instead of `notifications`; the
    digest_runner ticker bundles these into a single `subscription_digest`
    notification on the cutoff.

Downgrade is fully reversible — both tables and their indexes are dropped.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0018_subscriptions"
down_revision: str | Sequence[str] | None = "0017_form_responses"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Expand notifications.kind CHECK to allow the two new subscription kinds.
    # Original constraint (from 0006_comments) only knew about comment/review.
    op.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check")
    op.execute("""
        ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN (
          'comment_mention', 'comment_reply',
          'review_request', 'review_decision',
          'subscription_event', 'subscription_digest'
        ))
    """)
    op.execute("""
        CREATE TABLE subscriptions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id),
          document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          events JSONB NOT NULL DEFAULT
            '["doc_edited","comment_added","review_decided","doc_published"]',
          digest_cadence TEXT NOT NULL DEFAULT 'instant'
            CHECK (digest_cadence IN ('instant', 'daily', 'weekly')),
          last_digest_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, document_id)
        )
    """)
    op.execute(
        "CREATE INDEX idx_subscriptions_doc ON subscriptions(document_id)"
    )
    op.execute(
        "CREATE INDEX idx_subscriptions_user ON subscriptions(user_id)"
    )
    op.execute("""
        CREATE TABLE pending_digest_items (
          id BIGSERIAL PRIMARY KEY,
          subscription_id UUID NOT NULL
            REFERENCES subscriptions(id) ON DELETE CASCADE,
          user_id UUID NOT NULL,
          document_id UUID NOT NULL,
          event_kind TEXT NOT NULL,
          payload JSONB NOT NULL,
          queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute(
        "CREATE INDEX idx_pending_digest_user_queued "
        "ON pending_digest_items(user_id, queued_at)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_pending_digest_user_queued")
    op.execute("DROP TABLE IF EXISTS pending_digest_items CASCADE")
    op.execute("DROP INDEX IF EXISTS idx_subscriptions_user")
    op.execute("DROP INDEX IF EXISTS idx_subscriptions_doc")
    op.execute("DROP TABLE IF EXISTS subscriptions CASCADE")
    # Restore the original notifications.kind CHECK so a downgrade leaves
    # the schema identical to 0017's view of the world.
    op.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check")
    op.execute("""
        ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
        CHECK (kind IN (
          'comment_mention', 'comment_reply',
          'review_request', 'review_decision'
        ))
    """)
