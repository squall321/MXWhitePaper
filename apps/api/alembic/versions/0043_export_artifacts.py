"""export_artifacts — persist generated docx/pptx/pdf for re-download.

Every successful export now saves its bytes to MinIO + inserts a row
in this table. Users can list / re-download past exports without
re-rendering. Old artifacts can be pruned by a retention policy.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0043_export_artifacts"
down_revision: str | Sequence[str] | None = "0042_form_quiz_defs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE export_artifacts (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          doc_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          slug         TEXT NOT NULL,
          format       TEXT NOT NULL CHECK (format IN ('docx','pptx','pdf','html','md')),
          filename     TEXT NOT NULL,
          mime_type    TEXT NOT NULL,
          size_bytes   BIGINT NOT NULL,
          minio_key    TEXT NOT NULL,
          doc_version  INT NOT NULL,                   -- snapshot of documents.version at export time
          created_by   UUID NOT NULL REFERENCES users(id),
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute("CREATE INDEX ix_export_artifacts_doc ON export_artifacts(doc_id, created_at DESC)")
    op.execute("CREATE INDEX ix_export_artifacts_slug ON export_artifacts(slug, format, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS export_artifacts")
