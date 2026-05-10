"""Security middleware — per-IP rate limiting + standard hardening headers.

Wired in :func:`app.main.create_app`. Two responsibilities:

1. **Rate limiting** (per-IP token bucket). Uses the limiter in
   :mod:`app.middleware.rate_limit`. Bucket size depends on:

   * Strict ``/auth/*`` endpoints → 10/min (brute-force shield)
   * Bearer ``mxwp_…`` token  → 600/min (machine-to-machine)
   * Bearer JWT             → 300/min (logged-in user)
   * Anonymous              → 60/min

   The 429 response body matches the existing envelope and includes a
   ``Retry-After`` header.

2. **Hardening headers** on every response:

   ``X-Frame-Options: DENY``                    clickjacking
   ``X-Content-Type-Options: nosniff``          MIME sniffing
   ``Referrer-Policy: same-origin``             referrer leakage
   ``X-XSS-Protection: 1; mode=block``          legacy XSS auditor
   ``Strict-Transport-Security``                only when HTTPS
   ``Content-Security-Policy``                  scoped to self + MinIO

CSP rationale:

* ``default-src 'self'`` — deny third-party content by default.
* ``script-src 'self' 'unsafe-inline'`` (prod) / ``'self' 'unsafe-inline'
  'unsafe-eval'`` (dev). Vite's HMR runtime calls ``eval()`` so dev needs
  the relaxation; production builds ship pre-bundled JS where ``eval`` is
  never invoked. Dropping ``'unsafe-eval'`` in prod hardens us against
  XSS escalation if an HTML-injection bug ever lands.
  ``'unsafe-inline'`` stays for now — Tailwind-style inline event handlers
  and the LCP bootstrap snippet rely on it. Migrating to nonces is a
  follow-up.
* ``style-src 'self' 'unsafe-inline'`` — Tailwind's runtime utilities and
  the editor inject inline ``style="…"`` on selected nodes.
* ``img-src 'self' data: blob: <minio>`` — uploaded images are served
  from MinIO; ``data:`` and ``blob:`` cover paste-uploads + previews.
* ``font-src 'self'`` — bundled icon font, no Google Fonts.
* ``connect-src 'self' <minio>`` — XHR / SSE goes to the API + MinIO
  presigned PUTs only.
* ``frame-ancestors 'none'`` — duplicate of X-Frame-Options for modern
  browsers; defense in depth.
* ``base-uri 'self'`` — block ``<base href>`` injection.
* ``form-action 'self'`` — forms cannot post to a 3rd party.
"""
from __future__ import annotations

from typing import Awaitable, Callable
from urllib.parse import urlparse

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from ..core.config import get_settings
from . import rate_limit as _rl
from .rate_limit import get_limiter, is_strict_auth_path

# Endpoint paths skipped by rate limiting (operational health probes).
_RATE_LIMIT_EXEMPT: tuple[str, ...] = (
    "/api/v1/healthz",
)


def _client_ip(request: Request) -> str:
    """Extract the originating IP, honouring a single proxy hop.

    We never trust ``X-Forwarded-For`` blindly — but in container deploys
    the FastAPI process sits behind nginx/traefik and the source IP is in
    that header. For sandbox / direct calls fall back to ``request.client``.
    """
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # left-most entry is the original client
        first = fwd.split(",", 1)[0].strip()
        if first:
            return first
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _bucket_for(request: Request) -> tuple[int, int]:
    """Decide ``(capacity, refill_per_minute)`` for this request.

    Strict auth paths win first. Otherwise we look at the bearer token
    shape — ``mxwp_…`` is a personal API token (machine traffic, more
    headroom) vs. a JWT (interactive user) vs. anonymous.
    """
    path = request.url.path
    if is_strict_auth_path(path):
        return _rl.AUTH_ENDPOINT_PER_MIN, _rl.AUTH_ENDPOINT_PER_MIN

    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        token = auth.split(None, 1)[1].strip()
        if token.startswith("mxwp_"):
            return _rl.API_TOKEN_PER_MIN, _rl.API_TOKEN_PER_MIN
        if token:
            return _rl.AUTH_USER_PER_MIN, _rl.AUTH_USER_PER_MIN
    return _rl.ANON_PER_MIN, _rl.ANON_PER_MIN


def _rate_limited_response(retry_after: int) -> JSONResponse:
    body = {
        "data": None,
        "meta": None,
        "error": {
            "code": "RATE_LIMITED",
            "http_status": 429,
            "message": (
                f"요청이 너무 많습니다 — {retry_after}초 후 다시 시도하세요"
            ),
            "details": {"retry_after": retry_after},
        },
    }
    resp = JSONResponse(status_code=429, content=body)
    resp.headers["Retry-After"] = str(retry_after)
    return resp


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Apply per-IP token-bucket limits before the request reaches a route."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        path = request.url.path
        if path in _RATE_LIMIT_EXEMPT:
            return await call_next(request)

        # CORS pre-flight — never rate-limit OPTIONS, FE retries them
        # automatically and they carry no auth.
        if request.method == "OPTIONS":
            return await call_next(request)

        # Bucket key: prefer the bearer token tail for authenticated traffic so
        # a whole team behind a shared NAT doesn't share one bucket. Anonymous
        # traffic falls back to client IP (the only thing we can key on).
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            tok = auth_header.split(None, 1)[1].strip()
            # Use the last 32 chars of the token as the key — short enough to
            # cap memory in the LRU but long enough to be unique per user.
            bucket_key = f"u:{tok[-32:]}" if tok else _client_ip(request)
        else:
            bucket_key = _client_ip(request)
        capacity, refill = _bucket_for(request)
        allowed, retry_after = get_limiter().check_with(
            bucket_key, capacity=capacity, refill_per_minute=refill
        )
        if not allowed:
            return _rate_limited_response(retry_after)
        return await call_next(request)


def _csp_value(minio_origin: str, *, app_env: str) -> str:
    # `'unsafe-eval'` is only required by Vite's HMR runtime — production
    # builds ship pre-bundled JS that never calls eval(). We keep it on for
    # any non-production env (development / staging-with-HMR / test) and
    # drop it everywhere else so an HTML-injection bug can't escalate to
    # arbitrary script execution via eval(). The toggle is a string compare
    # rather than a hardcoded "production" because deployments may use
    # "prod" / "production" / "live" interchangeably; treat anything that
    # isn't explicitly a dev-class env as production.
    is_dev = app_env.lower() in {"development", "dev", "test", "testing"}
    script_src = (
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        if is_dev
        else "script-src 'self' 'unsafe-inline'"
    )
    parts = [
        "default-src 'self'",
        script_src,
        "style-src 'self' 'unsafe-inline'",
        f"img-src 'self' data: blob: {minio_origin}".strip(),
        "font-src 'self' data:",
        f"connect-src 'self' {minio_origin}".strip(),
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
    return "; ".join(p for p in parts if p)


def _origin_of(url: str) -> str:
    """Return scheme://host[:port] (CSP allowlist token) — empty on failure."""
    if not url:
        return ""
    try:
        u = urlparse(url)
    except Exception:  # noqa: BLE001
        return ""
    if not u.scheme or not u.netloc:
        return ""
    return f"{u.scheme}://{u.netloc}"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Append hardening headers to every outbound response."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        settings = get_settings()
        # Build the CSP allowlist for MinIO from the *public* endpoint —
        # browsers need to reach MinIO via the host-visible URL.
        minio_origin = _origin_of(getattr(settings, "minio_public_endpoint", "")) or _origin_of(
            getattr(settings, "minio_endpoint", "")
        )

        h = response.headers
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "same-origin")
        h.setdefault("X-XSS-Protection", "1; mode=block")
        h.setdefault(
            "Content-Security-Policy",
            _csp_value(minio_origin, app_env=getattr(settings, "app_env", "production")),
        )
        if request.url.scheme == "https":
            h.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


__all__ = [
    "RateLimitMiddleware",
    "SecurityHeadersMiddleware",
]
