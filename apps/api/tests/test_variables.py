"""Variable substitution helper + endpoint contract tests."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.variables import substitute, walk_doc_substitute

SLUG = "onboarding-guide"
_SAMPLES = Path("/workspace/packages/shared/samples")
if not _SAMPLES.exists():
    _SAMPLES = Path(__file__).resolve().parents[3] / "packages" / "shared" / "samples"
SAMPLE_PATH = _SAMPLES / "02-onboarding-guide.json"


# ── pure helper ──────────────────────────────────────────────────────


def test_substitute_resolves_defined_variables() -> None:
    out = substitute("Hello {{user}}!", {"user": "Park"})
    assert out == "Hello Park!"


def test_substitute_uses_fallback_when_missing() -> None:
    out = substitute("Today: {{date|TBD}}", {})
    assert out == "Today: TBD"


def test_substitute_keeps_token_literal_when_unfilled_and_no_fallback() -> None:
    out = substitute("Hi {{user}}", {})
    assert out == "Hi {{user}}"


def test_substitute_handles_multiple_tokens_in_one_string() -> None:
    out = substitute("{{a}} + {{b}} = {{c|?}}", {"a": "1", "b": "2"})
    assert out == "1 + 2 = ?"


def test_substitute_ignores_invalid_token_names() -> None:
    # Spaces inside the name aren't part of the grammar.
    out = substitute("{{not a name}}", {"not a name": "X"})
    assert out == "{{not a name}}"


def test_substitute_passthrough_for_empty_or_no_tokens() -> None:
    assert substitute("", {"a": "1"}) == ""
    assert substitute("plain text", {"a": "1"}) == "plain text"


# ── walker ──────────────────────────────────────────────────────────


def _doc_with_blocks(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "id": "01TESTDOC0000000000000000Z",
        "slug": "fixture-vars",
        "title": "{{title}}",
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
                "title": "{{section_title|기본 섹션}}",
                "blocks": blocks,
                "subsections": [],
            }
        ],
        "variables": {"section_title": "본문"},
    }


def test_walk_substitutes_paragraph_text() -> None:
    doc = _doc_with_blocks([
        {"type": "paragraph", "id": "01P000000000000000000000A1", "text": "Hi {{user}}"}
    ])
    out = walk_doc_substitute(doc, {"user": "Park", "section_title": "본문"})
    assert out["sections"][0]["blocks"][0]["text"] == "Hi Park"
    # Section title also resolved.
    assert out["sections"][0]["title"] == "본문"
    # Doc title is OUTSIDE the walker's scope (titles are metadata-ish).
    assert out["title"] == "{{title}}"


def test_walk_skips_code_blocks() -> None:
    doc = _doc_with_blocks([
        {
            "type": "code",
            "id": "01C000000000000000000000A2",
            "language": "python",
            "code": "secret = {{secret}}",
        }
    ])
    out = walk_doc_substitute(doc, {"secret": "leaked"})
    assert out["sections"][0]["blocks"][0]["code"] == "secret = {{secret}}"


def test_walk_substitutes_table_and_list() -> None:
    doc = _doc_with_blocks([
        {
            "type": "table",
            "id": "01T000000000000000000000A3",
            "headers": ["{{h1}}", "값"],
            "rows": [["{{v1}}", "{{v2|기본값}}"]],
        },
        {
            "type": "list",
            "id": "01L000000000000000000000A4",
            "style": "bullet",
            "items": ["항목 {{x}}", "정적"],
        },
    ])
    out = walk_doc_substitute(doc, {"h1": "지표", "v1": "10"})
    table = out["sections"][0]["blocks"][0]
    assert table["headers"] == ["지표", "값"]
    assert table["rows"][0] == ["10", "기본값"]
    list_block = out["sections"][0]["blocks"][1]
    assert list_block["items"][0] == "항목 {{x}}"  # x missing, no fallback
    assert list_block["items"][1] == "정적"


def test_walk_does_not_mutate_input() -> None:
    doc = _doc_with_blocks([
        {"type": "paragraph", "id": "01P000000000000000000000A5", "text": "{{u}}"}
    ])
    walk_doc_substitute(doc, {"u": "X"})
    # Original text unchanged.
    assert doc["sections"][0]["blocks"][0]["text"] == "{{u}}"


# ── endpoint contract ─────────────────────────────────────────────────


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
async def test_patch_variables_round_trips() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _, etag = await _restore_seed(ac)
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/variables",
            json={"variables": {"user": "홍길동", "empty": ""}},
            headers={"If-Match": etag},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "etag" in body["meta"]
        # Empty values dropped from the persisted map.
        assert body["data"]["variables"] == {"user": "홍길동"}

        # Round-trip via GET to confirm persistence in content_json.
        r2 = await ac.get(f"/api/v1/documents/{SLUG}")
        content = r2.json()["data"]["content"]
        assert content.get("variables") == {"user": "홍길동"}


@pytest.mark.asyncio
async def test_patch_variables_requires_if_match() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        await _restore_seed(ac)
        r = await ac.patch(
            f"/api/v1/documents/{SLUG}/variables",
            json={"variables": {"user": "Park"}},
            # missing If-Match → 412
        )
        assert r.status_code == 412


@pytest.mark.asyncio
async def test_patch_variables_clears_when_empty_payload() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        _, etag = await _restore_seed(ac)
        # Populate first.
        r1 = await ac.patch(
            f"/api/v1/documents/{SLUG}/variables",
            json={"variables": {"a": "1"}},
            headers={"If-Match": etag},
        )
        assert r1.status_code == 200
        etag2 = r1.headers["etag"]

        # Clear with empty map.
        r2 = await ac.patch(
            f"/api/v1/documents/{SLUG}/variables",
            json={"variables": {}},
            headers={"If-Match": etag2},
        )
        assert r2.status_code == 200, r2.text
        assert r2.json()["data"]["variables"] == {}

        r3 = await ac.get(f"/api/v1/documents/{SLUG}")
        content = r3.json()["data"]["content"]
        assert "variables" not in content or content["variables"] in ({}, None)
