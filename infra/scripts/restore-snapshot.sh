#!/usr/bin/env bash
# Restore a full snapshot produced by `snapshot.sh`.
#
# What gets restored:
#   - PostgreSQL: every table dropped + recreated from postgres.sql.gz
#   - MinIO: every bucket in the snapshot is wiped + mirrored back
#   - Meilisearch is NOT touched — it'll lazily re-index from documents
#     on the next request. To force eager reindex, hit
#     /api/v1/admin/reindex after restore.
#
# Safety:
#   - Demands an explicit `--yes` (or CONFIRM=yes env) because this is
#     irreversible against the *current* state of the system.
#   - Stops the API instance first so live writes cannot race the
#     restore. Restarts the full stack at the end.
#   - Validates the snapshot tarball (sha256 + manifest presence)
#     before touching any live data.
#
# Usage:
#   ./infra/scripts/restore-snapshot.sh                      # use latest
#   ./infra/scripts/restore-snapshot.sh <archive.tar.gz>
#   ./infra/scripts/restore-snapshot.sh latest --yes         # skip prompt
#   CONFIRM=yes ./infra/scripts/restore-snapshot.sh latest
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

SNAPSHOT_DIR="${SNAPSHOT_DIR:-$REPO_ROOT/infra/backups/snapshots}"

# ── Parse args ──────────────────────────────────────────────────────
RAW_ARG="${1:-latest}"
SKIP_CONFIRM=0
if [ "${2:-}" = "--yes" ] || [ "${CONFIRM:-}" = "yes" ]; then
  SKIP_CONFIRM=1
fi

# Resolve the archive path.
if [ "$RAW_ARG" = "latest" ]; then
  ARCHIVE="$SNAPSHOT_DIR/latest.tar.gz"
elif [ -f "$RAW_ARG" ]; then
  ARCHIVE="$RAW_ARG"
elif [ -f "$SNAPSHOT_DIR/$RAW_ARG" ]; then
  ARCHIVE="$SNAPSHOT_DIR/$RAW_ARG"
else
  echo "✗ snapshot archive not found: $RAW_ARG"
  echo "  Available in $SNAPSHOT_DIR:"
  ls -t "$SNAPSHOT_DIR"/*.tar.gz 2>/dev/null | head -5 || echo "  (none)"
  exit 1
fi
RESOLVED="$(readlink -f "$ARCHIVE" 2>/dev/null || echo "$ARCHIVE")"
[ -f "$RESOLVED" ] || { echo "✗ resolved path does not exist: $RESOLVED"; exit 1; }
SIZE_MB=$(du -m "$RESOLVED" | cut -f1)

# ── Verify checksum if a sidecar .sha256 exists ─────────────────────
if [ -f "$RESOLVED.sha256" ]; then
  echo "→ verifying sha256"
  (cd "$(dirname "$RESOLVED")" && sha256sum -c "$(basename "$RESOLVED").sha256") \
    || { echo "✗ checksum mismatch — refuse to restore"; exit 1; }
fi

# ── Stage / inspect manifest before any destructive work ────────────
WORK_DIR="$(mktemp -d -t mxwp-restore-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
echo "→ extracting to $WORK_DIR"
tar -xzf "$RESOLVED" -C "$WORK_DIR"
INNER_DIR="$(find "$WORK_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -d "$INNER_DIR" ] || { echo "✗ archive has no top-level directory"; exit 1; }

MANIFEST="$INNER_DIR/manifest.json"
[ -f "$MANIFEST" ] || { echo "✗ manifest.json missing from snapshot"; exit 1; }

# Extract key fields for the confirm prompt (best-effort; python is
# always available since the API container is around).
SNAP_ID="$(python3 -c "import json,sys; print(json.load(open('$MANIFEST')).get('snapshot_id','?'))")"
SNAP_AT="$(python3 -c "import json,sys; print(json.load(open('$MANIFEST')).get('created_at','?'))")"
SNAP_NOTE="$(python3 -c "import json,sys; print(json.load(open('$MANIFEST')).get('note') or '')")"

cat <<INFO
About to RESTORE the entire MX White Paper stack from:
  archive    : $RESOLVED
  size       : ${SIZE_MB} MB
  snapshot_id: $SNAP_ID
  created_at : $SNAP_AT
$( [ -n "$SNAP_NOTE" ] && echo "  note       : $SNAP_NOTE" )

⚠  THIS IS DESTRUCTIVE.
   - 모든 documents/users/audit 등 PostgreSQL 데이터가 백업 시점으로 되돌아갑니다.
   - 모든 MinIO 객체(이미지/파일/내보낸 산출물)가 백업 시점으로 되돌아갑니다.
   - 현재 시점과 백업 시점 사이의 모든 작업이 사라집니다.
INFO

if [ "$SKIP_CONFIRM" -ne 1 ]; then
  printf "Continue? Type 'yes' to proceed: "
  read -r REPLY
  if [ "$REPLY" != "yes" ]; then
    echo "✗ aborted"
    exit 1
  fi
fi

# ── Tear down API so live writes cannot race ────────────────────────
API_WAS_RUNNING=0
WEB_WAS_RUNNING=0
if instance_running "$INST_API"; then
  API_WAS_RUNNING=1
  echo "→ stopping $INST_API"
  "$APPTAINER" instance stop "$INST_API" >/dev/null 2>&1 || true
fi
if instance_running "$INST_WEB"; then
  WEB_WAS_RUNNING=1
  echo "→ stopping $INST_WEB (will be restarted)"
  "$APPTAINER" instance stop "$INST_WEB" >/dev/null 2>&1 || true
fi

# ── Restore PostgreSQL ──────────────────────────────────────────────
PG_DUMP="$INNER_DIR/postgres.sql.gz"
if [ ! -f "$PG_DUMP" ]; then
  echo "✗ postgres.sql.gz missing from snapshot"
  exit 1
fi
echo "→ restoring postgres (drop + reload)"
gunzip -c "$PG_DUMP" | "$APPTAINER" exec instance://"$INST_POSTGRES" \
  /bin/sh -c "PGPASSWORD='$POSTGRES_PASSWORD' psql \
    --host=127.0.0.1 \
    --port='$POSTGRES_PORT' \
    --username='$POSTGRES_USER' \
    --dbname='$POSTGRES_DB' \
    --quiet \
    --set ON_ERROR_STOP=1"
echo "  ✓ postgres restored"

# ── Restore MinIO buckets ───────────────────────────────────────────
MINIO_ROOT="$INNER_DIR/minio"
if [ -d "$MINIO_ROOT" ]; then
  MC_ALIAS=local
  for bucket_dir in "$MINIO_ROOT"/*/; do
    [ -d "$bucket_dir" ] || continue
    bucket="$(basename "$bucket_dir")"
    echo "→ restoring bucket $bucket"
    "$APPTAINER" exec \
      --bind "$bucket_dir":/src \
      "$MC_SIF" \
      /bin/sh -c "
        mc alias set $MC_ALIAS http://127.0.0.1:${MINIO_API_PORT} '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null 2>&1 &&
        mc mb -p $MC_ALIAS/$bucket >/dev/null 2>&1 || true
        # Remove everything, then mirror back. --remove is purposely
        # excluded from mc mirror itself because some mc versions skip
        # objects whose checksums match; full wipe + mirror is the
        # simplest correct restore.
        mc rm --recursive --force $MC_ALIAS/$bucket >/dev/null 2>&1 || true
        mc mirror --quiet --overwrite /src $MC_ALIAS/$bucket 2>&1
      " | sed 's/^/    /'
  done
else
  echo "  ⚠ snapshot has no minio/ — only postgres was restored"
fi

# ── Bring API/Web back ──────────────────────────────────────────────
if [ "$API_WAS_RUNNING" -eq 1 ] || [ "$WEB_WAS_RUNNING" -eq 1 ]; then
  echo "→ restarting stack"
  "$REPO_ROOT/infra/scripts/start.sh" >/dev/null
fi

echo
echo "✓ restore complete from $SNAP_ID ($SNAP_AT)"
echo
echo "Recommended follow-up:"
echo "  - search index rebuild: curl -XPOST http://127.0.0.1:${API_PORT}/api/v1/admin/reindex"
echo "  - quick sanity:         ./infra/scripts/status.sh"
