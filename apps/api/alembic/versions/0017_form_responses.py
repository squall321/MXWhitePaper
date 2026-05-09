"""form_responses — embedded form/survey block responses.

Revision ID: 0017_form_responses
Revises: 0016_anchor_samples
Create Date: 2026-05-09 21:00:00

Stores reader submissions for `form` blocks embedded in documents.
- `block_id` is the ULID of the block within the document JSON.
- `answers` is a JSONB map {questionId: answer-value}.
- `user_id` may be NULL for anonymous submissions (rare).
Reversible.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0017_form_responses"
down_revision: str | Sequence[str] | None = "0016_anchor_samples"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE form_responses (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          block_id TEXT NOT NULL,
          user_id UUID NULL REFERENCES users(id),
          answers JSONB NOT NULL,
          submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute(
        "CREATE INDEX idx_form_responses_doc_block "
        "ON form_responses(document_id, block_id)"
    )
    op.execute(
        "CREATE INDEX idx_form_responses_user ON form_responses(user_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_form_responses_user")
    op.execute("DROP INDEX IF EXISTS idx_form_responses_doc_block")
    op.execute("DROP TABLE IF EXISTS form_responses CASCADE")
