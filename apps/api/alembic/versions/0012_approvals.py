"""approvals — review workflow (draft → in_review → approved → published).

Revision ID: 0012_approvals
Revises: 0011_share_links
Create Date: 2026-05-09 14:00:00

This migration introduces lightweight document-review primitives:

  1. `documents.status` CHECK is widened to include `'in_review'` and
     `'approved'`. The default stays `'draft'`. Existing rows are unaffected
     because the old values are still valid under the new constraint.

  2. `document_reviewers` (one row per (document, reviewer)). Each row tracks
     a single reviewer's pending/approved/rejected/changes_requested state +
     optional comment. The `UNIQUE (document_id, reviewer_user_id)` lets the
     POST endpoint be idempotent via ON CONFLICT.

  3. `notifications.kind` CHECK is widened to allow `'review_request'` and
     `'review_decision'`. Reviewer-add inserts the former; a reviewer's
     decision inserts the latter (notifying the document author).

Downgrade is fully reversible:
  - drop document_reviewers
  - revert notifications.kind to the original two-kind CHECK
  - revert documents.status to draft/published/archived. We first coerce
    any in_review/approved rows back to 'draft' so the new CHECK accepts
    them — losing the workflow state but keeping the data.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0012_approvals"
down_revision: str | Sequence[str] | None = "0011_share_links"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1) widen documents.status CHECK
    op.execute("ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check")
    op.execute("""
        ALTER TABLE documents
          ADD CONSTRAINT documents_status_check
          CHECK (status IN ('draft','in_review','approved','published','archived'))
    """)

    # 2) reviewers table
    op.execute("""
        CREATE TABLE document_reviewers (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          reviewer_user_id  UUID NOT NULL REFERENCES users(id),
          status            TEXT NOT NULL
                              CHECK (status IN ('pending','approved','rejected','changes_requested')),
          comment           TEXT NULL,
          reviewed_at       TIMESTAMPTZ NULL,
          added_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (document_id, reviewer_user_id)
        )
    """)
    op.execute("CREATE INDEX idx_doc_reviewers_doc ON document_reviewers(document_id)")
    op.execute(
        "CREATE INDEX idx_doc_reviewers_user "
        "ON document_reviewers(reviewer_user_id, status)"
    )

    # 3) widen notifications.kind CHECK
    op.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check")
    op.execute("""
        ALTER TABLE notifications
          ADD CONSTRAINT notifications_kind_check
          CHECK (kind IN (
            'comment_mention',
            'comment_reply',
            'review_request',
            'review_decision'
          ))
    """)


def downgrade() -> None:
    # Revert notifications.kind first — drop any rows with new kinds so the
    # narrower CHECK can be added back.
    op.execute("DELETE FROM notifications WHERE kind IN ('review_request','review_decision')")
    op.execute("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check")
    op.execute("""
        ALTER TABLE notifications
          ADD CONSTRAINT notifications_kind_check
          CHECK (kind IN ('comment_mention','comment_reply'))
    """)

    # Drop reviewers table.
    op.execute("DROP TABLE IF EXISTS document_reviewers CASCADE")

    # Coerce any in_review/approved rows so the original CHECK accepts them,
    # then revert documents.status CHECK.
    op.execute("UPDATE documents SET status='draft' WHERE status IN ('in_review','approved')")
    op.execute("ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check")
    op.execute("""
        ALTER TABLE documents
          ADD CONSTRAINT documents_status_check
          CHECK (status IN ('draft','published','archived'))
    """)
