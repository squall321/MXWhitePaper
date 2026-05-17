"""SSO providers router (Cycle 19 scaffolding).

Admin CRUD over ``sso_providers`` + a public discover endpoint that
resolves ``email`` → matching enabled provider, plus a placeholder
``initiate`` endpoint that currently returns 501.

The actual SAML / OIDC handshake is deferred to a follow-up cycle:

  TODO (Cycle 19+1):
    - SAML: integrate ``python3-saml`` for AuthnRequest + ACS callback.
      ``saml_metadata_url`` / ``saml_entity_id`` / ``saml_acs_url`` /
      ``saml_x509_cert`` are stored here for that follow-up.
    - OIDC: integrate ``authlib`` for authorization-code+PKCE flow.
      ``oidc_issuer`` / ``oidc_client_id`` / ``oidc_client_secret_enc``
      / ``oidc_scopes`` are stored here for that follow-up.
    - ``oidc_client_secret_enc`` is currently stored as plaintext —
      when SSO actually goes live, encrypt it with the same key the
      rest of the app uses for at-rest secrets (or a new KMS key).
    - JIT user provisioning (``default_role`` + ``attribute_mapping``).
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Path, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.db import get_db
from app.core.errors import APIError, Conflict, NotFound, ValidationFailed, envelope
from app.repos import document_repo

router = APIRouter(prefix="/api/v1", tags=["sso"])


VALID_KINDS = {"saml", "oidc"}
VALID_DEFAULT_ROLES = {"reader", "editor", "owner", "admin"}


# ── Pydantic models ──────────────────────────────────────────────────────


class ProviderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    kind: str = Field(..., description="saml | oidc")
    enabled: bool = False
    # SAML
    saml_metadata_url: str | None = None
    saml_entity_id: str | None = None
    saml_acs_url: str | None = None
    saml_x509_cert: str | None = None
    # OIDC
    oidc_issuer: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None  # plaintext in; stored as-is for now (TODO encrypt)
    oidc_scopes: list[str] | None = None
    # Common
    email_domain: str | None = None
    attribute_mapping: dict[str, Any] = Field(default_factory=dict)
    default_role: str = "reader"


class ProviderPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: str | None = None
    enabled: bool | None = None
    saml_metadata_url: str | None = None
    saml_entity_id: str | None = None
    saml_acs_url: str | None = None
    saml_x509_cert: str | None = None
    oidc_issuer: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    oidc_scopes: list[str] | None = None
    email_domain: str | None = None
    attribute_mapping: dict[str, Any] | None = None
    default_role: str | None = None


# ── Helpers ──────────────────────────────────────────────────────────────


def _parse_jsonb(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return None
    return None


def _normalize_domain(d: str | None) -> str | None:
    if d is None:
        return None
    s = d.strip().lower()
    return s or None


def _validate_kind(kind: str) -> None:
    if kind not in VALID_KINDS:
        raise ValidationFailed(
            f"kind must be one of {sorted(VALID_KINDS)}",
            details={"got": kind},
        )


def _validate_default_role(role: str) -> None:
    if role not in VALID_DEFAULT_ROLES:
        raise ValidationFailed(
            f"default_role must be one of {sorted(VALID_DEFAULT_ROLES)}",
            details={"got": role},
        )


def _row_to_dict(r: Any, *, mask_secret: bool = True) -> dict[str, Any]:
    secret = r[10]
    if mask_secret and secret:
        secret = "***"
    return {
        "id": str(r[0]),
        "name": r[1],
        "kind": r[2],
        "enabled": bool(r[3]),
        "saml_metadata_url": r[4],
        "saml_entity_id": r[5],
        "saml_acs_url": r[6],
        "saml_x509_cert": r[7],
        "oidc_issuer": r[8],
        "oidc_client_id": r[9],
        "oidc_client_secret_set": bool(r[10]),
        "oidc_client_secret": secret,
        "oidc_scopes": _parse_jsonb(r[11]) or [],
        "email_domain": r[12],
        "attribute_mapping": _parse_jsonb(r[13]) or {},
        "default_role": r[14],
        "created_at": r[15].isoformat() if r[15] else None,
        "updated_at": r[16].isoformat() if r[16] else None,
    }


_SELECT_COLUMNS = (
    "id, name, kind, enabled, "
    "saml_metadata_url, saml_entity_id, saml_acs_url, saml_x509_cert, "
    "oidc_issuer, oidc_client_id, oidc_client_secret_enc, oidc_scopes, "
    "email_domain, attribute_mapping, default_role, "
    "created_at, updated_at"
)


async def _fetch_provider(
    s: AsyncSession, pid: str, *, mask_secret: bool = True,
) -> dict[str, Any] | None:
    row = (
        await s.execute(
            text(
                f"SELECT {_SELECT_COLUMNS} FROM sso_providers "
                "WHERE id = CAST(:p AS uuid)"
            ),
            {"p": pid},
        )
    ).first()
    if not row:
        return None
    return _row_to_dict(row, mask_secret=mask_secret)


# ── Admin CRUD ───────────────────────────────────────────────────────────


@router.post(
    "/admin/sso/providers",
    status_code=201,
    summary="SSO 제공자 생성 (admin)",
)
async def create_provider(
    body: ProviderCreate,
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    _validate_kind(body.kind)
    _validate_default_role(body.default_role)
    domain = _normalize_domain(body.email_domain)
    scopes = body.oidc_scopes or ["openid", "email", "profile"]
    try:
        row = (
            await s.execute(
                text(
                    """
                    INSERT INTO sso_providers
                      (name, kind, enabled,
                       saml_metadata_url, saml_entity_id, saml_acs_url, saml_x509_cert,
                       oidc_issuer, oidc_client_id, oidc_client_secret_enc, oidc_scopes,
                       email_domain, attribute_mapping, default_role)
                    VALUES
                      (:n, :k, :en,
                       :smu, :sei, :sau, :sxc,
                       :oi, :oci, :ocs, CAST(:osc AS jsonb),
                       :ed, CAST(:am AS jsonb), :dr)
                    RETURNING id
                    """
                ),
                {
                    "n": body.name,
                    "k": body.kind,
                    "en": bool(body.enabled),
                    "smu": body.saml_metadata_url,
                    "sei": body.saml_entity_id,
                    "sau": body.saml_acs_url,
                    "sxc": body.saml_x509_cert,
                    "oi": body.oidc_issuer,
                    "oci": body.oidc_client_id,
                    # TODO encrypt at rest (cycle 19+1).
                    "ocs": body.oidc_client_secret,
                    "osc": json.dumps(scopes),
                    "ed": domain,
                    "am": json.dumps(body.attribute_mapping or {}),
                    "dr": body.default_role,
                },
            )
        ).first()
    except Exception as e:
        # Likely unique violation on `name`.
        msg = str(e).lower()
        if "unique" in msg or "sso_providers_name_key" in msg:
            await s.rollback()
            raise Conflict("provider name already exists") from e
        raise
    assert row is not None  # INSERT...RETURNING always emits one row
    pid = str(row[0])
    await document_repo.insert_audit(
        s, user_id=user["id"], action="sso_provider.create",
        target=f"sso_provider:{pid}",
        payload={"name": body.name, "kind": body.kind, "enabled": bool(body.enabled)},
    )
    await s.commit()
    fresh = await _fetch_provider(s, pid)
    if not fresh:
        raise NotFound("provider just created vanished")
    return envelope(data=fresh)


@router.get(
    "/admin/sso/providers",
    summary="SSO 제공자 목록 (admin)",
)
async def list_providers(
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rows = (
        await s.execute(
            text(
                f"SELECT {_SELECT_COLUMNS} FROM sso_providers "
                "ORDER BY created_at DESC"
            ),
        )
    ).all()
    items = [_row_to_dict(r) for r in rows]
    return envelope(data={"items": items}, meta={"count": len(items)})


@router.get(
    "/admin/sso/providers/{provider_id}",
    summary="SSO 제공자 단건 (admin) — 비밀값은 마스킹됨",
)
async def get_provider(
    provider_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    p = await _fetch_provider(s, provider_id)
    if not p:
        raise NotFound("provider not found")
    return envelope(data=p)


@router.patch(
    "/admin/sso/providers/{provider_id}",
    summary="SSO 제공자 수정 (admin)",
)
async def patch_provider(
    body: ProviderPatch,
    provider_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    p = await _fetch_provider(s, provider_id)
    if not p:
        raise NotFound("provider not found")

    if body.kind is not None:
        _validate_kind(body.kind)
    if body.default_role is not None:
        _validate_default_role(body.default_role)

    sets: list[str] = []
    params: dict[str, Any] = {"id": provider_id}

    def _set(col: str, key: str, val: Any, cast: str | None = None) -> None:
        sets.append(f"{col} = " + (f"CAST(:{key} AS {cast})" if cast else f":{key}"))
        params[key] = val

    if body.name is not None:
        _set("name", "n", body.name)
    if body.kind is not None:
        _set("kind", "k", body.kind)
    if body.enabled is not None:
        _set("enabled", "en", bool(body.enabled))
    if body.saml_metadata_url is not None:
        _set("saml_metadata_url", "smu", body.saml_metadata_url)
    if body.saml_entity_id is not None:
        _set("saml_entity_id", "sei", body.saml_entity_id)
    if body.saml_acs_url is not None:
        _set("saml_acs_url", "sau", body.saml_acs_url)
    if body.saml_x509_cert is not None:
        _set("saml_x509_cert", "sxc", body.saml_x509_cert)
    if body.oidc_issuer is not None:
        _set("oidc_issuer", "oi", body.oidc_issuer)
    if body.oidc_client_id is not None:
        _set("oidc_client_id", "oci", body.oidc_client_id)
    if body.oidc_client_secret is not None:
        # TODO encrypt at rest (cycle 19+1).
        _set("oidc_client_secret_enc", "ocs", body.oidc_client_secret)
    if body.oidc_scopes is not None:
        _set("oidc_scopes", "osc", json.dumps(body.oidc_scopes), cast="jsonb")
    if body.email_domain is not None:
        _set("email_domain", "ed", _normalize_domain(body.email_domain))
    if body.attribute_mapping is not None:
        _set(
            "attribute_mapping", "am",
            json.dumps(body.attribute_mapping or {}), cast="jsonb",
        )
    if body.default_role is not None:
        _set("default_role", "dr", body.default_role)

    if not sets:
        raise ValidationFailed("nothing to update")

    sets.append("updated_at = NOW()")

    try:
        await s.execute(
            text(
                f"UPDATE sso_providers SET {', '.join(sets)} "
                "WHERE id = CAST(:id AS uuid)"
            ),
            params,
        )
    except Exception as e:
        msg = str(e).lower()
        if "unique" in msg or "sso_providers_name_key" in msg:
            await s.rollback()
            raise Conflict("provider name already exists") from e
        raise
    await document_repo.insert_audit(
        s, user_id=user["id"], action="sso_provider.update",
        target=f"sso_provider:{provider_id}",
        payload={
            k: v
            for k, v in body.model_dump(exclude={"oidc_client_secret"}).items()
            if v is not None
        }
        | (
            {"oidc_client_secret_changed": True}
            if body.oidc_client_secret is not None else {}
        ),
    )
    await s.commit()
    fresh = await _fetch_provider(s, provider_id)
    if not fresh:
        raise NotFound("provider vanished")
    return envelope(data=fresh)


@router.delete(
    "/admin/sso/providers/{provider_id}",
    status_code=204,
    summary="SSO 제공자 삭제 (admin)",
)
async def delete_provider(
    provider_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
    user: dict[str, Any] = Depends(require_admin),
) -> Response:
    p = await _fetch_provider(s, provider_id)
    if not p:
        raise NotFound("provider not found")
    await s.execute(
        text("DELETE FROM sso_providers WHERE id = CAST(:id AS uuid)"),
        {"id": provider_id},
    )
    await document_repo.insert_audit(
        s, user_id=user["id"], action="sso_provider.delete",
        target=f"sso_provider:{provider_id}",
        payload={"name": p.get("name")},
    )
    await s.commit()
    return Response(status_code=204)


# ── Public flow (placeholder) ────────────────────────────────────────────


@router.get(
    "/auth/sso/discover",
    summary="이메일 도메인으로 SSO 제공자 탐색 (public)",
)
async def discover(
    email: str = Query(..., min_length=3, max_length=320),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    if "@" not in email:
        raise ValidationFailed("email must contain '@'")
    domain = _normalize_domain(email.split("@", 1)[1])
    if not domain:
        raise ValidationFailed("email must contain a domain")
    row = (
        await s.execute(
            text(
                """
                SELECT id, kind, name
                FROM sso_providers
                WHERE enabled = TRUE AND email_domain = :d
                ORDER BY created_at ASC
                LIMIT 1
                """
            ),
            {"d": domain},
        )
    ).first()
    if not row:
        raise NotFound("no matching SSO provider")
    pid = str(row[0])
    return envelope(
        data={
            "provider_id": pid,
            "kind": row[1],
            "name": row[2],
            "login_url": f"/api/v1/auth/sso/{pid}/initiate",
        }
    )


class SsoNotImplemented(APIError):
    code = "SSO_NOT_IMPLEMENTED"
    http_status = 501
    message = "SSO 흐름 구현 대기 중"


@router.get(
    "/auth/sso/{provider_id}/initiate",
    summary="SSO 로그인 흐름 시작 (public, 현재 501 placeholder)",
)
async def initiate(
    provider_id: str = Path(..., min_length=1),
    s: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    # TODO (cycle 19+1) — actual flow:
    #   - kind == 'saml'  : build AuthnRequest via python3-saml, 302 to IdP SSO URL
    #   - kind == 'oidc'  : authlib authorization-code + PKCE, 302 to issuer
    # ACS / callback handlers will live alongside this router.
    p = await _fetch_provider(s, provider_id)
    if not p:
        raise NotFound("provider not found")
    if not p.get("enabled"):
        raise NotFound("provider not enabled")
    raise SsoNotImplemented(
        "SSO 흐름 구현 대기 중",
        details={"provider_id": provider_id, "kind": p.get("kind")},
    )
