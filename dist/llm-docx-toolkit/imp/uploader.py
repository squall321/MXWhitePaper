"""process_one + process_all — the actual work.

Each WorkItem goes through this pipeline:
  1. pre-validate the docx (cheap PK + word/document.xml check)
  2. consult `on_conflict` (skip if slug already exists, when applicable)
  3. if dry-run → return success with reason='dry-run'
  4. POST /imports/docx → server returns DocumentJSON
  5. merge defaults + json sidecar into metadata
  6. POST /documents (or PUT under overwrite)

Errors are converted into `Outcome(status='fail', reason=...)` so the
caller can collect them; only ConfigError-level problems propagate.
"""
from __future__ import annotations

import json
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal

from .client import ClientError, MXWPClient
from .config import Config
from .log import Logger
from .rate import RateLimiter
from .scanner import WorkItem, scan


@dataclass(frozen=True)
class Outcome:
    item: WorkItem
    status: Literal["success", "skip", "fail"]
    reason: str = ""
    server_id: str | None = None
    duration_ms: int = 0


# ─── helpers ──────────────────────────────────────────────────────────


def _pre_validate(docx: Path) -> str | None:
    """Returns an error reason string when the file is unusable, None when OK."""
    if not docx.exists():
        return "file disappeared"
    if docx.stat().st_size == 0:
        return "file is empty"
    # The server caps at 30 MB. Reject earlier so we don't waste an upload.
    if docx.stat().st_size > 30 * 1024 * 1024:
        return f"file exceeds 30 MB ({docx.stat().st_size} bytes)"
    try:
        with docx.open("rb") as f:
            head = f.read(4)
        if head != b"PK\x03\x04":
            return "not a valid zip (PK magic missing)"
        with zipfile.ZipFile(docx) as zf:
            if "word/document.xml" not in zf.namelist():
                return "zip does not contain word/document.xml"
    except (OSError, zipfile.BadZipFile) as e:
        return f"cannot open as docx: {e}"
    return None


def _read_sidecar(json_path: Path | None) -> dict[str, Any]:
    if json_path is None:
        return {}
    try:
        with json_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def enrich_metadata(
    doc: dict[str, Any], item: WorkItem, cfg: Config
) -> None:
    """Fill `doc.metadata` from cfg.defaults + the JSON sidecar.

    Defaults are only applied when the server / docx didn't already set
    a value (`setdefault`). The JSON sidecar's `domain` field is used as
    both a tag and a `part` lookup via cfg.domain_to_part.
    """
    meta = doc.setdefault("metadata", {})
    if not isinstance(meta, dict):
        # Server contract says metadata is always an object; bail rather
        # than write to a primitive.
        return

    meta.setdefault("division", cfg.defaults.division)
    meta.setdefault("team", cfg.defaults.team)
    meta.setdefault("confidentiality", cfg.defaults.confidentiality)
    meta.setdefault("owners", list(cfg.defaults.owners))

    j = _read_sidecar(item.json)
    domain = j.get("domain") if isinstance(j.get("domain"), str) else None
    if domain:
        # explicit part mapping wins; otherwise the default part.
        meta["part"] = cfg.domain_to_part.get(domain, cfg.defaults.part)
        tags = list(cfg.defaults.tags)
        if domain not in tags:
            tags.append(domain)
        meta["tags"] = tags
    else:
        meta.setdefault("part", cfg.defaults.part)
        # Only overwrite tags when the server didn't fill them in.
        meta.setdefault("tags", list(cfg.defaults.tags))

    # part defaults to None — strip nulls so the server's schema doesn't
    # see `{"part": null}` when no part is configured at all.
    if meta.get("part") is None:
        meta.pop("part", None)


# ─── single item ──────────────────────────────────────────────────────


def process_one(
    item: WorkItem,
    cfg: Config,
    client: MXWPClient,
) -> Outcome:
    t0 = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - t0) * 1000)

    pre_err = _pre_validate(item.docx)
    if pre_err is not None:
        return Outcome(item=item, status="fail", reason=pre_err, duration_ms=elapsed())

    # Dry-run short-circuits BEFORE any network call (design §10 + the
    # operator contract that --dry-run must be safe to run anywhere).
    if cfg.dry_run:
        return Outcome(
            item=item, status="success",
            reason="dry-run: would import",
            duration_ms=elapsed(),
        )

    existing: dict[str, Any] | None = None
    if cfg.on_conflict in ("skip", "overwrite"):
        try:
            existing = client.get_document(item.slug)
        except ClientError as e:
            return Outcome(
                item=item, status="fail",
                reason=f"get_document failed: {e}",
                duration_ms=elapsed(),
            )
        if existing is not None and cfg.on_conflict == "skip":
            return Outcome(
                item=item, status="skip",
                reason="slug already exists",
                duration_ms=elapsed(),
            )

    try:
        resp = client.import_docx(item.docx, slug=item.slug, title=item.title)
    except ClientError as e:
        return Outcome(
            item=item, status="fail",
            reason=f"import_docx failed: {e}",
            duration_ms=elapsed(),
        )
    doc = resp.get("document")
    if not isinstance(doc, dict):
        return Outcome(
            item=item, status="fail",
            reason="server returned no `document` field",
            duration_ms=elapsed(),
        )

    enrich_metadata(doc, item, cfg)

    try:
        if cfg.on_conflict == "overwrite" and existing is not None:
            etag = existing.get("etag") or ""
            if not etag:
                # No ETag → wildcard If-Match. The server may reject (PUT
                # generally requires If-Match), but trying with an empty
                # header is better than a silent skip.
                etag = "*"
            created = client.update_document(item.slug, doc, etag=etag)
        else:
            # 'version' currently falls through to create (v1 simplification —
            # see design §3 and §9.2). The server treats a duplicate slug as
            # a conflict, which surfaces here as ClientError(status=409).
            created = client.create_document(doc)
    except ClientError as e:
        return Outcome(
            item=item, status="fail",
            reason=f"persist failed: {e}",
            duration_ms=elapsed(),
        )

    server_id_raw = created.get("id")
    server_id = str(server_id_raw) if server_id_raw is not None else None
    return Outcome(
        item=item, status="success",
        reason="",
        server_id=server_id,
        duration_ms=elapsed(),
    )


# ─── batch ────────────────────────────────────────────────────────────


def process_all(
    cfg: Config,
    *,
    client: MXWPClient | None = None,
    logger: Logger | None = None,
    progress: Callable[[int, int, Outcome], None] | None = None,
) -> list[Outcome]:
    """Walk `scan(cfg)` and call `process_one` for each item.

    `client` defaults to an MXWPClient instantiated from cfg — tests pass
    a fake to bypass the network. `progress` lets the CLI print
    `[idx/total]` lines without coupling this module to stdout.
    """
    items = list(scan(cfg))
    total = len(items)
    if logger is not None:
        logger.info(f"[mxwp-import] starting: {total} items")
        logger.event("scan.done", count=total)

    if cfg.dry_run:
        # Even in dry-run we still want the client object for the
        # `on_conflict='skip'` GET — but the user explicitly opted out
        # of side effects, so skip even the GET. process_one's dry-run
        # branch is reached BEFORE network calls.
        pass

    cli = client if client is not None else MXWPClient(cfg.server, cfg.token)
    limiter = RateLimiter(cfg.delay_seconds if not cfg.dry_run else 0.0, cfg.parallel)

    outcomes: list[Outcome] = []
    for idx, item in enumerate(items, start=1):
        outcome = process_one(item, cfg, cli)
        outcomes.append(outcome)
        if logger is not None:
            _log_outcome(logger, idx, total, outcome)
        if progress is not None:
            progress(idx, total, outcome)
        if outcome.status == "fail" and cfg.stop_on_error:
            if logger is not None:
                logger.warn(f"stop_on_error: aborting after {idx} items")
            break
        # Don't sleep after the last item.
        if idx < total and not cfg.dry_run:
            limiter.acquire()

    return outcomes


def _log_outcome(logger: Logger, idx: int, total: int, outcome: Outcome) -> None:
    prefix = f"[{idx:03d}/{total:03d}]"
    slug = outcome.item.slug
    secs = outcome.duration_ms / 1000.0
    if outcome.status == "success":
        suffix = f"({secs:.1f}s)"
        if outcome.server_id:
            suffix = f"{suffix} id={outcome.server_id}"
        if outcome.reason:
            suffix = f"{suffix} — {outcome.reason}"
        logger.ok(f"{prefix} {slug:<32s} {suffix}")
    elif outcome.status == "skip":
        logger.skip(f"{prefix} {slug:<32s} (skip — {outcome.reason})")
    else:
        logger.err(f"{prefix} {slug:<32s} (fail — {outcome.reason})")
    logger.event(
        "process",
        level="warn" if outcome.status == "fail" else "info",
        idx=idx,
        slug=slug,
        status=outcome.status,
        reason=outcome.reason,
        duration_ms=outcome.duration_ms,
        server_id=outcome.server_id,
        docx=str(outcome.item.docx),
    )


def summarise(outcomes: list[Outcome]) -> dict[str, int]:
    counts = {"success": 0, "skip": 0, "fail": 0}
    for o in outcomes:
        counts[o.status] += 1
    return counts


__all__ = [
    "Outcome",
    "enrich_metadata",
    "process_all",
    "process_one",
    "summarise",
]
