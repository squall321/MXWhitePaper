"""quiz_attempts — embedded quiz block submissions (Cycle 0029).

The `quiz` block type extends the form-block surface with correct-answer keys,
scoring, retry policy, and a leaderboard. Each submission is server-side scored
against the block's `correct` keys and a row is inserted here.

Tables / columns:
  - ``quiz_attempts``                  — one row per submission
  - ``idx_quiz_attempts_doc_block``    — leaderboard / list-attempts queries
  - ``idx_quiz_attempts_user_doc``     — `/me/quiz-attempts` lookups

`block_id` is the ULID of the quiz block within the document JSON. `user_id`
may be NULL for anonymous submissions (rare, mirrors `form_responses`).

Reversible.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0029_quiz_attempts"
down_revision: str | Sequence[str] | None = "0028_reminders"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE quiz_attempts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NULL REFERENCES users(id),
          document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          block_id TEXT NOT NULL,
          answers JSONB NOT NULL,
          score INT NOT NULL,
          passed BOOLEAN NOT NULL,
          duration_seconds INT NOT NULL,
          submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_quiz_attempts_doc_block "
        "ON quiz_attempts(document_id, block_id)"
    )
    op.execute(
        "CREATE INDEX idx_quiz_attempts_user_doc "
        "ON quiz_attempts(user_id, document_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_quiz_attempts_user_doc")
    op.execute("DROP INDEX IF EXISTS idx_quiz_attempts_doc_block")
    op.execute("DROP TABLE IF EXISTS quiz_attempts CASCADE")
