"""mxwp-import — bulk-upload .docx to MXWhitePaper.

Usage:
    mxwp-import --config bulk.yml
    mxwp-import --config bulk.yml --dry-run --limit 5
    mxwp-import --config bulk.yml --resume         # re-runs failed.txt only

Exit codes:
    0 — every item succeeded or skipped
    1 — at least one item failed
    2 — usage / config error (no items were processed)
"""
from __future__ import annotations

import argparse
import io
import os
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .client import MXWPClient
from .config import Config, ConfigError, derived_warnings, load_config
from .log import open_logger
from .scanner import ScanError
from .uploader import Outcome, process_all, summarise


# Windows console default is cp1252; force UTF-8 so glyphs in our human
# report (check marks, Korean slugs) don't crash with UnicodeEncodeError.
if sys.platform == "win32":  # pragma: no cover linux test env
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
    except Exception:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


# ─── argparse ────────────────────────────────────────────────────────


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="mxwp-import",
        description="Bulk import .docx (+ optional .json) into MXWhitePaper.",
    )
    p.add_argument("--version", action="version", version=f"mxwp-import {__version__}")
    p.add_argument("--config", required=False, type=Path,
                   help="YAML config file (see docs/02-design/features/bulk-import.design.md §3)")
    p.add_argument("--server", default=None, help="Override server URL")
    p.add_argument("--token", default=None, help="Override API token (use env to avoid shell history)")
    p.add_argument("--source", dest="source_path", default=None,
                   help="Override source folder path")
    p.add_argument("--dry-run", dest="dry_run", action="store_true", default=None,
                   help="Plan only — never call the server (still scans + pairs)")
    p.add_argument("--limit", type=int, default=None,
                   help="Process at most N items (0 = all)")
    p.add_argument("--stop-on-error", dest="stop_on_error", action="store_true",
                   default=None, help="Abort the run on the first failure")
    p.add_argument("--on-conflict", dest="on_conflict",
                   choices=["skip", "overwrite", "version"], default=None)
    p.add_argument("--delay", dest="delay_seconds", type=float, default=None,
                   help="Override delay between items (seconds)")
    p.add_argument("--log", type=Path, default=None,
                   help="Path to JSONL log (default: mxwp-import.log next to --config)")
    p.add_argument("--failed", type=Path, default=None,
                   help="Path to failed.txt (default: mxwp-import.failed.txt next to --config)")
    p.add_argument("--resume", action="store_true",
                   help="Re-run items listed in the failed.txt from a prior run")
    return p


def _cli_overrides(args: argparse.Namespace) -> dict[str, Any]:
    """argparse → dict of overrides, dropping unset (None/default) keys.

    Note: action='store_true' fields are stored as None when the flag was
    NOT passed (we set default=None above), True when it was. That makes
    `if v is None` the unified "not provided" check.
    """
    out: dict[str, Any] = {}
    for k in (
        "server", "token", "source_path", "dry_run", "limit",
        "stop_on_error", "on_conflict", "delay_seconds",
    ):
        v = getattr(args, k, None)
        if v is not None:
            out[k] = v
    return out


# ─── entry point ──────────────────────────────────────────────────────


def _load_with_overrides(
    args: argparse.Namespace,
) -> tuple[Config | None, int]:
    """Returns (cfg, exit_code). exit_code is 0 on success."""
    if args.config is None and args.source_path is None:
        # The user must give us something to import — show argparse error
        # rather than a generic ConfigError.
        print("error: --config is required (or pass --source for a no-yaml run is NOT supported)",
              file=sys.stderr)
        return None, 2
    try:
        cfg = load_config(args.config, _cli_overrides(args), os.environ)
    except ConfigError as e:
        print(f"[mxwp-import] config error: {e}", file=sys.stderr)
        return None, 2
    return cfg, 0


def _resume_filter(cfg: Config, failed_path: Path) -> Config:
    """When --resume is set, restrict the scan to docx files listed in
    `failed_path`. We do this by setting `pattern` to a custom value the
    scanner can't natively express — actually easier: rewrite source_path
    via an in-memory temp filter is overkill. Instead we walk the file
    and filter in the CLI loop. For now, we leave cfg unchanged but
    overlay an exclude-everything-not-in-list."""
    # Simplest viable: keep the original cfg, but the caller will only
    # process items whose docx path appears in `failed_path`.
    return cfg


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    cfg, code = _load_with_overrides(args)
    if cfg is None:
        return code
    assert cfg is not None

    # Decide log paths. Defaults sit next to --config so a user looking
    # at a shared bulk.yml can find the audit trail without guesswork.
    cwd = (args.config.parent if args.config else Path.cwd()).resolve()
    log_path = (args.log or (cwd / "mxwp-import.log")).resolve()
    failed_path = (args.failed or (cwd / "mxwp-import.failed.txt")).resolve()

    # If --resume was passed, narrow the scan via a temp source folder
    # containing only the failed entries — but instead we keep the
    # original scan and filter outcomes in Python (cheaper, no copies).
    resume_set: set[Path] | None = None
    if args.resume:
        if not failed_path.exists():
            print(
                f"[mxwp-import] --resume requested but no failed.txt at {failed_path}",
                file=sys.stderr,
            )
            return 2
        resume_set = set()
        for line in failed_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            resume_set.add(Path(line).resolve())

    logger = open_logger(jsonl_path=log_path)
    try:
        logger.info(f"[mxwp-import] config: {args.config}")
        logger.info(f"[mxwp-import] source: {cfg.source_path}")
        logger.info(
            f"[mxwp-import] mode: {cfg.mode}, on_conflict: {cfg.on_conflict}, "
            f"dry_run: {cfg.dry_run}"
        )
        for w in derived_warnings(cfg):
            logger.warn(f"[mxwp-import] {w}")
        logger.event(
            "start",
            server=cfg.server,
            source=str(cfg.source_path),
            mode=cfg.mode,
            on_conflict=cfg.on_conflict,
            dry_run=cfg.dry_run,
            limit=cfg.limit,
        )

        try:
            outcomes = _run(cfg, logger=logger, resume_set=resume_set)
        except ScanError as e:
            logger.err(f"[mxwp-import] scan error: {e}")
            logger.event("scan.error", level="error", message=str(e))
            return 2

        counts = summarise(outcomes)
        logger.info(
            f"[mxwp-import] done: {counts['success']} success / "
            f"{counts['skip']} skip / {counts['fail']} fail"
        )
        logger.event(
            "done",
            success=counts["success"],
            skip=counts["skip"],
            fail=counts["fail"],
        )

        # failed.txt is only written when the run produced failures, so
        # a clean run doesn't leave a misleading file in cwd. If the
        # operator used --resume and it CLEARED the list, we truncate
        # the file so the next run starts fresh.
        failed_items = [o for o in outcomes if o.status == "fail"]
        if failed_items:
            failed_path.parent.mkdir(parents=True, exist_ok=True)
            failed_path.write_text(
                "\n".join(str(o.item.docx) for o in failed_items) + "\n",
                encoding="utf-8",
            )
            logger.info(f"[mxwp-import] failed list: {failed_path}")
        elif args.resume and failed_path.exists():
            failed_path.write_text("", encoding="utf-8")
            logger.info(f"[mxwp-import] resume cleared {failed_path}")

        logger.info(f"[mxwp-import] details: {log_path}")
        return 1 if counts["fail"] > 0 else 0
    finally:
        logger.close()


def _run(
    cfg: Config,
    *,
    logger: Any,
    resume_set: set[Path] | None,
) -> list[Outcome]:
    """Wrap process_all so --resume can short-circuit."""
    if resume_set is None:
        return process_all(cfg, logger=logger)

    # Hand-roll a scan that filters to the resume set, then call
    # process_one ourselves so we don't re-run process_all's rate
    # limiter on items we're going to discard.
    from .scanner import scan
    from .uploader import process_one
    from .rate import RateLimiter

    cli = MXWPClient(cfg.server, cfg.token)
    limiter = RateLimiter(cfg.delay_seconds if not cfg.dry_run else 0.0, cfg.parallel)

    all_items = [it for it in scan(cfg) if it.docx.resolve() in resume_set]
    total = len(all_items)
    logger.info(f"[mxwp-import] --resume: filtered to {total} items")
    logger.event("resume.scan", count=total)

    outcomes: list[Outcome] = []
    for idx, item in enumerate(all_items, start=1):
        outcome = process_one(item, cfg, cli)
        outcomes.append(outcome)
        # Reuse uploader's logger formatter via a small inline call.
        from .uploader import _log_outcome
        _log_outcome(logger, idx, total, outcome)
        if outcome.status == "fail" and cfg.stop_on_error:
            logger.warn(f"stop_on_error: aborting after {idx} items")
            break
        if idx < total and not cfg.dry_run:
            limiter.acquire()
    return outcomes


if __name__ == "__main__":
    sys.exit(main())
