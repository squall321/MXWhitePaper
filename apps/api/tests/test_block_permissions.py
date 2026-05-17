"""Block-level permission scrubbing — unit tests for
`document_service.scrub_blocks_for_role`.

The scrubber walks a DocumentJSON tree and redacts any block whose
`meta.permission` is above the caller's role. Tested at the function level
because the matrix only depends on the input doc + role string — no HTTP /
DB plumbing required.

Matrix (role × meta.permission → visible?):

    role        all   editor   admin
    reader      ✓     ✗        ✗
    editor      ✓     ✓        ✗
    owner       ✓     ✓        ✗
    admin       ✓     ✓        ✓
"""
from __future__ import annotations

from typing import Any

from app.services.document_service import scrub_blocks_for_role

REDACTED_TEXT = "[권한이 부족한 블록]"


def _doc_with_block(block: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "id": "01ABCDEFGHJKMNPQRSTVWXY000",
        "slug": "permissions-fixture",
        "title": "perm fixture",
        "metadata": {
            "division": "mx",
            "owners": ["admin@mx.local"],
            "tags": [],
            "confidentiality": "public",
        },
        "sections": [
            {
                "id": "01ABCDEFGHJKMNPQRSTVWXY100",
                "level": 1,
                "title": "S1",
                "blocks": [block],
                "subsections": [],
            }
        ],
    }


def _first_block(doc: dict[str, Any]) -> dict[str, Any]:
    return doc["sections"][0]["blocks"][0]


# ── Admin sees admin-permission block intact ────────────────────────────


def test_admin_sees_admin_permission_block_intact() -> None:
    src = _doc_with_block(
        {
            "type": "paragraph",
            "id": "01ABCDEFGHJKMNPQRSTVWXY200",
            "text": "secret-admin-text",
            "meta": {"permission": "admin"},
        }
    )
    out = scrub_blocks_for_role(src, "admin")
    blk = _first_block(out)
    assert blk["type"] == "paragraph"
    assert blk["text"] == "secret-admin-text"
    assert blk["meta"]["permission"] == "admin"


# ── Editor sees admin-permission block redacted ─────────────────────────


def test_editor_sees_admin_permission_block_redacted() -> None:
    src = _doc_with_block(
        {
            "type": "paragraph",
            "id": "01ABCDEFGHJKMNPQRSTVWXY300",
            "text": "secret-admin-text",
            "meta": {"permission": "admin"},
        }
    )
    out = scrub_blocks_for_role(src, "editor")
    blk = _first_block(out)
    assert blk["type"] == "paragraph"
    assert blk["id"] == "01ABCDEFGHJKMNPQRSTVWXY300"
    assert blk["text"] == REDACTED_TEXT
    assert blk["meta"]["permission"] == "admin"
    # Original (not the scrubbed copy) untouched
    assert _first_block(src)["text"] == "secret-admin-text"


# ── Reader sees editor-permission block redacted ────────────────────────


def test_reader_sees_editor_permission_block_redacted() -> None:
    src = _doc_with_block(
        {
            "type": "callout",
            "id": "01ABCDEFGHJKMNPQRSTVWXY400",
            "variant": "info",
            "text": "editor-only-callout",
            "meta": {"permission": "editor"},
        }
    )
    out = scrub_blocks_for_role(src, "reader")
    blk = _first_block(out)
    assert blk["type"] == "paragraph"  # redacted to paragraph stub
    assert blk["text"] == REDACTED_TEXT
    assert blk["meta"]["permission"] == "editor"


# ── Reader sees all-permission block intact ─────────────────────────────


def test_reader_sees_all_permission_block_intact() -> None:
    src = _doc_with_block(
        {
            "type": "paragraph",
            "id": "01ABCDEFGHJKMNPQRSTVWXY500",
            "text": "everyone-can-see",
            "meta": {"permission": "all"},
        }
    )
    out = scrub_blocks_for_role(src, "reader")
    blk = _first_block(out)
    assert blk["text"] == "everyone-can-see"


# ── Reader sees blocks WITHOUT permission set as intact (default = all) ──


def test_reader_sees_block_without_permission_intact() -> None:
    src = _doc_with_block(
        {
            "type": "paragraph",
            "id": "01ABCDEFGHJKMNPQRSTVWXY600",
            "text": "no-meta-public",
        }
    )
    out = scrub_blocks_for_role(src, "reader")
    assert _first_block(out)["text"] == "no-meta-public"


# ── Owner sees editor-permission intact, admin redacted ─────────────────


def test_owner_matrix() -> None:
    src = {
        "schema_version": "1.0",
        "id": "01ABCDEFGHJKMNPQRSTVWXY700",
        "slug": "perm-owner",
        "title": "t",
        "metadata": {
            "division": "mx",
            "owners": ["a"],
            "tags": [],
            "confidentiality": "public",
        },
        "sections": [
            {
                "id": "01ABCDEFGHJKMNPQRSTVWXY701",
                "level": 1,
                "title": "S",
                "blocks": [
                    {
                        "type": "paragraph",
                        "id": "01ABCDEFGHJKMNPQRSTVWXY702",
                        "text": "editor-block",
                        "meta": {"permission": "editor"},
                    },
                    {
                        "type": "paragraph",
                        "id": "01ABCDEFGHJKMNPQRSTVWXY703",
                        "text": "admin-block",
                        "meta": {"permission": "admin"},
                    },
                ],
                "subsections": [],
            }
        ],
    }
    out = scrub_blocks_for_role(src, "owner")
    blocks = out["sections"][0]["blocks"]
    assert blocks[0]["text"] == "editor-block"  # owner ≥ editor
    assert blocks[1]["text"] == REDACTED_TEXT  # owner < admin


# ── Container blocks: nested redaction ──────────────────────────────────


def test_redaction_descends_into_columns() -> None:
    src = {
        "schema_version": "1.0",
        "id": "01ABCDEFGHJKMNPQRSTVWXY800",
        "slug": "perm-cols",
        "title": "t",
        "metadata": {
            "division": "mx",
            "owners": ["a"],
            "tags": [],
            "confidentiality": "public",
        },
        "sections": [
            {
                "id": "01ABCDEFGHJKMNPQRSTVWXY801",
                "level": 1,
                "title": "S",
                "blocks": [
                    {
                        "type": "columns",
                        "id": "01ABCDEFGHJKMNPQRSTVWXY802",
                        "columns": [
                            [
                                {
                                    "type": "paragraph",
                                    "id": "01ABCDEFGHJKMNPQRSTVWXY803",
                                    "text": "nested-secret",
                                    "meta": {"permission": "admin"},
                                }
                            ],
                            [
                                {
                                    "type": "paragraph",
                                    "id": "01ABCDEFGHJKMNPQRSTVWXY804",
                                    "text": "nested-public",
                                }
                            ],
                        ],
                    }
                ],
                "subsections": [],
            }
        ],
    }
    out = scrub_blocks_for_role(src, "editor")
    cols = out["sections"][0]["blocks"][0]["columns"]
    assert cols[0][0]["text"] == REDACTED_TEXT
    assert cols[1][0]["text"] == "nested-public"
