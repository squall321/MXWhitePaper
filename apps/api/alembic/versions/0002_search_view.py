"""materialized view for Meilisearch indexing source

Revision ID: 0002_search_view
Revises: 0001_init
Create Date: 2026-05-06 14:35:00

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002_search_view"
down_revision: str | Sequence[str] | None = "0001_init"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Flat view for Meilisearch indexing.
    # JSONB path used to extract paragraph/heading/quote/callout text and image alt/caption.
    # We accept some loss for nested blocks (columns/tabs/accordion) — Sprint 6 will refine.
    op.execute("""
        CREATE MATERIALIZED VIEW documents_flat_v AS
        SELECT
          d.id,
          d.slug,
          d.title,
          d.summary,
          d.updated_at,
          (
            SELECT string_agg(s.value->>'title', ' ')
            FROM jsonb_path_query(d.content_json, '$.sections[*]') AS s(value)
          ) AS section_titles,
          (
            -- text/title fields from common block types
            SELECT string_agg(
              COALESCE(b->>'text','') || ' ' ||
              COALESCE(b->>'title','') || ' ' ||
              COALESCE(b->>'caption','') || ' ' ||
              COALESCE(b->>'alt',''),
              ' '
            )
            FROM jsonb_path_query(
              d.content_json,
              'strict $.**.blocks[*]'
            ) AS b
          ) AS body_text,
          (
            SELECT array_agg(DISTINCT t.name)
            FROM document_tags dt
            JOIN tags t ON t.id = dt.tag_id
            WHERE dt.document_id = d.id
          ) AS tags
        FROM documents d
        WHERE d.status = 'published'
    """)
    op.execute("CREATE UNIQUE INDEX documents_flat_v_id_idx ON documents_flat_v(id)")
    op.execute("CREATE INDEX documents_flat_v_updated_idx ON documents_flat_v(updated_at DESC)")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS documents_flat_v CASCADE")
