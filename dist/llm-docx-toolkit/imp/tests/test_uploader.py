"""Tests for imp.uploader — success / skip / fail / dry-run / enrich."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

from imp.client import ClientError, MXWPClient
from imp.scanner import WorkItem
from imp.uploader import (
    enrich_metadata,
    process_all,
    process_one,
    summarise,
)


class _FakeClient(MXWPClient):
    """Bypasses every network call by overriding the endpoint methods."""

    def __init__(self) -> None:
        super().__init__("http://fake", "token-xxx", opener=lambda req, t: None)  # type: ignore[arg-type]
        self.imported: list[tuple[str, str]] = []
        self.created: list[dict[str, Any]] = []
        self.updated: list[tuple[str, dict[str, Any], str]] = []
        self.existing: dict[str, dict[str, Any]] = {}
        self.fail_import: bool = False
        self.fail_create: bool = False
        self.create_returns_id: str = "01TEST00000000000000000000"

    def import_docx(self, file: Path, slug: str, title: str) -> dict[str, Any]:  # type: ignore[override]
        if self.fail_import:
            raise ClientError("simulated import_docx failure", status=500)
        self.imported.append((slug, title))
        return {
            "document": {
                "schema_version": "1.0",
                "id": "01DOC00000000000000000000",
                "slug": slug,
                "title": title or slug,
                "metadata": {},
                "sections": [],
            },
            "summary": {"paragraphs": 1, "headings": 0, "tables": 0, "images": 0,
                        "equations": 0, "lists": 0, "code_blocks": 0,
                        "footnotes": 0, "warnings": []},
        }

    def create_document(self, doc: dict[str, Any]) -> dict[str, Any]:  # type: ignore[override]
        if self.fail_create:
            raise ClientError("simulated create_document failure", status=409)
        self.created.append(doc)
        return {"id": self.create_returns_id, "slug": doc["slug"], "version": 1}

    def get_document(self, slug: str) -> dict[str, Any] | None:  # type: ignore[override]
        return self.existing.get(slug)

    def update_document(self, slug: str, doc: dict[str, Any], etag: str) -> dict[str, Any]:  # type: ignore[override]
        self.updated.append((slug, doc, etag))
        return {"id": "01UPD00000000000000000000", "slug": slug, "version": 2}


# ─── helpers ──────────────────────────────────────────────────────────


_MIN_DOC_XML = (
    "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
    "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>"
    "<w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>"
)


def _write_docx(path: Path) -> Path:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", _MIN_DOC_XML)
        zf.writestr("[Content_Types].xml", "<Types/>")
    path.write_bytes(buf.getvalue())
    return path


def _make_item(tmp_path: Path, slug: str = "alpha", with_json: bool = False) -> WorkItem:
    docx = _write_docx(tmp_path / f"{slug}.docx")
    jpath: Path | None = None
    if with_json:
        jpath = tmp_path / f"{slug}.json"
        jpath.write_text('{"domain": "semiconductor"}', encoding="utf-8")
    return WorkItem(docx=docx, json=jpath, slug=slug, title=slug)


# ─── process_one ─────────────────────────────────────────────────────


def test_process_one_success(tmp_path: Path, make_config) -> None:
    item = _make_item(tmp_path)
    cfg = make_config(tmp_path)
    client = _FakeClient()
    out = process_one(item, cfg, client)
    assert out.status == "success"
    assert out.server_id == "01TEST00000000000000000000"
    assert client.imported == [("alpha", "alpha")]
    assert len(client.created) == 1


def test_process_one_skip_on_existing(tmp_path: Path, make_config) -> None:
    item = _make_item(tmp_path)
    cfg = make_config(tmp_path, on_conflict="skip")
    client = _FakeClient()
    client.existing["alpha"] = {"id": "exists", "etag": "W/\"1\""}
    out = process_one(item, cfg, client)
    assert out.status == "skip"
    assert "exists" in out.reason
    assert client.imported == []


def test_process_one_overwrite_calls_update(tmp_path: Path, make_config) -> None:
    item = _make_item(tmp_path)
    cfg = make_config(tmp_path, on_conflict="overwrite")
    client = _FakeClient()
    client.existing["alpha"] = {"id": "exists", "etag": "W/\"1\""}
    out = process_one(item, cfg, client)
    assert out.status == "success"
    assert len(client.updated) == 1
    slug, doc, etag = client.updated[0]
    assert slug == "alpha"
    assert etag == "W/\"1\""


def test_process_one_fail_on_invalid_docx(tmp_path: Path, make_config) -> None:
    bad = tmp_path / "bad.docx"
    bad.write_bytes(b"not a zip")
    item = WorkItem(docx=bad, json=None, slug="bad", title="bad")
    cfg = make_config(tmp_path)
    client = _FakeClient()
    out = process_one(item, cfg, client)
    assert out.status == "fail"
    assert "zip" in out.reason.lower() or "pk" in out.reason.lower()
    assert client.imported == []


def test_process_one_dry_run_short_circuits(tmp_path: Path, make_config) -> None:
    item = _make_item(tmp_path)
    cfg = make_config(tmp_path, dry_run=True)
    client = _FakeClient()
    out = process_one(item, cfg, client)
    assert out.status == "success"
    assert "dry-run" in out.reason
    assert client.imported == []
    assert client.created == []


def test_process_one_import_failure_recorded(tmp_path: Path, make_config) -> None:
    item = _make_item(tmp_path)
    cfg = make_config(tmp_path)
    client = _FakeClient()
    client.fail_import = True
    out = process_one(item, cfg, client)
    assert out.status == "fail"
    assert "import_docx" in out.reason


# ─── enrich_metadata ─────────────────────────────────────────────────


def test_enrich_metadata_with_json_domain(tmp_path: Path, make_config) -> None:
    item = _make_item(tmp_path, with_json=True)
    cfg = make_config(
        tmp_path,
        domain_to_part={"semiconductor": "foundry"},
    )
    doc: dict[str, Any] = {"metadata": {}}
    enrich_metadata(doc, item, cfg)
    assert doc["metadata"]["division"] == "mx"
    assert doc["metadata"]["part"] == "foundry"
    assert "semiconductor" in doc["metadata"]["tags"]


def test_enrich_metadata_without_json(tmp_path: Path, make_config) -> None:
    item = _make_item(tmp_path)
    cfg = make_config(tmp_path)
    doc: dict[str, Any] = {"metadata": {}}
    enrich_metadata(doc, item, cfg)
    assert doc["metadata"]["division"] == "mx"
    assert doc["metadata"]["tags"] == []
    # part is None → should be omitted entirely, not stored as null
    assert "part" not in doc["metadata"]


# ─── process_all ─────────────────────────────────────────────────────


def test_process_all_collects_outcomes(tmp_path: Path, make_config) -> None:
    _write_docx(tmp_path / "a.docx")
    _write_docx(tmp_path / "b.docx")
    cfg = make_config(tmp_path)
    client = _FakeClient()
    outs = process_all(cfg, client=client)
    assert len(outs) == 2
    assert summarise(outs) == {"success": 2, "skip": 0, "fail": 0}


def test_process_all_stop_on_error(tmp_path: Path, make_config) -> None:
    _write_docx(tmp_path / "a.docx")
    _write_docx(tmp_path / "b.docx")
    cfg = make_config(tmp_path, stop_on_error=True)
    client = _FakeClient()
    client.fail_import = True  # every item fails
    outs = process_all(cfg, client=client)
    # First item fails → stop_on_error kicks in.
    assert len(outs) == 1
    assert outs[0].status == "fail"


def test_process_all_dry_run_no_calls(tmp_path: Path, make_config) -> None:
    _write_docx(tmp_path / "a.docx")
    _write_docx(tmp_path / "b.docx")
    cfg = make_config(tmp_path, dry_run=True)
    client = _FakeClient()
    outs = process_all(cfg, client=client)
    assert summarise(outs) == {"success": 2, "skip": 0, "fail": 0}
    assert client.imported == []
    assert client.created == []
