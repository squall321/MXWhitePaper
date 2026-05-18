"""Stdout (human) + JSONL (machine) logging.

Two output channels, both opt-in via the Logger constructor:
  * stdout — line per record, with color check / ascii fallback
  * jsonl  — append-only, one record per line for downstream tooling

The CLI keeps a `failed.txt` companion file but that's written by the
caller (uploader collects failed items and the CLI flushes them on exit).
"""
from __future__ import annotations

import io
import json
import sys
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TextIO

# Match the validator's UTF-8 enforcement so unicode glyphs (check marks,
# Korean slugs) survive the Windows cp1252 default.
if sys.platform == "win32":  # pragma: no cover linux test env
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


# ── color helpers (mirror src/validate.py) ──────────────────────────

_OK = "\033[32m✓\033[0m"
_WARN = "\033[33m!\033[0m"
_ERR = "\033[31m✗\033[0m"
_SKIP = "\033[33m-\033[0m"


def _supports_color(stream: TextIO) -> bool:
    return getattr(stream, "isatty", lambda: False)()


def _fmt(symbol: str, plain: str, msg: str, stream: TextIO) -> str:
    return f"{symbol} {msg}" if _supports_color(stream) else f"{plain} {msg}"


def fmt_ok(msg: str, stream: TextIO = sys.stdout) -> str:
    return _fmt(_OK, "[OK]", msg, stream)


def fmt_warn(msg: str, stream: TextIO = sys.stdout) -> str:
    return _fmt(_WARN, "[!]", msg, stream)


def fmt_err(msg: str, stream: TextIO = sys.stdout) -> str:
    return _fmt(_ERR, "[X]", msg, stream)


def fmt_skip(msg: str, stream: TextIO = sys.stdout) -> str:
    return _fmt(_SKIP, "[-]", msg, stream)


# ── logger ──────────────────────────────────────────────────────────


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Logger:
    """Wraps a stdout stream + an optional JSONL file.

    Methods come in pairs: `*_line()` writes the human stdout line,
    `event()` writes the JSONL record. The uploader calls both — the
    caller wires them together so a single point of failure can't drop
    one channel silently.
    """

    def __init__(
        self,
        *,
        stdout: TextIO | None = None,
        jsonl_path: Path | None = None,
    ) -> None:
        self.stdout = stdout or sys.stdout
        self._jsonl_path = jsonl_path
        # File is opened lazily so a dry-run with --log path set still
        # creates the file (matches user expectations) but read-only
        # tests that never call event() don't touch the FS at all.
        self._jsonl: TextIO | None = None
        if jsonl_path is not None:
            jsonl_path.parent.mkdir(parents=True, exist_ok=True)
            self._jsonl = jsonl_path.open("a", encoding="utf-8")

    # ── stdout API ────────────────────────────────────────────────

    def info(self, msg: str) -> None:
        print(msg, file=self.stdout, flush=True)

    def ok(self, msg: str) -> None:
        print(fmt_ok(msg, self.stdout), file=self.stdout, flush=True)

    def warn(self, msg: str) -> None:
        print(fmt_warn(msg, self.stdout), file=self.stdout, flush=True)

    def err(self, msg: str) -> None:
        print(fmt_err(msg, self.stdout), file=self.stdout, flush=True)

    def skip(self, msg: str) -> None:
        print(fmt_skip(msg, self.stdout), file=self.stdout, flush=True)

    # ── JSONL API ─────────────────────────────────────────────────

    def event(self, event: str, level: str = "info", **payload: Any) -> None:
        if self._jsonl is None:
            return
        record: dict[str, Any] = {
            "ts": _ts(),
            "level": level,
            "event": event,
        }
        record.update(payload)
        self._jsonl.write(json.dumps(record, ensure_ascii=False) + "\n")
        self._jsonl.flush()

    def close(self) -> None:
        if self._jsonl is not None:
            self._jsonl.close()
            self._jsonl = None

    def __enter__(self) -> Logger:
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


def open_logger(
    *, stdout: TextIO | None = None, jsonl_path: Path | None = None
) -> Logger:
    return Logger(stdout=stdout, jsonl_path=jsonl_path)


__all__ = [
    "Logger",
    "fmt_err",
    "fmt_ok",
    "fmt_skip",
    "fmt_warn",
    "nullcontext",  # for callers that want `with logger or nullcontext(): ...`
    "open_logger",
]
