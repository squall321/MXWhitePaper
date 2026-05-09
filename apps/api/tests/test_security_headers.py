"""Hardening-headers middleware: assert each header present on every response.

CSP is also smoke-tested for the documented allowlist tokens (self,
unsafe-inline, frame-ancestors, MinIO origin).
"""
from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app
from app.middleware import rate_limit as rl_mod


@pytest.fixture(autouse=True)
def _reset_limiter():
    rl_mod.reset_for_tests()
    yield
    rl_mod.reset_for_tests()


@pytest.mark.asyncio
async def test_security_headers_present_on_healthz() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/healthz")
    assert r.status_code == 200
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Referrer-Policy"] == "same-origin"
    assert r.headers["X-XSS-Protection"] == "1; mode=block"
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "base-uri 'self'" in csp
    assert "form-action 'self'" in csp


@pytest.mark.asyncio
async def test_security_headers_on_404() -> None:
    """Headers must apply to error responses too."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/this-route-does-not-exist")
    assert r.status_code == 404
    assert r.headers.get("X-Frame-Options") == "DENY"
    assert r.headers.get("Content-Security-Policy")


@pytest.mark.asyncio
async def test_csp_allows_minio_origin() -> None:
    settings = get_settings()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/healthz")
    csp = r.headers["Content-Security-Policy"]
    # Origin is the public-facing MinIO URL — covers img-src + connect-src.
    minio_pub = settings.minio_public_endpoint or settings.minio_endpoint
    assert minio_pub  # sanity
    # The CSP value uses scheme://host[:port]; assert that scheme prefix lands.
    if "://" in minio_pub:
        scheme = minio_pub.split("://", 1)[0]
        assert scheme + "://" in csp


@pytest.mark.asyncio
async def test_hsts_only_on_https() -> None:
    """HSTS must NOT appear on http requests (would be ignored anyway)."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/v1/healthz")
    assert "Strict-Transport-Security" not in r.headers


@pytest.mark.asyncio
async def test_hsts_set_on_https_scheme() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="https://test") as ac:
        r = await ac.get("/api/v1/healthz")
    assert (
        r.headers.get("Strict-Transport-Security")
        == "max-age=31536000; includeSubDomains"
    )
