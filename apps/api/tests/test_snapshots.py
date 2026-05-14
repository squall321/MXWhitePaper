"""Snapshot listing / download / delete tests.

Focuses on the catalog service — we generate a tiny fake tar.gz in a
tmp dir to mimic what `infra/scripts/snapshot.sh` writes, then exercise
list/get/iter/delete via the service module. Creation is shell-only so
there's nothing to mock on that side.
"""
from __future__ import annotations

import io
import json
import os
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

from app.services import snapshots as snapshots_service


def _make_fake_snapshot(
    tmp_dir: Path,
    snapshot_id: str,
    *,
    note: str = "",
    buckets: list[dict] | None = None,
    created_at_epoch: int = 1778706870,
) -> Path:
    """Drop a minimal `mxwp-snapshot-<id>.tar.gz` + sidecar into tmp_dir."""
    if buckets is None:
        buckets = [{"name": "mxwp-images", "object_count": 1, "size_bytes": 100}]
    iso = datetime.fromtimestamp(created_at_epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    manifest = {
        "snapshot_id": snapshot_id,
        "created_at": iso,
        "created_at_epoch": created_at_epoch,
        "note": note,
        "host": "test-host",
        "git_rev": "deadbeef",
        "schema": {
            "postgres_db": "mxwp",
            "minio_buckets": buckets,
        },
        "files": {"postgres.sql.gz": {"size_bytes": 123, "sha256": "a" * 64}},
    }
    inner = f"mxwp-snapshot-{snapshot_id}"

    archive = tmp_dir / f"mxwp-snapshot-{snapshot_id}.tar.gz"
    with tarfile.open(archive, "w:gz") as tf:
        data = json.dumps(manifest).encode("utf-8")
        info = tarfile.TarInfo(name=f"{inner}/manifest.json")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))

        body = b"fake postgres dump"
        info = tarfile.TarInfo(name=f"{inner}/postgres.sql.gz")
        info.size = len(body)
        tf.addfile(info, io.BytesIO(body))

    # Mirror the sidecar that snapshot.sh writes so we can verify sha
    # reading.
    import hashlib
    sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    (tmp_dir / f"{archive.name}.sha256").write_text(
        f"{sha}  {archive.name}\n", encoding="utf-8"
    )
    return archive


@pytest.fixture
def snapshot_dir(monkeypatch, tmp_path) -> Path:
    """Point the service at a temp dir + return it."""
    monkeypatch.setenv("SNAPSHOT_DIR", str(tmp_path))
    return tmp_path


def test_list_empty_dir_returns_empty(snapshot_dir: Path) -> None:
    assert snapshots_service.list_snapshots() == []


def test_list_returns_newest_first(snapshot_dir: Path) -> None:
    older = _make_fake_snapshot(
        snapshot_dir, "20260101-000000Z", note="old",
        created_at_epoch=1_700_000_000,
    )
    newer = _make_fake_snapshot(
        snapshot_dir, "20260513-211429Z", note="new",
        created_at_epoch=1_778_706_870,
    )
    # Force mtimes so the test doesn't rely on filesystem timing.
    os.utime(older, (1_700_000_000, 1_700_000_000))
    os.utime(newer, (1_778_706_870, 1_778_706_870))
    items = snapshots_service.list_snapshots()
    assert [item["id"] for item in items] == [
        "20260513-211429Z",
        "20260101-000000Z",
    ]
    # Manifest fields are surfaced.
    assert items[0]["note"] == "new"
    assert items[0]["host"] == "test-host"
    assert items[0]["sha256"] is not None  # sidecar read
    assert items[0]["schema"]["minio_buckets"][0]["name"] == "mxwp-images"


def test_list_ignores_unrelated_files(snapshot_dir: Path) -> None:
    _make_fake_snapshot(snapshot_dir, "20260513-211429Z")
    # Unrelated files in the dir must not show up.
    (snapshot_dir / "random.tar.gz").write_bytes(b"x")
    (snapshot_dir / "mxwp-snapshot-not-an-id.tar.gz").write_bytes(b"x")
    items = snapshots_service.list_snapshots()
    ids = [it["id"] for it in items]
    assert ids == ["20260513-211429Z"]


def test_get_snapshot_round_trip(snapshot_dir: Path) -> None:
    _make_fake_snapshot(snapshot_dir, "20260513-211429Z", note="hello")
    item = snapshots_service.get_snapshot("20260513-211429Z")
    assert item is not None
    assert item["id"] == "20260513-211429Z"
    assert item["note"] == "hello"
    assert isinstance(item["size_bytes"], int)


def test_get_invalid_id_raises(snapshot_dir: Path) -> None:
    with pytest.raises(ValueError):
        snapshots_service.get_snapshot("../etc/passwd")
    with pytest.raises(ValueError):
        snapshots_service.get_snapshot("not-an-id")


def test_iter_bytes_streams_full_archive(snapshot_dir: Path) -> None:
    archive = _make_fake_snapshot(snapshot_dir, "20260513-211429Z")
    streamed = b"".join(snapshots_service.iter_snapshot_bytes("20260513-211429Z"))
    assert streamed == archive.read_bytes()


def test_delete_removes_archive_and_sidecar(snapshot_dir: Path) -> None:
    archive = _make_fake_snapshot(snapshot_dir, "20260513-211429Z")
    sidecar = archive.with_suffix(archive.suffix + ".sha256")
    assert archive.exists() and sidecar.exists()
    assert snapshots_service.delete_snapshot("20260513-211429Z") is True
    assert not archive.exists()
    assert not sidecar.exists()
    # second delete is a no-op (returns False)
    assert snapshots_service.delete_snapshot("20260513-211429Z") is False


def test_delete_rejects_traversal(snapshot_dir: Path) -> None:
    with pytest.raises(ValueError):
        snapshots_service.delete_snapshot("../../etc/passwd")
