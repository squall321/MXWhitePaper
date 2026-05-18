"""Shared pytest fixtures for imp tests.

We avoid pulling in python-docx for fixture creation — a hand-rolled
minimal OOXML zip is enough to (a) pass the scanner's PK + word/document.xml
check, and (b) keep these tests runnable in the lite toolkit env.
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import pytest

from imp.config import Config, Defaults


_MIN_DOC_XML = (
    "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
    "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>"
    "<w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>"
)


def _write_docx(path: Path, *, valid: bool = True) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not valid:
        path.write_bytes(b"not a zip")
        return path
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", _MIN_DOC_XML)
        zf.writestr(
            "[Content_Types].xml",
            "<?xml version='1.0'?><Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>",
        )
    path.write_bytes(buf.getvalue())
    return path


def _write_json(path: Path, payload: dict[str, Any]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.fixture
def make_docx():
    """Factory: `make_docx(path)` or `make_docx(path, valid=False)`."""
    return _write_docx


@pytest.fixture
def make_json():
    return _write_json


@pytest.fixture
def make_config():
    """Factory that returns a Config wired to `source_path` (and any overrides)."""

    def _factory(source_path: Path, **overrides: Any) -> Config:
        defaults = Defaults(
            division="mx",
            team="knowledge",
            part=None,
            confidentiality="internal",
            owners=["test@mx.local"],
            tags=[],
        )
        base = dict(
            server="http://localhost:8800",
            token="dev-token",
            source_path=source_path,
            pattern="*.docx",
            exclude_patterns=[],
            defaults=defaults,
            domain_to_part={},
            mode="docx-primary",
            on_conflict="skip",
            stop_on_error=False,
            parallel=1,
            delay_seconds=0.0,
            dry_run=False,
            limit=0,
        )
        base.update(overrides)
        return Config(**base)  # type: ignore[arg-type]

    return _factory
