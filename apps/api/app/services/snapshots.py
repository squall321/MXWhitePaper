"""Read-only catalog of full-server snapshots produced by `snapshot.sh`.

Why this is read-only:
    Taking a snapshot needs to invoke `apptainer exec` on the postgres
    container (for `pg_dump`) plus the mc container (for MinIO mirror).
    The API runs *inside* a sandboxed container — apptainer isn't on its
    PATH and even libpq's `pg_dump` isn't installed in api.sif. So the
    snapshot routine lives in `infra/scripts/snapshot.sh`, invoked from
    the host. This module surfaces the resulting `.tar.gz` files via the
    admin REST API for listing / downloading / deleting.

Snapshot files live under `infra/backups/snapshots/` on the host. That
directory is part of the repo bind-mount at /workspace, so the API can
walk it without any extra plumbing.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


# `mxwp-snapshot-YYYYMMDD-HHMMSSZ.tar.gz` — the only filename shape
# `snapshot.sh` produces. We refuse to surface anything else through
# the API so a stray file in the directory can't be deleted by a
# DELETE call.
SNAPSHOT_FILENAME_RE = re.compile(
    r"^mxwp-snapshot-(\d{8}-\d{6}Z)\.tar\.gz$"
)


def snapshots_dir() -> Path:
    """Default snapshot directory. The dir is intentionally derived from
    /workspace (the bind mount) so behavior matches whatever
    `infra/scripts/snapshot.sh` wrote.

    SNAPSHOT_DIR env override is honoured for parity with the shell script.
    """
    raw = os.environ.get("SNAPSHOT_DIR")
    if raw:
        return Path(raw).resolve()
    return Path("/workspace/infra/backups/snapshots").resolve()


def _safe_id(snapshot_id: str) -> str:
    """Strict allowlist match so a caller can't traverse via `..`/`/`."""
    if not SNAPSHOT_FILENAME_RE.match(f"mxwp-snapshot-{snapshot_id}.tar.gz"):
        raise ValueError(f"invalid snapshot id: {snapshot_id!r}")
    return snapshot_id


def _path_for(snapshot_id: str) -> Path:
    snapshot_id = _safe_id(snapshot_id)
    p = (snapshots_dir() / f"mxwp-snapshot-{snapshot_id}.tar.gz").resolve()
    # Defense in depth — confirm the resolved path is still inside
    # snapshots_dir() even after symlinks.
    base = snapshots_dir()
    try:
        p.relative_to(base)
    except ValueError as e:
        raise ValueError("snapshot path escapes snapshots dir") from e
    return p


def _read_manifest_from_tar(tar_path: Path) -> dict[str, Any] | None:
    """Open the tar.gz and return manifest.json's parsed dict, or None.

    Snapshots embed manifest.json at `mxwp-snapshot-<id>/manifest.json`.
    We pull only that one member so listing thousands of snapshots stays
    fast (no full extraction).
    """
    import tarfile

    if not tar_path.exists():
        return None
    try:
        with tarfile.open(tar_path, mode="r:gz") as tf:
            for member in tf:
                if member.isfile() and member.name.endswith("/manifest.json"):
                    fh = tf.extractfile(member)
                    if fh is None:
                        return None
                    raw = fh.read()
                    return json.loads(raw.decode("utf-8"))
    except (tarfile.TarError, OSError, json.JSONDecodeError):
        return None
    return None


def _stat_or_none(p: Path) -> dict[str, Any] | None:
    try:
        st = p.stat()
    except OSError:
        return None
    return {
        "size_bytes": int(st.st_size),
        "mtime": datetime.fromtimestamp(
            st.st_mtime, tz=timezone.utc
        ).isoformat().replace("+00:00", "Z"),
    }


def _read_sidecar_sha(path: Path) -> str | None:
    side = path.with_suffix(path.suffix + ".sha256")
    if not side.exists():
        return None
    try:
        text = side.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    # Format `<sha>  <filename>` — pull leading token.
    return text.split()[0] if text else None


def list_snapshots() -> list[dict[str, Any]]:
    """Enumerate snapshots in `snapshots_dir()`, newest first.

    Each entry mixes the manifest (when present) with on-disk size/mtime,
    so callers don't need a second round-trip to render a useful list
    even when manifest reading fails for some reason.
    """
    base = snapshots_dir()
    if not base.exists():
        return []
    out: list[dict[str, Any]] = []
    for entry in base.iterdir():
        if not entry.is_file():
            continue
        match = SNAPSHOT_FILENAME_RE.match(entry.name)
        if not match:
            continue
        snapshot_id = match.group(1)
        manifest = _read_manifest_from_tar(entry) or {}
        stat = _stat_or_none(entry) or {}
        out.append({
            "id": snapshot_id,
            "filename": entry.name,
            "size_bytes": stat.get("size_bytes"),
            "mtime": stat.get("mtime"),
            "sha256": _read_sidecar_sha(entry),
            "created_at": manifest.get("created_at"),
            "created_at_epoch": manifest.get("created_at_epoch"),
            "note": manifest.get("note"),
            "host": manifest.get("host"),
            "git_rev": manifest.get("git_rev"),
            "schema": manifest.get("schema"),
            "files": manifest.get("files"),
        })
    # Newest first. Prefer the manifest's `created_at_epoch` when set;
    # fall back to mtime so listings still order sensibly for archives
    # missing or with malformed manifests.
    def _ord(item: dict[str, Any]) -> int:
        epoch = item.get("created_at_epoch")
        if isinstance(epoch, (int, float)):
            return int(epoch)
        # Fall back to parsing mtime.
        m = item.get("mtime")
        if isinstance(m, str):
            try:
                return int(datetime.fromisoformat(m.replace("Z", "+00:00")).timestamp())
            except ValueError:
                return 0
        return 0

    out.sort(key=_ord, reverse=True)
    return out


def get_snapshot(snapshot_id: str) -> dict[str, Any] | None:
    """Single-snapshot view, same shape as one `list_snapshots()` entry."""
    snapshot_id = _safe_id(snapshot_id)
    path = _path_for(snapshot_id)
    if not path.exists():
        return None
    manifest = _read_manifest_from_tar(path) or {}
    stat = _stat_or_none(path) or {}
    return {
        "id": snapshot_id,
        "filename": path.name,
        "size_bytes": stat.get("size_bytes"),
        "mtime": stat.get("mtime"),
        "sha256": _read_sidecar_sha(path),
        "created_at": manifest.get("created_at"),
        "created_at_epoch": manifest.get("created_at_epoch"),
        "note": manifest.get("note"),
        "host": manifest.get("host"),
        "git_rev": manifest.get("git_rev"),
        "schema": manifest.get("schema"),
        "files": manifest.get("files"),
    }


def iter_snapshot_bytes(snapshot_id: str, *, chunk_size: int = 1 << 20) -> Iterable[bytes]:
    """Stream the archive bytes for download. ValueError if id invalid /
    not found — caller maps to 404."""
    path = _path_for(snapshot_id)
    if not path.exists():
        raise ValueError(f"snapshot not found: {snapshot_id}")
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(chunk_size)
            if not chunk:
                break
            yield chunk


def delete_snapshot(snapshot_id: str) -> bool:
    """Remove the archive + its sidecar `.sha256`. Returns True if the
    archive existed and was removed."""
    path = _path_for(snapshot_id)
    side = path.with_suffix(path.suffix + ".sha256")
    existed = path.exists()
    if existed:
        path.unlink()
    if side.exists():
        try:
            side.unlink()
        except OSError:
            pass
    # If `latest.tar.gz` symlink pointed at this file, leave it broken
    # rather than guess a new target — admin can re-run snapshot.sh or
    # repoint manually.
    return existed
