# 게이트웨이 · 포털 위임 창구(POST /api/v1/auth/sso)와 관리자의 위임 회수 · 소속→팀 표
"""docs/llm-wiki C1~C3 · C5 — ste · HWAX Risk · 옛 RA `sso/heax.py` 와 같은 계약(HWAXPortal docs/sso-delegation/PLAN.md §1).

`POST /api/v1/auth/sso` — 헤더 `X-Heax-Gateway-Secret` · `X-Heax-User-Email`(필수) · `X-Heax-User-Name`(퍼센트 인코딩) ·
`X-Heax-Client`(`gateway` · `hwax-portal` …). 비밀이 비면 404(꺼짐) · 틀리면 401 · 비활성 · 자동 생성 꺼짐 403 · 이메일 없음 400 ·
200 `{access_token, token_type, expires_in}`(봉투 `data` 안 — 게이트웨이 · 포털은 토큰을 깊이 찾는다).

- 진짜 호출자는 `X-Hwax-Delegate-Email` 이 먼저다 — 게이트웨이가 함께 싣는다(HWAX Risk `post_auth_sso` 와 같은 규칙). 둘 다 비밀
  대조 뒤에만 읽는다 — 비밀을 쥔 쪽은 원래 아무 이메일의 토큰이나 받을 수 있다.
- 세대는 사람 × 클라이언트마다 따로다 — `gateway` 발급이 `hwax-portal` 발급 · 웹 세션을 회수하지 않는다. **발급은 아무것도 회수하지
  않는다** — 게이트웨이 프로세스가 여럿이면 서로의 토큰을 죽이며 핑퐁한다. 회수는 관리자가 세대를 올려서 한다.
"""
from __future__ import annotations

import hmac
import re
from typing import Any
from urllib.parse import unquote
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_admin
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import APIError, NotFound, envelope
from app.core.portal_identity import secret_tag
from app.core.security import make_delegated_token
from app.repos import document_repo
from app.routers.auth import _write_auth_audit
from app.routers.portal_sso import _create_user, _find_user

router = APIRouter(prefix="/api/v1", tags=["portal-delegation"])

# 게이트웨이는 최대 12시간 캐시하고(USER_PAT_TTL_S) 401 이면 한 번 다시 받는다 — 같은 길이로 준다.
DELEGATED_TTL_SECONDS = 12 * 3600
_CLIENT_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,39}$")


class _SsoDisabledError(APIError):
    http_status = 404
    code = "sso_disabled"


class _BadSecretError(APIError):
    http_status = 401
    code = "bad_secret"


class _NoEmailError(APIError):
    http_status = 400
    code = "no_email"


class _BadClientError(APIError):
    http_status = 400
    code = "bad_client"


class _InactiveUserError(APIError):
    http_status = 403
    code = "user_inactive"


class _JitDisabledError(APIError):
    http_status = 403
    code = "jit_disabled"


class _AffMapValidationError(APIError):
    http_status = 422
    code = "VALIDATION_ERROR"


@router.post("/auth/sso")
async def delegate(request: Request, s: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    cfg = get_settings()
    secret = cfg.mxwp_sso_secret
    if not secret:
        raise _SsoDisabledError("SSO 위임이 설정돼 있지 않다")
    got = request.headers.get("x-heax-gateway-secret", "")
    if not hmac.compare_digest(got.encode("utf-8"), secret.encode("utf-8")):
        raise _BadSecretError("게이트웨이 비밀이 맞지 않는다")

    delegate_email = request.headers.get("x-hwax-delegate-email")
    email = (delegate_email if delegate_email is not None else request.headers.get("x-heax-user-email", "")).strip()
    if "@" not in email:
        raise _NoEmailError("X-Heax-User-Email 이 없거나 이메일 꼴이 아니다")
    client = (request.headers.get("x-heax-client") or "gateway").strip().lower()
    if not _CLIENT_RE.match(client):
        raise _BadClientError("X-Heax-Client 꼴이 틀렸다(영소문자 · 숫자 · _ . - 40자까지)")
    name = unquote(request.headers.get("x-heax-user-name", "")).strip()

    user = await _find_user(s, email)
    created = False
    if user is None:
        if not cfg.mxwp_sso_jit_create:
            raise _JitDisabledError("처음 보는 사람이다 — 자동 생성이 꺼져 있다(MXWP_SSO_JIT_CREATE)")
        # 발급 요청에는 소속 증명이 없다 — 게이트웨이로 먼저 온 사람은 소속→팀 표를 못 쓰고 첫 팀에 든다.
        user = await _create_user(s, email=email, name=name, affiliation=None)
        created = True
    elif not user["is_active"]:
        raise _InactiveUserError("비활성 사용자다")

    generation = (await s.execute(
        text("""
            INSERT INTO sso_delegations (user_id, client, generation, issued_count, last_issued_at)
            VALUES (CAST(:u AS uuid), :c, 1, 1, NOW())
            ON CONFLICT (user_id, client) DO UPDATE
               SET issued_count = sso_delegations.issued_count + 1, last_issued_at = NOW()
            RETURNING generation
        """),
        {"u": user["id"], "c": client},
    )).scalar_one()
    await s.commit()
    token = make_delegated_token(
        user["id"], client=client, generation=generation, email=email,
        secret_tag=secret_tag(secret), ttl_seconds=DELEGATED_TTL_SECONDS,
    )
    await _write_auth_audit(
        s, user_id=user["id"], action="auth.sso.delegate", target=f"user:{user['id']}",
        payload={"client": client, "generation": generation, "created": created},
        ip=request.client.host if request.client else None,
    )
    return envelope(data={"access_token": token, "token_type": "bearer", "expires_in": DELEGATED_TTL_SECONDS})


class RevokeBody(BaseModel):
    client: str | None = Field(default=None, max_length=40)


@router.post("/admin/sso-delegations/{user_id}/revoke")
async def revoke_delegations(
    user_id: UUID,
    body: RevokeBody | None = None,
    s: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """세대를 올린다 — 그 사람(그 클라이언트)으로 나간 위임 토큰이 바로 죽는다. 다음 발급은 새 세대로 나간다."""
    client = body.client.strip().lower() if body and body.client else None
    params: dict[str, Any] = {"u": str(user_id)}
    if client:
        params["c"] = client
    rows = (await s.execute(
        text(f"""
            UPDATE sso_delegations SET generation = generation + 1
            WHERE user_id = CAST(:u AS uuid) {"AND client = :c" if client else ""}
            RETURNING client, generation
        """),
        params,
    )).all()
    revoked = [{"client": r[0], "generation": r[1]} for r in rows]
    await document_repo.insert_audit(
        s, user_id=admin["id"], action="auth.sso.revoke", target=f"user:{user_id}",
        payload={"client": client, "revoked": revoked},
    )
    await s.commit()
    return envelope(data={"revoked": revoked})


class AffTeamBody(BaseModel):
    team_id: UUID


def _affiliation(raw: str) -> str:
    aff = raw.strip()
    if not aff or len(aff) > 120 or any(ch.isspace() or ch == "," for ch in aff):
        raise _AffMapValidationError("소속 id 는 공백 · 쉼표 없이 120자까지다", details={"got": raw})
    return aff


@router.get("/admin/aff-team-map")
async def list_aff_team_map(
    s: AsyncSession = Depends(get_db),
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    rows = (await s.execute(text("""
        SELECT m.affiliation, m.team_id, t.slug, t.name, m.updated_at
        FROM wiki_aff_team_map m JOIN teams t ON t.id = m.team_id
        ORDER BY m.affiliation
    """))).all()
    data = [{"affiliation": r[0], "team_id": str(r[1]), "team_slug": r[2], "team_name": r[3],
             "updated_at": r[4].isoformat()} for r in rows]
    return envelope(data=data, meta={"count": len(data)})


@router.put("/admin/aff-team-map/{affiliation}")
async def put_aff_team_map(
    affiliation: str,
    body: AffTeamBody,
    s: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    aff = _affiliation(affiliation)
    if aff == "*":  # 포털의 '*' 는 소속이 갈리지 않은 모두 — 넣으면 포털로 들어오는 사람이 모두 이 팀으로 옮겨진다(10-27 MW-05)
        raise _AffMapValidationError("'*' 는 모든 사람이다 — 소속 → 팀 표에 넣지 않는다", details={"got": affiliation})
    team = (await s.execute(
        text("SELECT slug, name FROM teams WHERE id = CAST(:t AS uuid)"), {"t": str(body.team_id)},
    )).first()
    if team is None:
        raise NotFound("팀이 없다", details={"team_id": str(body.team_id)})
    await s.execute(
        text("""
            INSERT INTO wiki_aff_team_map (affiliation, team_id, updated_by, updated_at)
            VALUES (:a, CAST(:t AS uuid), CAST(:u AS uuid), NOW())
            ON CONFLICT (affiliation) DO UPDATE
               SET team_id = EXCLUDED.team_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()
        """),
        {"a": aff, "t": str(body.team_id), "u": admin["id"]},
    )
    await document_repo.insert_audit(
        s, user_id=admin["id"], action="wiki.aff_team_map.set", target=f"affiliation:{aff}",
        payload={"team_id": str(body.team_id)},
    )
    await s.commit()
    return envelope(data={"affiliation": aff, "team_id": str(body.team_id), "team_slug": team[0], "team_name": team[1]})


@router.delete("/admin/aff-team-map/{affiliation}")
async def delete_aff_team_map(
    affiliation: str,
    s: AsyncSession = Depends(get_db),
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    aff = _affiliation(affiliation)
    gone = (await s.execute(
        text("DELETE FROM wiki_aff_team_map WHERE affiliation = :a RETURNING affiliation"), {"a": aff},
    )).scalar()
    if gone is None:
        raise NotFound("그 소속의 대응이 없다", details={"affiliation": aff})
    await document_repo.insert_audit(
        s, user_id=admin["id"], action="wiki.aff_team_map.delete", target=f"affiliation:{aff}", payload={},
    )
    await s.commit()
    return envelope(data={"affiliation": aff, "deleted": True})
