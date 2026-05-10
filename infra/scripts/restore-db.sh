#!/usr/bin/env bash
# Restore the mxwp_postgres database from a backup-db.sh archive.
#
# Safety
#   - Refuses to overwrite without an explicit `--yes` (or env CONFIRM=yes)
#     because restore is destructive: every existing table is DROPped per
#     `pg_dump --clean --if-exists`.
#   - Tears down the API instance first so live writes can't race with
#     the restore (FK violations / mid-transaction rollbacks). Restarts
#     it on the way out.
#
# Usage
#   ./infra/scripts/restore-db.sh                        # use latest.sql.gz
#   ./infra/scripts/restore-db.sh path/to/backup.sql.gz
#   ./infra/scripts/restore-db.sh latest --yes           # skip confirmation
#   CONFIRM=yes ./infra/scripts/restore-db.sh latest     # same, env-driven
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

if ! instance_running "$INST_POSTGRES"; then
  echo "✗ $INST_POSTGRES not running. Start the stack first: ./infra/scripts/start.sh"
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/infra/backups}"

# ── Resolve the backup file ─────────────────────────────────────────
RAW_ARG="${1:-latest}"
SKIP_CONFIRM=0
if [ "${2:-}" = "--yes" ] || [ "${CONFIRM:-}" = "yes" ]; then
  SKIP_CONFIRM=1
fi

if [ "$RAW_ARG" = "latest" ]; then
  ARCHIVE="$BACKUP_DIR/latest.sql.gz"
elif [ -f "$RAW_ARG" ]; then
  ARCHIVE="$RAW_ARG"
elif [ -f "$BACKUP_DIR/$RAW_ARG" ]; then
  ARCHIVE="$BACKUP_DIR/$RAW_ARG"
else
  echo "✗ backup not found: $RAW_ARG"
  echo "  Available in $BACKUP_DIR :"
  ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -5 || echo "  (none)"
  exit 1
fi

# Resolve symlink so the dialog shows the real target.
RESOLVED="$(readlink -f "$ARCHIVE" 2>/dev/null || echo "$ARCHIVE")"
SIZE_KB=$(du -k "$RESOLVED" | cut -f1)

echo "About to RESTORE $POSTGRES_DB from:"
echo "  $RESOLVED  (${SIZE_KB} KB)"
echo
echo "⚠ This DROPs every table in the current database first."
echo "  현재 DB의 모든 테이블이 삭제되고 백업 시점으로 되돌아갑니다."

if [ "$SKIP_CONFIRM" -ne 1 ]; then
  printf "Continue? Type 'yes' to proceed: "
  read -r REPLY
  if [ "$REPLY" != "yes" ]; then
    echo "✗ aborted"
    exit 1
  fi
fi

# ── Tear down API so live writes can't race ─────────────────────────
API_WAS_RUNNING=0
if instance_running "$INST_API"; then
  API_WAS_RUNNING=1
  echo "→ stopping $INST_API to prevent concurrent writes"
  "$APPTAINER" instance stop "$INST_API" >/dev/null 2>&1 || true
fi

# ── Restore via psql (gunzip on host, pipe in) ──────────────────────
echo "→ restoring (this may take a minute on large dumps)"
gunzip -c "$RESOLVED" | "$APPTAINER" exec instance://"$INST_POSTGRES" \
  /bin/sh -c "PGPASSWORD='$POSTGRES_PASSWORD' psql \
    --host=127.0.0.1 \
    --port='$POSTGRES_PORT' \
    --username='$POSTGRES_USER' \
    --dbname='$POSTGRES_DB' \
    --quiet \
    --set ON_ERROR_STOP=1"

echo "✓ restore complete"

# ── Bring API back ──────────────────────────────────────────────────
if [ "$API_WAS_RUNNING" -eq 1 ]; then
  echo "→ restarting $INST_API"
  "$REPO_ROOT/infra/scripts/start.sh" >/dev/null
  echo "✓ API restarted"
fi

echo
echo "Verify with:"
echo "  ./infra/scripts/status.sh"
