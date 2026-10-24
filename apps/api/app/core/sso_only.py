# SSO 전용 모드 — 사람은 포털 진입으로만 들어온다(가입 · 비밀번호 로그인 닫힘 · 비상 관리자만 예외 · 세션은 포털 사진 수명 안)
"""사용자 결정 10-25 — "가입자를 따로 받지 않는다"(docs/llm-wiki checklist 'SSO 전용', 포털 세션 MW-D22).

- `MXWP_SSO_ONLY` 가 켜지면 가입 · 등록은 늘 403, 비밀번호 로그인 · TOTP · 비밀번호 찾기 · 재설정 · 이메일 인증은 비상 관리자
  (`MXWP_LOCAL_LOGIN_ALLOW`)만 — 포털 SSO 가 고장 났을 때 관리할 길이다. 403 은 `SSO_ONLY` 와 포털 진입 링크를 싣는다.
- 막는 판정은 비밀번호를 보기 전에 한다 — 뒤에 하면 막힌 사람에게 비밀번호가 맞았는지(403 · 401)를 알려 준다.
- 세션은 포털 진입 한 번 — 진입 세션의 refresh 는 소속 사진 수명(`ACCESS_MAX_AGE_H`) 이하, 사진이 낡거나 없으면 refresh 가 401
  `PORTAL_REENTRY` 다(켜기 전에 비밀번호로 연 7일 세션도 여기서 끝난다). 화면은 진입 링크로 저절로 다녀온다.
- API 토큰 · 게이트웨이 위임은 그대로다(사람 웹 로그인만 바뀐다).
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.core.config import get_settings
from app.core.errors import APIError
from app.wiki.audience import ACCESS_MAX_AGE_H, _fresh


class SsoOnly(APIError):
    http_status = 403
    code = "SSO_ONLY"
    message = "MX 백서는 포털로만 들어온다 — 포털의 MX 백서 진입 링크로 들어오라"


class PortalReentry(APIError):
    http_status = 401
    code = "PORTAL_REENTRY"
    message = "포털로 다시 들어오라 — 포털에서 받은 소속 · 플랫폼이 오래됐거나 없다"


def enabled() -> bool:
    return get_settings().mxwp_sso_only


def local_allowed(email: str | None) -> bool:
    allow = {e.strip().lower() for e in get_settings().mxwp_local_login_allow.split(",") if e.strip()}
    return bool(email) and str(email).strip().lower() in allow


def _details() -> dict[str, Any]:
    return {"launch_url": get_settings().portal_launch_url}


def guard(email: str | None, *, local_ok: bool = True) -> None:
    """SSO 전용이면 막는다 — `local_ok` 면 비상 관리자는 통과(가입처럼 아무도 안 되는 길은 False)."""
    if enabled() and not (local_ok and local_allowed(email)):
        raise SsoOnly(details=_details())


def session_ttl_seconds() -> int:
    """포털 진입 세션의 refresh 수명 — SSO 전용이면 소속 사진 수명 이하."""
    ttl = get_settings().jwt_refresh_ttl_seconds
    return min(ttl, ACCESS_MAX_AGE_H * 3600) if enabled() else ttl


def check_refresh(email: str | None, portal_access_at: Any) -> None:
    """SSO 전용이면 refresh 는 포털 사진이 살아 있을 때만(비상 관리자 빼고)."""
    if enabled() and not local_allowed(email) and not _fresh(portal_access_at, datetime.now(UTC)):
        raise PortalReentry(details=_details())
