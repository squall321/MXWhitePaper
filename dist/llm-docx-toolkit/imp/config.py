"""Config loading: YAML file + ${VAR} env substitution + CLI override → Config.

The Config dataclass is frozen so a bad caller can't mutate `defaults.owners`
mid-run (a real footgun when 320 docs are in flight). `token` masks itself in
`__repr__` so a stray `print(cfg)` or pytest assertion message can't leak a
production secret into the logs.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Mapping

try:
    import yaml  # type: ignore[import-untyped]
except ImportError as exc:  # pragma: no cover — install-time error
    raise RuntimeError(
        "PyYAML is required. Install with: pip install PyYAML"
    ) from exc


_Confidentiality = Literal["public", "internal", "confidential"]
_Mode = Literal["docx-primary", "docx-only"]
_OnConflict = Literal["skip", "overwrite", "version"]


class ConfigError(ValueError):
    """Raised when the YAML/env/CLI config is unusable (missing field,
    undefined env var, invalid enum). The CLI maps this to exit code 2."""


@dataclass(frozen=True)
class Defaults:
    division: str
    team: str
    part: str | None
    confidentiality: _Confidentiality
    owners: list[str]
    tags: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Config:
    server: str
    token: str
    source_path: Path
    pattern: str
    exclude_patterns: list[str]
    defaults: Defaults
    domain_to_part: dict[str, str]
    mode: _Mode
    on_conflict: _OnConflict
    stop_on_error: bool
    parallel: int
    delay_seconds: float
    dry_run: bool
    limit: int

    def __repr__(self) -> str:  # pragma: no cover trivial
        masked = _mask_token(self.token)
        return (
            f"Config(server={self.server!r}, token={masked!r}, "
            f"source_path={self.source_path!r}, pattern={self.pattern!r}, "
            f"defaults={self.defaults!r}, mode={self.mode!r}, "
            f"on_conflict={self.on_conflict!r}, dry_run={self.dry_run!r}, "
            f"limit={self.limit!r})"
        )


def _mask_token(token: str) -> str:
    """Show only the first 4 chars so log readers can disambiguate keys
    without leaking the secret. Empty / short tokens → fully masked."""
    if not token:
        return ""
    if len(token) <= 4:
        return "****"
    return f"{token[:4]}****"


# ─── env substitution ───────────────────────────────────────────────

_ENV_VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def _substitute_env(value: Any, env: Mapping[str, str]) -> Any:
    """Walk a parsed YAML tree and replace `${VAR}` placeholders.

    Missing vars raise ConfigError — silent empty would lead to a request
    with `Authorization: Bearer ` and a confusing 401.
    """
    if isinstance(value, str):
        def _sub(match: re.Match[str]) -> str:
            name = match.group(1)
            if name not in env:
                raise ConfigError(f"environment variable not set: ${{{name}}}")
            return env[name]
        return _ENV_VAR_RE.sub(_sub, value)
    if isinstance(value, dict):
        return {k: _substitute_env(v, env) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute_env(v, env) for v in value]
    return value


# ─── YAML loading ───────────────────────────────────────────────────


def _load_yaml(path: Path) -> dict[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConfigError(f"cannot read config file {path}: {exc}") from exc
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        raise ConfigError(f"YAML parse error in {path}: {exc}") from exc
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ConfigError(f"config root must be a mapping, got {type(data).__name__}")
    return data


# ─── normalisation ──────────────────────────────────────────────────


_CONFIDENTIALITY_VALUES = {"public", "internal", "confidential"}
_MODE_VALUES = {"docx-primary", "docx-only"}
_ONCONFLICT_VALUES = {"skip", "overwrite", "version"}


def _require(d: dict[str, Any], key: str, where: str) -> Any:
    if key not in d or d[key] in (None, ""):
        raise ConfigError(f"missing required field: {where}.{key}")
    return d[key]


def _as_list_str(v: Any, where: str) -> list[str]:
    if v is None:
        return []
    if not isinstance(v, list):
        raise ConfigError(f"{where} must be a list of strings")
    out: list[str] = []
    for item in v:
        if not isinstance(item, str):
            raise ConfigError(f"{where} items must be strings, got {type(item).__name__}")
        out.append(item)
    return out


def _as_dict_str(v: Any, where: str) -> dict[str, str]:
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise ConfigError(f"{where} must be a mapping of string→string")
    out: dict[str, str] = {}
    for k, val in v.items():
        if not isinstance(k, str) or not isinstance(val, str):
            raise ConfigError(f"{where} keys/values must be strings")
        out[k] = val
    return out


def _build_defaults(raw: dict[str, Any]) -> Defaults:
    if not isinstance(raw, dict):
        raise ConfigError("`defaults` must be a mapping")
    division = _require(raw, "division", "defaults")
    team = _require(raw, "team", "defaults")
    part = raw.get("part")  # nullable
    confidentiality = _require(raw, "confidentiality", "defaults")
    if confidentiality not in _CONFIDENTIALITY_VALUES:
        raise ConfigError(
            f"defaults.confidentiality must be one of {sorted(_CONFIDENTIALITY_VALUES)}, "
            f"got {confidentiality!r}"
        )
    owners = _as_list_str(raw.get("owners"), "defaults.owners")
    if not owners:
        raise ConfigError("defaults.owners must contain at least one email")
    tags = _as_list_str(raw.get("tags"), "defaults.tags")
    return Defaults(
        division=str(division),
        team=str(team),
        part=str(part) if part is not None else None,
        confidentiality=confidentiality,
        owners=owners,
        tags=tags,
    )


def _build_config(merged: dict[str, Any]) -> Config:
    server = _require(merged, "server", "<root>")
    if not isinstance(server, str):
        raise ConfigError("server must be a string")
    server = server.rstrip("/")

    token = _require(merged, "token", "<root>")
    if not isinstance(token, str):
        raise ConfigError("token must be a string")

    src_raw = merged.get("source") or {}
    if not isinstance(src_raw, dict):
        raise ConfigError("`source` must be a mapping")
    source_path_raw = _require(src_raw, "path", "source")
    source_path = Path(str(source_path_raw)).expanduser()
    pattern = str(src_raw.get("pattern") or "*.docx")
    exclude_patterns = _as_list_str(src_raw.get("exclude_patterns"), "source.exclude_patterns")

    defaults = _build_defaults(merged.get("defaults") or {})
    domain_to_part = _as_dict_str(merged.get("domain_to_part"), "domain_to_part")

    mode = str(merged.get("mode") or "docx-primary")
    if mode not in _MODE_VALUES:
        raise ConfigError(f"mode must be one of {sorted(_MODE_VALUES)}, got {mode!r}")

    on_conflict = str(merged.get("on_conflict") or "skip")
    if on_conflict not in _ONCONFLICT_VALUES:
        raise ConfigError(
            f"on_conflict must be one of {sorted(_ONCONFLICT_VALUES)}, got {on_conflict!r}"
        )

    stop_on_error = bool(merged.get("stop_on_error", False))
    parallel = int(merged.get("parallel", 1) or 1)
    delay_seconds = float(merged.get("delay_seconds", 12.0))
    dry_run = bool(merged.get("dry_run", False))
    limit = int(merged.get("limit", 0) or 0)

    if parallel < 1:
        raise ConfigError("parallel must be >= 1")
    if delay_seconds < 0:
        raise ConfigError("delay_seconds must be >= 0")
    if limit < 0:
        raise ConfigError("limit must be >= 0")

    return Config(
        server=server,
        token=token,
        source_path=source_path,
        pattern=pattern,
        exclude_patterns=exclude_patterns,
        defaults=defaults,
        domain_to_part=domain_to_part,
        mode=mode,  # type: ignore[arg-type]
        on_conflict=on_conflict,  # type: ignore[arg-type]
        stop_on_error=stop_on_error,
        parallel=parallel,
        delay_seconds=delay_seconds,
        dry_run=dry_run,
        limit=limit,
    )


# ─── public ─────────────────────────────────────────────────────────


def load_config(
    yaml_path: Path | None,
    cli_overrides: dict[str, Any],
    env: Mapping[str, str],
) -> Config:
    """Merge order (highest wins): CLI overrides → env-substituted YAML.

    `cli_overrides` keys: server, token, source_path, dry_run, limit,
    stop_on_error, on_conflict, delay_seconds. Use None / omit to skip.
    """
    raw: dict[str, Any] = {}
    if yaml_path is not None:
        raw = _load_yaml(yaml_path)
        raw = _substitute_env(raw, env)

    # CLI overrides are applied as a flat overlay on the merged tree. Keys
    # that mirror `source.path` are routed under that nested key so the YAML
    # schema stays canonical.
    overrides = {k: v for k, v in (cli_overrides or {}).items() if v is not None}
    if "source_path" in overrides:
        raw.setdefault("source", {})["path"] = str(overrides.pop("source_path"))
    for k, v in overrides.items():
        raw[k] = v

    cfg = _build_config(raw)

    # Soft warnings (printed by the CLI, surfaced for tests as derived
    # boolean): http (non-localhost) and aggressive delay.
    return cfg


def derived_warnings(cfg: Config) -> list[str]:
    """Return human-readable warning strings the CLI prints on startup.

    These are *not* errors — they're risk reminders so an operator running
    against production gets a chance to abort.
    """
    msgs: list[str] = []
    if cfg.server.startswith("http://") and "localhost" not in cfg.server:
        msgs.append(
            f"server uses plain http ({cfg.server}); prefer https outside localhost"
        )
    if cfg.delay_seconds < 12.0:
        msgs.append(
            f"delay_seconds={cfg.delay_seconds} is below the server's 5/min default; "
            "expect 429 rate-limit failures"
        )
    return msgs


__all__ = [
    "Config",
    "ConfigError",
    "Defaults",
    "derived_warnings",
    "load_config",
]
