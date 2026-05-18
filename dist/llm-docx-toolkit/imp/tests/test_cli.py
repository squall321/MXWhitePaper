"""Tests for imp.cli — argument parsing, dry-run output, exit codes."""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from unittest import mock

import pytest

from imp import cli as imp_cli


_MIN_YAML = """\
server: http://localhost:8800
token: super-secret-token
source:
  path: {path}
defaults:
  division: mx
  team: knowledge
  confidentiality: internal
  owners:
    - tester@mx.local
delay_seconds: 0
"""


_MIN_DOC_XML = (
    "<?xml version='1.0' encoding='UTF-8' standalone='yes'?>"
    "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'>"
    "<w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>"
)


def _write_docx(p: Path) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", _MIN_DOC_XML)
        zf.writestr("[Content_Types].xml", "<Types/>")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(buf.getvalue())


def _make_config(tmp_path: Path, src: Path) -> Path:
    cfg_path = tmp_path / "bulk.yml"
    cfg_path.write_text(_MIN_YAML.format(path=str(src)), encoding="utf-8")
    return cfg_path


# ─── dry-run ─────────────────────────────────────────────────────────


def test_dry_run_writes_plan_and_exits_zero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    src = tmp_path / "src"
    _write_docx(src / "alpha.docx")
    _write_docx(src / "beta.docx")
    cfg_path = _make_config(tmp_path, src)
    code = imp_cli.main(["--config", str(cfg_path), "--dry-run"])
    assert code == 0
    out = capsys.readouterr().out
    # 2 items processed, each as success-dry-run.
    assert "success" in out
    assert "dry-run" in out.lower() or "dry_run" in out.lower()


def test_dry_run_does_not_touch_network(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    src = tmp_path / "src"
    _write_docx(src / "alpha.docx")
    cfg_path = _make_config(tmp_path, src)
    with mock.patch("imp.cli.MXWPClient") as m:
        m.return_value = mock.MagicMock()
        code = imp_cli.main(["--config", str(cfg_path), "--dry-run"])
        assert code == 0
        # process_all instantiates a client but never calls its methods
        # in dry-run because process_one short-circuits.
        cli_instance = m.return_value
        cli_instance.import_docx.assert_not_called()
        cli_instance.create_document.assert_not_called()


# ─── exit codes ──────────────────────────────────────────────────────


def test_exit_code_2_on_missing_config(capsys: pytest.CaptureFixture[str]) -> None:
    code = imp_cli.main([])
    assert code == 2


def test_exit_code_2_on_bad_yaml(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    bad = tmp_path / "bad.yml"
    bad.write_text("server: [unterminated\n", encoding="utf-8")
    code = imp_cli.main(["--config", str(bad)])
    assert code == 2
    err = capsys.readouterr().err
    assert "config" in err.lower()


def test_exit_code_2_on_missing_source(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    cfg_path = _make_config(tmp_path, tmp_path / "no-such")
    code = imp_cli.main(["--config", str(cfg_path), "--dry-run"])
    assert code == 2


# ─── --limit ─────────────────────────────────────────────────────────


def test_limit_caps_processed_count(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    src = tmp_path / "src"
    for n in range(5):
        _write_docx(src / f"f{n}.docx")
    cfg_path = _make_config(tmp_path, src)
    code = imp_cli.main([
        "--config", str(cfg_path), "--dry-run", "--limit", "2",
    ])
    assert code == 0
    # JSONL log should show exactly 2 process events.
    log = (tmp_path / "mxwp-import.log").read_text(encoding="utf-8")
    processes = [
        json.loads(line) for line in log.splitlines()
        if json.loads(line).get("event") == "process"
    ]
    assert len(processes) == 2


# ─── token masking ───────────────────────────────────────────────────


def test_token_never_leaks_to_stdout_or_log(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    src = tmp_path / "src"
    _write_docx(src / "alpha.docx")
    cfg_path = _make_config(tmp_path, src)
    code = imp_cli.main(["--config", str(cfg_path), "--dry-run"])
    assert code == 0
    out = capsys.readouterr().out
    assert "super-secret-token" not in out
    log_text = (tmp_path / "mxwp-import.log").read_text(encoding="utf-8")
    assert "super-secret-token" not in log_text


# ─── --resume ────────────────────────────────────────────────────────


def test_resume_processes_only_failed_items(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    src = tmp_path / "src"
    _write_docx(src / "a.docx")
    _write_docx(src / "b.docx")
    _write_docx(src / "c.docx")
    cfg_path = _make_config(tmp_path, src)
    # Pre-populate failed.txt with only `b.docx`.
    (tmp_path / "mxwp-import.failed.txt").write_text(
        str((src / "b.docx").resolve()) + "\n",
        encoding="utf-8",
    )
    code = imp_cli.main([
        "--config", str(cfg_path), "--dry-run", "--resume",
    ])
    assert code == 0
    log = (tmp_path / "mxwp-import.log").read_text(encoding="utf-8")
    processes = [
        json.loads(line) for line in log.splitlines()
        if json.loads(line).get("event") == "process"
    ]
    assert len(processes) == 1
    assert processes[0]["slug"] == "b"


def test_version_flag(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        imp_cli.main(["--version"])
    assert exc.value.code == 0
    out = capsys.readouterr().out
    assert "mxwp-import" in out


# ─── failed.txt on fail ─────────────────────────────────────────────


def test_failed_txt_written_on_fail(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    src = tmp_path / "src"
    _write_docx(src / "good.docx")
    # Write a malformed docx that the scanner rejects (so it never reaches
    # the uploader). The CLI then has only 1 success and 0 fails.
    # To exercise the fail branch we need a docx that the scanner accepts
    # but the *uploader* rejects. Emit an empty zip (scanner-valid: PK +
    # word/document.xml) but force a fake client failure via patch.
    cfg_path = _make_config(tmp_path, src)
    with mock.patch("imp.cli.MXWPClient") as m:
        fake = mock.MagicMock()
        fake.get_document.return_value = None
        from imp.client import ClientError
        fake.import_docx.side_effect = ClientError("boom", status=500)
        m.return_value = fake
        code = imp_cli.main(["--config", str(cfg_path)])
    # 1 fail → exit 1, failed.txt written
    assert code == 1
    failed = (tmp_path / "mxwp-import.failed.txt").read_text(encoding="utf-8")
    assert "good.docx" in failed
