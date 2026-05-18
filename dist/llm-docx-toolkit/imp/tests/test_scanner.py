"""Tests for imp.scanner — pairing, slug, excludes, limit, korean."""
from __future__ import annotations

from pathlib import Path

import pytest

from imp.scanner import ScanError, _slugify, scan


def test_slugify_simple() -> None:
    assert _slugify("Android-OS-10.docx") == "android-os-10"


def test_slugify_korean() -> None:
    assert _slugify("삼성-반도체.docx") == "삼성-반도체"


def test_slugify_strips_punctuation() -> None:
    assert _slugify("hello! WORLD???.docx") == "hello-world"


def test_slugify_empty_fallback() -> None:
    assert _slugify("@@@.docx") == "imported"


def test_scan_docx_only(tmp_path: Path, make_docx, make_config) -> None:
    make_docx(tmp_path / "alpha.docx")
    make_docx(tmp_path / "beta.docx")
    cfg = make_config(tmp_path)
    items = list(scan(cfg))
    assert len(items) == 2
    slugs = {i.slug for i in items}
    assert slugs == {"alpha", "beta"}
    for it in items:
        assert it.json is None


def test_scan_pairs_json(tmp_path: Path, make_docx, make_json, make_config) -> None:
    make_docx(tmp_path / "alpha.docx")
    make_json(tmp_path / "alpha.json", {"slug": "custom-slug", "title": "Custom"})
    cfg = make_config(tmp_path)
    items = list(scan(cfg))
    assert len(items) == 1
    assert items[0].slug == "custom-slug"
    assert items[0].title == "Custom"
    assert items[0].json is not None


def test_scan_json_only_ignored(tmp_path: Path, make_json, make_config) -> None:
    """A .json without a sibling .docx is silently ignored (we walk .docx)."""
    make_json(tmp_path / "lonely.json", {"slug": "x"})
    cfg = make_config(tmp_path)
    assert list(scan(cfg)) == []


def test_scan_exclude_patterns(tmp_path: Path, make_docx, make_config) -> None:
    make_docx(tmp_path / "alpha.docx")
    make_docx(tmp_path / "draft-skip.docx")
    cfg = make_config(tmp_path, exclude_patterns=["draft-*.docx"])
    items = list(scan(cfg))
    assert [i.docx.name for i in items] == ["alpha.docx"]


def test_scan_limit(tmp_path: Path, make_docx, make_config) -> None:
    for n in range(5):
        make_docx(tmp_path / f"f{n}.docx")
    cfg = make_config(tmp_path, limit=2)
    items = list(scan(cfg))
    assert len(items) == 2


def test_scan_rejects_non_zip(tmp_path: Path, make_docx, make_config) -> None:
    make_docx(tmp_path / "good.docx")
    make_docx(tmp_path / "bad.docx", valid=False)
    cfg = make_config(tmp_path)
    items = list(scan(cfg))
    assert [i.docx.name for i in items] == ["good.docx"]


def test_scan_missing_source(tmp_path: Path, make_config) -> None:
    cfg = make_config(tmp_path / "does-not-exist")
    with pytest.raises(ScanError):
        list(scan(cfg))


def test_scan_korean_filename(tmp_path: Path, make_docx, make_config) -> None:
    make_docx(tmp_path / "삼성-반도체.docx")
    cfg = make_config(tmp_path)
    items = list(scan(cfg))
    assert items[0].slug == "삼성-반도체"


def test_scan_malformed_json_falls_back(
    tmp_path: Path, make_docx, make_config
) -> None:
    """A malformed json sidecar must not crash the whole scan."""
    make_docx(tmp_path / "alpha.docx")
    (tmp_path / "alpha.json").write_text("{ not json ;;;", encoding="utf-8")
    cfg = make_config(tmp_path)
    items = list(scan(cfg))
    # slug falls back to filename derivation, json is still listed as pair.
    assert items[0].slug == "alpha"
    assert items[0].json is not None


def test_scan_stable_order(tmp_path: Path, make_docx, make_config) -> None:
    for name in ("c.docx", "a.docx", "b.docx"):
        make_docx(tmp_path / name)
    cfg = make_config(tmp_path)
    items = list(scan(cfg))
    assert [i.docx.name for i in items] == ["a.docx", "b.docx", "c.docx"]
