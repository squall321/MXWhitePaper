"""Custom CSS endpoint contract tests (cycle 18).

Covers:

* PATCH /documents/:slug/custom-css round-trips through ``content_json``.
* Sanitizer is applied server-side: dangerous patterns disappear and
  ``meta.warnings`` lists labels.
* Empty body removes the field entirely.
* If-Match enforcement (412 when missing).
* Render injects the persisted CSS as a ``<style>`` block in ``<head>``.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.html_renderer import RenderOptions, render_namuwiki_html

SLUG = "onboarding-guide"
_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
SAMPLE_PATH = _SAMPLES / "02-onboarding-guide.json"


async def _restore_seed(ac: AsyncClient) -> tuple[dict, str]:
    sample = json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))
    r0 = await ac.get(f"/api/v1/documents/{SLUG}")
    assert r0.status_code == 200
    etag0 = r0.headers["etag"]
    r1 = await ac.put(
        f"/api/v1/documents/{SLUG}",
        json=sample,
        headers={"If-Match": etag0},
    )
    assert r1.status_code == 200, r1.text
    r2 = await ac.get(f"/api/v1/documents/{SLUG}")
    return r2.json()["data"], r2.headers["etag"]


@pytest.mark.asyncio
async def test_patch_custom_css_round_trips() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _, etag = await _restore_seed(ac)
        css = ".doc-title { color: #1428a0; font-weight: 700; }"
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/custom-css",
            json={"custom_css": css},
            headers={"If-Match": etag},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "etag" in body["meta"]
        assert body["meta"]["warnings"] == []
        assert body["data"]["custom_css"] == css

        # Round-trip via GET to confirm persistence in content_json.
        r2 = await ac.get(f"/api/v1/documents/{SLUG}")
        content = r2.json()["data"]["content"]
        assert content.get("custom_css") == css


@pytest.mark.asyncio
async def test_patch_custom_css_strips_xss_and_returns_warnings() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _, etag = await _restore_seed(ac)
        evil = (
            "@import 'evil.css';\n"
            "body { color: red; }\n"
            ".x { background: url(javascript:alert(1)); }\n"
            "<script>alert(2)</script>\n"
        )
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/custom-css",
            json={"custom_css": evil},
            headers={"If-Match": etag},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        sanitized = body["data"]["custom_css"]
        assert "javascript" not in sanitized
        assert "@import" not in sanitized.lower()
        assert "<script" not in sanitized.lower()
        warnings = body["meta"]["warnings"]
        for label in ("import", "url-javascript", "script-block"):
            assert label in warnings, warnings


@pytest.mark.asyncio
async def test_patch_custom_css_empty_clears_field() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _, etag = await _restore_seed(ac)
        # Populate first.
        r1 = await ac.patch(
            f"/api/v1/documents/{SLUG}/custom-css",
            json={"custom_css": "body { color: red; }"},
            headers={"If-Match": etag},
        )
        assert r1.status_code == 200, r1.text
        etag2 = r1.headers["etag"]

        # Clear with empty string.
        r2 = await ac.patch(
            f"/api/v1/documents/{SLUG}/custom-css",
            json={"custom_css": ""},
            headers={"If-Match": etag2},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["data"]["custom_css"] == ""

        r3 = await ac.get(f"/api/v1/documents/{SLUG}")
        content = r3.json()["data"]["content"]
        assert "custom_css" not in content or not content["custom_css"]


@pytest.mark.asyncio
async def test_patch_custom_css_requires_if_match() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _restore_seed(ac)
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/custom-css",
            json={"custom_css": "body { color: red; }"},
        )
        assert r.status_code == 412


@pytest.mark.asyncio
async def test_patch_custom_css_max_length_enforced() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _, etag = await _restore_seed(ac)
        oversized = "/* " + ("a" * 11_000) + " */"
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/custom-css",
            json={"custom_css": oversized},
            headers={"If-Match": etag},
        )
        assert r.status_code == 422, r.text


def test_renderer_injects_custom_css_style_tag() -> None:
    """Renderer-level: ``custom_css`` becomes a sanitized ``<style>`` in head."""
    doc = {
        "schema_version": "1.0",
        "id": "01TESTDOC0000000000000000Z",
        "slug": "fixture-css",
        "title": "Branded",
        "metadata": {
            "division": "MX",
            "owners": ["someone@example.com"],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [
            {
                "id": "01SEC00000000000000000000A",
                "number": "1",
                "level": 1,
                "title": "Hello",
                "blocks": [],
                "subsections": [],
            }
        ],
        "custom_css": ".doc-title { color: #1428a0; }",
    }
    out = render_namuwiki_html(doc, options=RenderOptions())
    assert 'data-mxwp-custom-css="1"' in out
    assert ".doc-title { color: #1428a0; }" in out


def test_renderer_strips_xss_even_if_unsanitized_in_storage() -> None:
    """Defense in depth: even if persisted CSS slipped past the API
    (e.g. import path), the renderer scrubs again before injecting."""
    doc = {
        "schema_version": "1.0",
        "id": "01TESTDOC0000000000000000Z",
        "slug": "fixture-css-evil",
        "title": "Branded",
        "metadata": {
            "division": "MX",
            "owners": ["someone@example.com"],
            "tags": [],
            "confidentiality": "internal",
        },
        "sections": [
            {
                "id": "01SEC00000000000000000000A",
                "number": "1",
                "level": 1,
                "title": "Hello",
                "blocks": [],
                "subsections": [],
            }
        ],
        "custom_css": "body{} <script>alert(1)</script> .x{background:url(javascript:alert(2));}",
    }
    out = render_namuwiki_html(doc, options=RenderOptions())
    assert "<script" not in out.lower() or "data-mxwp-custom-css" in out
    # No script execution surface in the injected style block.
    style_idx = out.find('data-mxwp-custom-css="1"')
    assert style_idx > 0
    style_end = out.find("</style>", style_idx)
    style_block = out[style_idx:style_end]
    assert "<script" not in style_block.lower()
    assert "javascript" not in style_block
