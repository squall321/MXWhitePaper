"""Cycle 0024 — API token scope enforcement.

Cycle 0023 stored `api_tokens.scopes` (JSONB) but the auth middleware accepted
any `mxwp_*` token without checking verb-vs-scope. This module owns the scope
vocabulary and the `check_scope(scopes, method, path)` predicate.

Vocabulary (mirrored in the FE create form):

  read   → safe verbs only (GET / HEAD)
  write  → read + body verbs (POST / PUT / PATCH / DELETE) on non-admin paths
  admin  → read + write + any verb on /admin/* paths

Special-case paths:
  - /me/*    — always allowed regardless of scope. The token *belongs to* the
               user, so scope-checking the user's own profile/tokens endpoint
               would lock people out of revoking their own credentials.
  - /admin/* — requires the 'admin' scope. 'write' alone is not enough.

Backwards compat: tokens minted before Cycle 0024 may have `scopes == []`
(empty JSONB). Treat that as the implicit `['read']` default — matches the
default the FE form already used.

Pure functions only, no DB. Tested in isolation in
`tests/test_api_token_scopes.py`.
"""
from __future__ import annotations

# verbs each named scope grants. 'admin' is the special wildcard.
SCOPE_DEFINITIONS: dict[str, object] = {
    "read": ["GET", "HEAD"],
    "write": ["POST", "PUT", "PATCH", "DELETE"],
    "admin": "*",
}

_READ_VERBS: frozenset[str] = frozenset(SCOPE_DEFINITIONS["read"])  # type: ignore[arg-type]
_WRITE_VERBS: frozenset[str] = frozenset(SCOPE_DEFINITIONS["write"])  # type: ignore[arg-type]


def _is_admin_path(path: str) -> bool:
    """`/admin` and `/admin/...` (also tolerates the `/api/v1` prefix)."""
    p = path or ""
    # strip a leading `/api/v1` if present so the check works whether the
    # caller passes the full mounted path or just the router-relative one.
    for prefix in ("/api/v1", "/api"):
        if p.startswith(prefix + "/"):
            p = p[len(prefix):]
            break
    return p == "/admin" or p.startswith("/admin/")


def _is_me_path(path: str) -> bool:
    p = path or ""
    for prefix in ("/api/v1", "/api"):
        if p.startswith(prefix + "/"):
            p = p[len(prefix):]
            break
    return p == "/me" or p.startswith("/me/")


def required_scope_for(method: str, path: str) -> str:
    """Human-readable scope name reported in the 403 message."""
    if _is_admin_path(path):
        return "admin"
    if (method or "").upper() in _READ_VERBS:
        return "read"
    return "write"


def check_scope(scopes: list[str] | None, method: str, path: str) -> bool:
    """True iff the token's scopes permit `method path`.

    See module docstring for the full rule table.
    """
    m = (method or "").upper()
    # /me/* is always permitted — the user is operating on their own account.
    if _is_me_path(path):
        return True

    # Empty scopes = legacy token = implicit 'read'.
    effective: set[str] = {s for s in (scopes or []) if isinstance(s, str)}
    if not effective:
        effective = {"read"}

    is_admin_path = _is_admin_path(path)

    if "admin" in effective:
        # admin = wildcard
        return True

    if is_admin_path:
        # /admin/* requires 'admin' scope explicitly
        return False

    if "write" in effective:
        return m in _READ_VERBS or m in _WRITE_VERBS

    if "read" in effective:
        return m in _READ_VERBS

    return False
