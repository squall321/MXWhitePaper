"""form_definitions + quiz_definitions.

DB-backs the inline form/quiz block content in samples 11 and 13.
Definitions live in tables so they can be queried, listed, analyzed —
independent of any single document that embeds them.

The block schema continues to keep an inline copy (block IS the
content) but seed_form_defs / seed_quiz_defs upserts the canonical
definition into these tables on every seed.

Tables:
  - form_definitions  one row per form (id = slug-ish)
  - form_fields       per-question rows
  - quiz_definitions  one row per quiz
  - quiz_questions    per-question rows
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0042_form_quiz_defs"
down_revision: str | Sequence[str] | None = "0041_launch_facts"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE form_definitions (
          id            TEXT PRIMARY KEY,           -- slug (sample-form-id)
          title         TEXT NOT NULL,
          description   TEXT,
          submit_label  TEXT,
          thanks_text   TEXT,
          max_attempts  INT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE form_fields (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          form_id       TEXT NOT NULL REFERENCES form_definitions(id) ON DELETE CASCADE,
          question_id   TEXT NOT NULL,
          kind          TEXT NOT NULL,              -- text / email / select / multi / rating / textarea
          label         TEXT NOT NULL,
          required      BOOLEAN NOT NULL DEFAULT false,
          placeholder   TEXT,
          options       JSONB,                       -- enum options or rating scale
          sort_order    INT NOT NULL DEFAULT 0,
          UNIQUE (form_id, question_id)
        )
        """
    )
    op.execute("CREATE INDEX ix_form_fields_form ON form_fields(form_id, sort_order)")

    op.execute(
        """
        CREATE TABLE quiz_definitions (
          id              TEXT PRIMARY KEY,         -- slug
          title           TEXT NOT NULL,
          description     TEXT,
          passing_score   INT,
          max_attempts    INT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE quiz_questions (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          quiz_id       TEXT NOT NULL REFERENCES quiz_definitions(id) ON DELETE CASCADE,
          question_id   TEXT NOT NULL,
          kind          TEXT NOT NULL,              -- single / multi / true-false / short
          label         TEXT NOT NULL,
          options       JSONB,                       -- choice list (NULL for short)
          correct       JSONB NOT NULL,              -- correct answer(s)
          explanation   TEXT,
          points        INT NOT NULL DEFAULT 1,
          sort_order    INT NOT NULL DEFAULT 0,
          UNIQUE (quiz_id, question_id)
        )
        """
    )
    op.execute("CREATE INDEX ix_quiz_questions_quiz ON quiz_questions(quiz_id, sort_order)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS quiz_questions")
    op.execute("DROP TABLE IF EXISTS quiz_definitions")
    op.execute("DROP TABLE IF EXISTS form_fields")
    op.execute("DROP TABLE IF EXISTS form_definitions")
