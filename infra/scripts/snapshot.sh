#!/usr/bin/env bash
# Full server snapshot — PostgreSQL + MinIO objects, single archive.
#
# Why this exists vs. backup-db.sh:
#   backup-db.sh only captures the DB. A real disaster-recovery snapshot
#   has to include every byte the running stack needs to come back online,
#   which means MinIO objects (images, files, export artifacts) too.
#   Meilisearch is intentionally excluded — it's a derived index and the
#   API rebuilds it from documents on first request after restore.
#
# Archive shape (extracted):
#   mxwp-snapshot-YYYYMMDD-HHMMSS/
#     manifest.json           (metadata: id, created_at incl. seconds,
#                              sizes, sha256 checksums, host info)
#     postgres.sql.gz         (pg_dump --clean --if-exists, gzipped)
#     minio/
#       <bucket-name>/...     (each non-backup bucket mirrored verbatim)
#
# The output filename embeds a second-precision UTC timestamp:
#   mxwp-snapshot-20260513-143027Z.tar.gz
#
# Storage:
#   Default location: infra/backups/snapshots/
#   Override with:    SNAPSHOT_DIR=/some/where ./infra/scripts/snapshot.sh
#
# Usage:
#   ./infra/scripts/snapshot.sh                       # take a snapshot
#   ./infra/scripts/snapshot.sh --note "before v2 migration"
#   SNAPSHOT_DIR=/data/snapshots ./infra/scripts/snapshot.sh
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

# ── Parse args ──────────────────────────────────────────────────────
NOTE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --note)
      NOTE="${2:-}"
      shift 2
      ;;
    --note=*)
      NOTE="${1#*=}"
      shift
      ;;
    -h|--help)
      sed -n '1,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "✗ unknown arg: $1"
      exit 1
      ;;
  esac
done

# ── Sanity ──────────────────────────────────────────────────────────
if ! instance_running "$INST_POSTGRES"; then
  echo "✗ $INST_POSTGRES not running — start the stack first"
  exit 1
fi
if ! instance_running "$INST_MINIO"; then
  echo "✗ $INST_MINIO not running — start the stack first"
  exit 1
fi

SNAPSHOT_DIR="${SNAPSHOT_DIR:-$REPO_ROOT/infra/backups/snapshots}"
mkdir -p "$SNAPSHOT_DIR"

# UTC, second precision. "Z" suffix advertises UTC explicitly so a user
# in a different TZ doesn't misread the filename.
TS_FILE="$(date -u +%Y%m%d-%H%M%SZ)"
TS_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SNAP_ID="$TS_FILE"
WORK_DIR="$(mktemp -d -t mxwp-snapshot-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
STAGE="$WORK_DIR/mxwp-snapshot-$SNAP_ID"
mkdir -p "$STAGE" "$STAGE/minio"

echo "═════ MXWP snapshot $SNAP_ID ═════"
echo "  created_at : $TS_ISO"
echo "  stage_dir  : $STAGE"
echo "  output_dir : $SNAPSHOT_DIR"
[ -n "$NOTE" ] && echo "  note       : $NOTE"
echo

# ── 1) PostgreSQL dump ──────────────────────────────────────────────
PG_DUMP_PATH="$STAGE/postgres.sql.gz"
echo "→ dumping $POSTGRES_DB → postgres.sql.gz"
"$APPTAINER" exec instance://"$INST_POSTGRES" \
  /bin/sh -c "PGPASSWORD='$POSTGRES_PASSWORD' pg_dump \
    --host=127.0.0.1 \
    --port='$POSTGRES_PORT' \
    --username='$POSTGRES_USER' \
    --dbname='$POSTGRES_DB' \
    --no-owner --no-privileges \
    --clean --if-exists \
    --quote-all-identifiers" \
  | gzip -c > "$PG_DUMP_PATH"
PG_BYTES=$(stat -c%s "$PG_DUMP_PATH" 2>/dev/null || wc -c < "$PG_DUMP_PATH")
echo "  ✓ pg_dump ${PG_BYTES} bytes"

# ── 2) MinIO mirror ─────────────────────────────────────────────────
# Set up an mc alias. We bind the stage directory into the mc container
# so `mc mirror` can write straight to the host filesystem.
MC_ALIAS=local
echo "→ enumerating MinIO buckets"
# mc.sif is a minimal image without sed/awk, so we pipe its JSON output
# to host-side python3 for parsing. Each `mc ls --json` line is an
# object with a "key" of the form "bucket/" — strip the trailing slash.
BUCKET_LIST="$(
  "$APPTAINER" exec "$MC_SIF" /bin/sh -c "
    mc alias set $MC_ALIAS http://127.0.0.1:${MINIO_API_PORT} '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null 2>&1
    mc ls --json $MC_ALIAS
  " | python3 -c "
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        rec = json.loads(line)
    except json.JSONDecodeError:
        continue
    name = (rec.get('key') or '').rstrip('/')
    if name:
        print(name)
"
)"

if [ -z "$BUCKET_LIST" ]; then
  echo "  ⚠ no buckets found — skipping MinIO mirror"
else
  for bucket in $BUCKET_LIST; do
    # Skip the backups bucket itself: it can contain prior snapshots and
    # the scheduled backup_runner archives, and including those would
    # bloat every fresh snapshot with the entire backup history.
    case "$bucket" in
      ${MINIO_BUCKET_BACKUPS:-mxwp-backups})
        echo "  · skipping $bucket (backup bucket — not snapshotted)"
        continue
        ;;
    esac
    echo "  → mirroring $bucket"
    mkdir -p "$STAGE/minio/$bucket"
    "$APPTAINER" exec \
      --bind "$STAGE/minio/$bucket":/dest \
      "$MC_SIF" \
      /bin/sh -c "
        mc alias set $MC_ALIAS http://127.0.0.1:${MINIO_API_PORT} '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null 2>&1 &&
        mc mirror --quiet --overwrite $MC_ALIAS/$bucket /dest 2>&1
      " | sed 's/^/    /' || {
        echo "  ✗ mirror failed for $bucket"
        exit 1
      }
  done
fi

# ── 3) Manifest ─────────────────────────────────────────────────────
echo "→ writing manifest.json"
PG_SHA256="$(sha256sum "$PG_DUMP_PATH" | awk '{print $1}')"

# Compute per-bucket sizes + object counts.
buckets_json="["
first=1
for bucket_path in "$STAGE/minio"/*/; do
  [ -d "$bucket_path" ] || continue
  bucket="$(basename "$bucket_path")"
  obj_count="$(find "$bucket_path" -type f | wc -l | tr -d ' ')"
  size_bytes="$(du -sb "$bucket_path" | awk '{print $1}')"
  [ "$first" -eq 1 ] || buckets_json="$buckets_json,"
  buckets_json="$buckets_json{\"name\":\"$bucket\",\"object_count\":$obj_count,\"size_bytes\":$size_bytes}"
  first=0
done
buckets_json="$buckets_json]"

GIT_REV="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
HOSTNAME_VAL="$(hostname 2>/dev/null || echo unknown)"

cat > "$STAGE/manifest.json" <<JSON
{
  "snapshot_id": "$SNAP_ID",
  "created_at": "$TS_ISO",
  "created_at_epoch": $(date -u +%s),
  "note": $(printf '%s' "$NOTE" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),
  "host": "$HOSTNAME_VAL",
  "git_rev": "$GIT_REV",
  "schema": {
    "postgres_db": "$POSTGRES_DB",
    "minio_buckets": $buckets_json
  },
  "files": {
    "postgres.sql.gz": {
      "size_bytes": $PG_BYTES,
      "sha256": "$PG_SHA256"
    }
  }
}
JSON

# ── 4) Pack into a single tar.gz ────────────────────────────────────
OUT_PATH="$SNAPSHOT_DIR/mxwp-snapshot-$SNAP_ID.tar.gz"
echo "→ packing → $OUT_PATH"
tar -czf "$OUT_PATH" -C "$WORK_DIR" "mxwp-snapshot-$SNAP_ID"
SIZE_MB=$(du -m "$OUT_PATH" | cut -f1)
SIZE_BYTES=$(stat -c%s "$OUT_PATH" 2>/dev/null || wc -c < "$OUT_PATH")
SNAP_SHA256="$(sha256sum "$OUT_PATH" | awk '{print $1}')"

# Write a sibling .sha256 file so consumers can verify the download
# without un-tarring.
printf '%s  %s\n' "$SNAP_SHA256" "$(basename "$OUT_PATH")" \
  > "$OUT_PATH.sha256"

# Refresh `latest.tar.gz` symlink for convenience.
ln -sf "$(basename "$OUT_PATH")" "$SNAPSHOT_DIR/latest.tar.gz"

echo
echo "✓ snapshot complete"
echo "  file       : $OUT_PATH"
echo "  size       : ${SIZE_MB} MB (${SIZE_BYTES} bytes)"
echo "  sha256     : $SNAP_SHA256"
echo "  latest     : $SNAPSHOT_DIR/latest.tar.gz → $(basename "$OUT_PATH")"
echo
echo "Restore:"
echo "  ./infra/scripts/restore-snapshot.sh $OUT_PATH"
