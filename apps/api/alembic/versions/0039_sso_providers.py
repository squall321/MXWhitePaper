"""sso_providers — SAML/OIDC provider scaffolding (Cycle 19).

Adds the data-model and admin-CRUD tables for SSO providers. The actual
SAML/OIDC handshake is intentionally deferred — see TODO in the
``/auth/sso/{provider_id}/initiate`` router. This migration ships only:

  - ``sso_providers`` — one row per IdP (kind = 'saml' | 'oidc'),
    enabled toggle, kind-specific config columns, optional email-domain
    auto-routing, attribute mapping, default role for JIT users.

A partial index on ``email_domain`` (WHERE enabled) backs the public
``GET /auth/sso/discover?email=…`` lookup.

Reversible — downgrade drops the index and the table.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op


revision: str = "0039_sso_providers"
down_revision: str | Sequence[str] | None = "0038_email_optout"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE sso_providers (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL UNIQUE,
          kind TEXT NOT NULL CHECK (kind IN ('saml', 'oidc')),
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          -- SAML fields
          saml_metadata_url TEXT NULL,
          saml_entity_id TEXT NULL,
          saml_acs_url TEXT NULL,
          saml_x509_cert TEXT NULL,
          -- OIDC fields
          oidc_issuer TEXT NULL,
          oidc_client_id TEXT NULL,
          oidc_client_secret_enc TEXT NULL,
          oidc_scopes JSONB NOT NULL DEFAULT '["openid","email","profile"]'::jsonb,
          -- Common
          email_domain TEXT NULL,
          attribute_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
          default_role TEXT NOT NULL DEFAULT 'reader'
            CHECK (default_role IN ('reader','editor','owner','admin')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_sso_providers_email_domain "
        "ON sso_providers(email_domain) WHERE enabled"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_sso_providers_email_domain")
    op.execute("DROP TABLE IF EXISTS sso_providers CASCADE")
