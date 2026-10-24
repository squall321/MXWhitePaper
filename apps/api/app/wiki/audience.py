# 보이기 범위 — 읽는 사람(요청 문맥)의 토큰을 셈하고 문서 읽기 SQL 에 붙일 술어를 한 곳에서 짓는다
"""CONTRACTS §2-11 · request §5-12 · WK-D15(사용자 결정 Q4).

문서는 둘 다 맞아야 보인다.
1. 위키 문서(`wiki_pages` 줄이 있다)면 그 `audience` 토큰을 **모두** 가진 사람 — 토큰은 `org`(MXWP 사용자 모두) ·
   `aff:<소속>` · `plat:<열쇠>` · `user:<id>`. 소속 · 플랫폼은 포털이 준 값이 `ACCESS_MAX_AGE_H` 안일 때만 친다(닫힌 쪽).
2. `confidentiality=restricted` 면(위키든 아니든) 작성자(`owner_id`) · 검토자(`document_reviewers`) · metadata owners · reviewers 에
   이메일로 적힌 사람만.
admin 은 전부 본다(한 장 읽기에서 자기 토큰으로는 못 볼 문서를 읽으면 감사에 남긴다). 위임 토큰은 admin 을 owner 로 낮춰 온다.

읽는 사람은 요청 문맥(ContextVar)이다 — 미들웨어가 요청마다 비우고(`ViewerContextMiddleware`) 인증(`get_current_user`)이 채운다.
**문맥이 비어 있으면 술어를 짓지 않고 `ViewerMissing` 을 던진다** — 인증 없는 길 · 배경 작업이 걸러지지 않은 채 문서를 읽는 것을
조용히 넘기지 않게. 배경 작업은 `acting_as(SYSTEM)`, 공개 길(공유 링크 · oEmbed)은 `acting_as(ANONYMOUS)` 를 스스로 고른다.
"""
from __future__ import annotations

import contextlib
from collections.abc import Iterator
from contextvars import ContextVar
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Any

# 규칙서 `access.max_age_h`(SCHEMA-DRAFT §6) 의 첫 값 — 규칙서가 서면(W4) 그쪽에서 읽는다.
ACCESS_MAX_AGE_H = 24


@dataclass(frozen=True)
class Viewer:
    kind: str  # user · system · anonymous
    user_id: str | None = None
    email: str | None = None
    is_admin: bool = False
    tokens: tuple[str, ...] = ()

    @property
    def sees_all(self) -> bool:
        return self.kind == "system" or self.is_admin


SYSTEM = Viewer(kind="system")
# 공유 링크 · oEmbed 처럼 로그인 없이 보는 길 — `["org"]` 문서만, restricted 는 못 본다.
ANONYMOUS = Viewer(kind="anonymous", tokens=("org",))


class ViewerMissing(RuntimeError):
    """읽는 사람을 모른 채 문서를 읽으려 했다 — 그 길이 `acting_as(...)` 를 골라야 한다."""


_current: ContextVar[Viewer | None] = ContextVar("mxwp_viewer", default=None)


def _fresh(at: Any, now: datetime) -> bool:
    if not at:
        return False
    if isinstance(at, str):
        try:
            at = datetime.fromisoformat(at)
        except ValueError:
            return False
    if not isinstance(at, datetime):
        return False
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    return now - at <= timedelta(hours=ACCESS_MAX_AGE_H)


def viewer_from_user(user: dict[str, Any], *, now: datetime | None = None) -> Viewer:
    """get_current_user 의 dict → Viewer. 소속 · 플랫폼은 받은 지 오래면(또는 위임 호출에 증명이 없으면) 없는 것으로."""
    uid = str(user["id"])
    tokens = ["org", f"user:{uid}"]
    if _fresh(user.get("portal_access_at"), now or datetime.now(UTC)):
        if user.get("portal_affiliation"):
            tokens.append(f"aff:{user['portal_affiliation']}")
        tokens.extend(p for p in (user.get("portal_plat") or []) if isinstance(p, str) and p.startswith("plat:"))
    return Viewer(kind="user", user_id=uid, email=(user.get("email") or "").lower() or None,
                  is_admin=user.get("role") == "admin", tokens=tuple(sorted(set(tokens))))


def set_viewer(viewer: Viewer | None) -> None:
    _current.set(viewer)


def current_viewer() -> Viewer:
    v = _current.get()
    if v is None:
        raise ViewerMissing("읽는 사람을 모른다 — 인증 없는 길이나 배경 작업은 audience.acting_as(...) 로 고른다")
    return v


@contextlib.contextmanager
def acting_as(viewer: Viewer) -> Iterator[Viewer]:
    token = _current.set(viewer)
    try:
        yield viewer
    finally:
        _current.reset(token)


class ViewerContextMiddleware:
    """요청마다 읽는 사람 문맥을 비우고 끝나면 되돌린다 — 같은 task 에서 도는 시험(ASGITransport)에 앞 요청 값이 새지 않게."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        token = _current.set(None)
        try:
            await self.app(scope, receive, send)
        finally:
            _current.reset(token)


def visible_sql(alias: str = "d") -> str:
    """`documents` 별칭 하나에 붙일 술어(괄호째). 값은 `sql_params()` 로 넘긴다."""
    owners = f"{alias}.content_json #> '{{metadata,owners}}'"
    reviewers = f"{alias}.content_json #> '{{metadata,reviewers}}'"

    def _arr(expr: str) -> str:
        return f"(CASE WHEN jsonb_typeof({expr}) = 'array' THEN {expr} ELSE '[]'::jsonb END)"

    return f"""(
        CAST(:_aud_all AS boolean)
        OR (
            NOT EXISTS (
                SELECT 1 FROM wiki_pages _wp
                WHERE _wp.doc_id = {alias}.id AND NOT (_wp.audience <@ CAST(:_aud_tokens AS text[]))
            )
            AND (
                COALESCE({alias}.content_json #>> '{{metadata,confidentiality}}', '') <> 'restricted'
                OR {alias}.owner_id = CAST(:_aud_uid AS uuid)
                OR EXISTS (
                    SELECT 1 FROM document_reviewers _dr
                    WHERE _dr.document_id = {alias}.id AND _dr.reviewer_user_id = CAST(:_aud_uid AS uuid)
                )
                OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements_text({_arr(owners)} || {_arr(reviewers)}) _p(v)
                    WHERE lower(_p.v) = :_aud_email
                )
            )
        )
    )"""


def slug_visible_sql(slug_expr: str, alias: str = "_sv") -> str:
    """slug 가 가리키는 문서가 없거나(미작성 링크) 보이면 참 — 문서 slug 를 칸으로 가진 표(doc_triples 등)에 붙인다."""
    return f"NOT EXISTS (SELECT 1 FROM documents {alias} WHERE {alias}.slug = {slug_expr} AND NOT {visible_sql(alias)})"


def sql_params(viewer: Viewer | None = None) -> dict[str, Any]:
    v = viewer or current_viewer()
    return {
        "_aud_all": v.sees_all,
        "_aud_tokens": list(v.tokens),
        "_aud_uid": v.user_id,
        "_aud_email": v.email,
    }


async def viewer_for_user(s: Any, user_id: str) -> Viewer | None:
    """받는 사람(알림 · 메일)의 Viewer — 요청이 아닌 곳에서 '그 사람이 볼 수 있나' 를 판정할 때. 비활성이면 None."""
    from sqlalchemy import text

    row = (await s.execute(text("""
        SELECT id, email, role, portal_affiliation, portal_plat, portal_access_at, is_active
        FROM users WHERE id = CAST(:id AS uuid)
    """), {"id": user_id})).first()
    if row is None or not row[6]:
        return None
    return viewer_from_user({"id": str(row[0]), "email": row[1], "role": row[2], "portal_affiliation": row[3],
                             "portal_plat": list(row[4]) if row[4] is not None else None, "portal_access_at": row[5]})


async def can_see(s: Any, viewer: Viewer | None, doc_id: str) -> bool:
    if viewer is None:
        return False
    from sqlalchemy import text

    return (await s.execute(
        text(f"SELECT 1 FROM documents d WHERE d.id = CAST(:id AS uuid) AND {visible_sql('d')}"),
        {"id": doc_id, **sql_params(viewer)},
    )).first() is not None


async def audit_admin_override(doc: dict[str, Any]) -> None:
    """admin 이 자기 토큰으로는 못 볼 문서를 꺼내면 감사에 남긴다(CONTRACTS §2-11). GET 은 커밋하지 않으니 따로 세션을 연다."""
    v = _current.get()
    if v is None or v.kind != "user" or not v.is_admin:
        return
    from sqlalchemy import text

    from app.core.db import session_scope

    async with session_scope() as s2:
        if await can_see(s2, replace(v, is_admin=False), str(doc["id"])):
            return
        await s2.execute(text("""
            INSERT INTO audit_logs (user_id, action, target, payload)
            VALUES (CAST(:u AS uuid), 'document.read.admin_override', :t, CAST('{}' AS jsonb))
        """), {"u": v.user_id, "t": f"document:{doc.get('slug')}"})
        await s2.commit()
