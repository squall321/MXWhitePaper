"""initial schema — orgs, documents, versions, links, tags, users, images, audit_logs

Revision ID: 0001_init
Revises:
Create Date: 2026-05-06 14:30:00

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0001_init"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # extensions
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    # pgvector is optional for MVP — Phase 4 will require it. Try, ignore if unavailable.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── organizations ────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE divisions (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug        TEXT UNIQUE NOT NULL,
          name        TEXT NOT NULL,
          description TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("""
        CREATE TABLE teams (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          division_id  UUID NOT NULL REFERENCES divisions(id) ON DELETE CASCADE,
          slug         TEXT NOT NULL,
          name         TEXT NOT NULL,
          lead_user_id UUID,
          UNIQUE (division_id, slug)
        )
    """)
    op.execute("""
        CREATE TABLE groups (
          id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
          slug    TEXT NOT NULL,
          name    TEXT NOT NULL,
          UNIQUE (team_id, slug)
        )
    """)
    op.execute("""
        CREATE TABLE parts (
          id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
          slug     TEXT NOT NULL,
          name     TEXT NOT NULL,
          UNIQUE (group_id, slug)
        )
    """)

    # ── users ────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE users (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email         TEXT UNIQUE NOT NULL,
          name          TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role          TEXT NOT NULL DEFAULT 'reader'
                          CHECK (role IN ('reader','editor','owner','admin')),
          team_id       UUID REFERENCES teams(id) ON DELETE SET NULL,
          is_active     BOOLEAN NOT NULL DEFAULT TRUE,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # ── documents ────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE documents (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          slug         TEXT UNIQUE NOT NULL,
          part_id      UUID REFERENCES parts(id) ON DELETE SET NULL,
          title        TEXT NOT NULL,
          summary      TEXT,
          status       TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','published','archived')),
          content_json JSONB NOT NULL,
          schema_ver   TEXT NOT NULL DEFAULT '1.0',
          version      INT  NOT NULL DEFAULT 1,
          owner_id     UUID NOT NULL REFERENCES users(id),
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    # pgvector column is optional — added in a separate migration when Phase 4 starts.

    op.execute("CREATE INDEX idx_documents_part    ON documents(part_id)")
    op.execute("CREATE INDEX idx_documents_updated ON documents(updated_at DESC)")
    op.execute("CREATE INDEX idx_documents_content_gin ON documents USING GIN (content_json jsonb_path_ops)")

    # ── document versions ────────────────────────────────────────────
    op.execute("""
        CREATE TABLE document_versions (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          document_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          version      INT NOT NULL,
          content_json JSONB NOT NULL,
          edited_by    UUID NOT NULL REFERENCES users(id),
          edited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          change_log   TEXT,
          UNIQUE (document_id, version)
        )
    """)

    # ── links graph ──────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE links (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          source_doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          target_slug   TEXT NOT NULL,
          target_doc_id UUID REFERENCES documents(id) ON DELETE SET NULL,
          anchor        TEXT,
          link_type     TEXT NOT NULL DEFAULT 'wiki',
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_links_source      ON links(source_doc_id)")
    op.execute("CREATE INDEX idx_links_target_slug ON links(target_slug)")
    op.execute("CREATE INDEX idx_links_target_doc  ON links(target_doc_id)")

    # ── tags ─────────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE tags (
          id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT UNIQUE NOT NULL
        )
    """)
    op.execute("""
        CREATE TABLE document_tags (
          document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
          tag_id      UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (document_id, tag_id)
        )
    """)

    # ── glossary ─────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE terms (
          id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          term         TEXT UNIQUE NOT NULL,
          definition   TEXT NOT NULL,
          related_docs UUID[] NOT NULL DEFAULT '{}'
        )
    """)

    # ── images ───────────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE images (
          id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sha256         CHAR(64) UNIQUE NOT NULL,
          original_name  TEXT NOT NULL,
          mime_type      TEXT NOT NULL,
          size_bytes     BIGINT NOT NULL,
          width          INT,
          height         INT,
          dominant_color TEXT,
          storage_keys   JSONB NOT NULL,
          uploaded_by    UUID NOT NULL REFERENCES users(id),
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # ── audit logs ───────────────────────────────────────────────────
    op.execute("""
        CREATE TABLE audit_logs (
          id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id    UUID REFERENCES users(id),
          action     TEXT NOT NULL,
          target     TEXT NOT NULL,
          payload    JSONB,
          ip         INET,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_audit_created ON audit_logs(created_at DESC)")


def downgrade() -> None:
    for tbl in [
        "audit_logs", "images", "terms", "document_tags", "tags",
        "links", "document_versions", "documents",
        "users", "parts", "groups", "teams", "divisions",
    ]:
        op.execute(f"DROP TABLE IF EXISTS {tbl} CASCADE")
