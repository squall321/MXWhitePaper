#!/usr/bin/env bash
# Dump the running mxwp_postgres database to a timestamped .sql.gz archive.
#
# Why this exists
#   - Apptainer instances are easy to restart but their bind-mounted
#     `infra/data/postgres` directory is the only place the actual rows
#     live. A logical pg_dump (vs. a filesystem snapshot) survives
#     postgres-version upgrades and lets you cherry-pick tables for
#     restore on another machine.
#
# Output
#   infra/backups/mxwp-YYYYMMDD-HHMMSS.sql.gz
#   infra/backups/latest.sql.gz   (symlink to the most recent dump)
#
# Usage
#   ./infra/scripts/backup-db.sh                         # default dir + name
#   BACKUP_DIR=/some/where ./infra/scripts/backup-db.sh  # override dir
#   ./infra/scripts/backup-db.sh /custom/path.sql.gz     # explicit output path
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

if ! instance_running "$INST_POSTGRES"; then
  echo "✗ $INST_POSTGRES not running. Start the stack first: ./infra/scripts/start.sh"
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/infra/backups}"
mkdir -p "$BACKUP_DIR"

if [ "$#" -ge 1 ]; then
  OUT_PATH="$1"
else
  TS="$(date +%Y%m%d-%H%M%S)"
  OUT_PATH="$BACKUP_DIR/mxwp-$TS.sql.gz"
fi

echo "→ dumping $POSTGRES_DB to $OUT_PATH"
# pg_dump runs INSIDE the container so it speaks UNIX socket via PGDATA;
# we redirect its stdout to the host file system through gzip on the host.
# `--clean --if-exists` makes the dump self-contained: restoring DROPs
# every object first so re-applying the same dump is idempotent.
"$APPTAINER" exec instance://"$INST_POSTGRES" \
  /bin/sh -c "PGPASSWORD='$POSTGRES_PASSWORD' pg_dump \
    --host=127.0.0.1 \
    --port='$POSTGRES_PORT' \
    --username='$POSTGRES_USER' \
    --dbname='$POSTGRES_DB' \
    --no-owner --no-privileges \
    --clean --if-exists \
    --quote-all-identifiers" \
  | gzip -c > "$OUT_PATH"

# Maintain a `latest.sql.gz` symlink so the restore script has a
# friendly default. Use a relative target so the link survives moving
# the backups directory.
if [ -z "${1:-}" ]; then
  ln -sf "$(basename "$OUT_PATH")" "$BACKUP_DIR/latest.sql.gz"
fi

SIZE_KB=$(du -k "$OUT_PATH" | cut -f1)
echo "✓ backup complete — $OUT_PATH (${SIZE_KB} KB)"
echo
echo "Restore:"
echo "  ./infra/scripts/restore-db.sh $OUT_PATH"
