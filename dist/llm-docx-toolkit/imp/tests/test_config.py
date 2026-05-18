"""Tests for imp.config — YAML load, env substitution, CLI overrides, token mask."""
from __future__ import annotations

from pathlib import Path

import pytest

from imp.config import Config, ConfigError, derived_warnings, load_config


def _write_yaml(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "bulk.yml"
    p.write_text(body, encoding="utf-8")
    return p


_MIN_YAML = """\
server: http://localhost:8800
token: dev-token
source:
  path: /tmp/src
defaults:
  division: mx
  team: knowledge
  confidentiality: internal
  owners:
    - someone@mx.local
"""


def test_load_minimal(tmp_path: Path) -> None:
    path = _write_yaml(tmp_path, _MIN_YAML)
    cfg = load_config(path, {}, {})
    assert isinstance(cfg, Config)
    assert cfg.server == "http://localhost:8800"
    assert cfg.token == "dev-token"
    assert cfg.source_path == Path("/tmp/src")
    assert cfg.pattern == "*.docx"
    assert cfg.exclude_patterns == []
    assert cfg.defaults.division == "mx"
    assert cfg.defaults.team == "knowledge"
    assert cfg.defaults.part is None
    assert cfg.defaults.owners == ["someone@mx.local"]
    assert cfg.defaults.tags == []
    assert cfg.mode == "docx-primary"
    assert cfg.on_conflict == "skip"
    assert cfg.dry_run is False
    assert cfg.limit == 0
    assert cfg.parallel == 1
    assert cfg.delay_seconds == 12.0


def test_env_substitution(tmp_path: Path) -> None:
    body = _MIN_YAML.replace("token: dev-token", "token: ${MX_TOKEN}")
    path = _write_yaml(tmp_path, body)
    cfg = load_config(path, {}, {"MX_TOKEN": "real-secret"})
    assert cfg.token == "real-secret"


def test_env_missing_raises(tmp_path: Path) -> None:
    body = _MIN_YAML.replace("token: dev-token", "token: ${MX_TOKEN}")
    path = _write_yaml(tmp_path, body)
    with pytest.raises(ConfigError) as exc:
        load_config(path, {}, {})
    assert "MX_TOKEN" in str(exc.value)


def test_cli_override_wins(tmp_path: Path) -> None:
    path = _write_yaml(tmp_path, _MIN_YAML)
    cfg = load_config(
        path,
        {"server": "https://prod.example", "dry_run": True, "limit": 5},
        {},
    )
    assert cfg.server == "https://prod.example"
    assert cfg.dry_run is True
    assert cfg.limit == 5


def test_cli_source_path_override(tmp_path: Path) -> None:
    path = _write_yaml(tmp_path, _MIN_YAML)
    cfg = load_config(path, {"source_path": "/data/elsewhere"}, {})
    assert cfg.source_path == Path("/data/elsewhere")


def test_token_masked_in_repr(tmp_path: Path) -> None:
    path = _write_yaml(tmp_path, _MIN_YAML)
    cfg = load_config(path, {"token": "super-secret-prod-token"}, {})
    r = repr(cfg)
    assert "super-secret-prod-token" not in r
    assert "supe****" in r


def test_missing_required_field(tmp_path: Path) -> None:
    body = _MIN_YAML.replace("server: http://localhost:8800\n", "")
    path = _write_yaml(tmp_path, body)
    with pytest.raises(ConfigError) as exc:
        load_config(path, {}, {})
    assert "server" in str(exc.value)


def test_missing_owners(tmp_path: Path) -> None:
    body = _MIN_YAML.replace("  owners:\n    - someone@mx.local\n", "  owners: []\n")
    path = _write_yaml(tmp_path, body)
    with pytest.raises(ConfigError) as exc:
        load_config(path, {}, {})
    assert "owners" in str(exc.value)


def test_invalid_confidentiality(tmp_path: Path) -> None:
    body = _MIN_YAML.replace("confidentiality: internal", "confidentiality: foo")
    path = _write_yaml(tmp_path, body)
    with pytest.raises(ConfigError):
        load_config(path, {}, {})


def test_invalid_on_conflict(tmp_path: Path) -> None:
    body = _MIN_YAML + "on_conflict: rebase\n"
    path = _write_yaml(tmp_path, body)
    with pytest.raises(ConfigError):
        load_config(path, {}, {})


def test_yaml_parse_error(tmp_path: Path) -> None:
    path = _write_yaml(tmp_path, "server: [unterminated\n")
    with pytest.raises(ConfigError):
        load_config(path, {}, {})


def test_derived_warnings_http_remote(tmp_path: Path) -> None:
    body = _MIN_YAML.replace("http://localhost:8800", "http://remote.example")
    path = _write_yaml(tmp_path, body)
    cfg = load_config(path, {}, {})
    warns = derived_warnings(cfg)
    assert any("http" in w for w in warns)


def test_derived_warnings_low_delay(tmp_path: Path) -> None:
    path = _write_yaml(tmp_path, _MIN_YAML)
    cfg = load_config(path, {"delay_seconds": 1.0}, {})
    warns = derived_warnings(cfg)
    assert any("delay" in w for w in warns)


def test_domain_to_part_mapping(tmp_path: Path) -> None:
    body = _MIN_YAML + (
        "domain_to_part:\n"
        "  semiconductor: foundry\n"
        "  mobile: handset\n"
    )
    path = _write_yaml(tmp_path, body)
    cfg = load_config(path, {}, {})
    assert cfg.domain_to_part == {"semiconductor": "foundry", "mobile": "handset"}
