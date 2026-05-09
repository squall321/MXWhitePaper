"""webhooks — outgoing webhook integrations.

Revision ID: 0014_webhooks
Revises: 0013_series
Create Date: 2026-05-09 22:00:00

Introduces:
  - `webhooks`            — registered outgoing endpoints. `secret` is the
    HMAC signing key (32 random bytes) and is returned to the caller exactly
    once at create time; subsequent reads mask it.
  - `webhook_deliveries`  — append-only delivery log. Recent attempts (incl.
    HTTP status + response body snippet) are queryable for debugging via
    `GET /webhooks/:id/deliveries`.

Downgrade is fully reversible — both tables and indexes are dropped.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0014_webhooks"
down_revision: str | Sequence[str] | None = "0013_series"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE webhooks (
          id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          owner_user_id     UUID NOT NULL REFERENCES users(id),
          scope             TEXT NOT NULL CHECK (scope IN ('user', 'org')),
          url               TEXT NOT NULL,
          secret            TEXT NOT NULL,
          events            JSONB NOT NULL DEFAULT '[]'::jsonb,
          filter_part_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
          enabled           BOOLEAN NOT NULL DEFAULT TRUE,
          last_status       TEXT NULL,
          last_attempted_at TIMESTAMPTZ NULL,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_webhooks_owner ON webhooks(owner_user_id)")

    op.execute("""
        CREATE TABLE webhook_deliveries (
          id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          webhook_id    UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event_kind    TEXT NOT NULL,
          payload       JSONB NOT NULL,
          http_status   INT NULL,
          response_body TEXT NULL,
          attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          retry_count   INT NOT NULL DEFAULT 0
        )
    """)
    op.execute(
        "CREATE INDEX idx_webhook_deliveries_webhook "
        "ON webhook_deliveries(webhook_id, attempted_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_webhook_deliveries_webhook")
    op.execute("DROP TABLE IF EXISTS webhook_deliveries CASCADE")
    op.execute("DROP INDEX IF EXISTS idx_webhooks_owner")
    op.execute("DROP TABLE IF EXISTS webhooks CASCADE")
