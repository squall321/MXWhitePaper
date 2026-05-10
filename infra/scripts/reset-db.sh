#!/usr/bin/env bash
# Wipe the mxwp database back to a clean state and re-bootstrap.
#
# What it does (in order)
#   1. Auto-takes a safety backup to infra/backups/pre-reset-<timestamp>.sql.gz
#      so you can roll back if you reset by accident. Skip with --no-backup.
#   2. Stops the API instance to prevent concurrent writes.
#   3. DROP SCHEMA public CASCADE + CREATE SCHEMA public — clears every
#      table, sequence, view, index, type. Keeps the database itself
#      (avoids losing roles/grants).
#   4. Runs `alembic upgrade head` to recreate the schema from migrations.
#   5. Optionally re-runs the seed script (--with-seed flag).
#   6. Restarts the API.
#
# Safety
#   - Hard-asks for `yes` on stdin. Use --yes or CONFIRM=yes to skip
#     (e.g. CI / automated test setup).
#
# Usage
#   ./infra/scripts/reset-db.sh                       # fresh schema, no seed
#   ./infra/scripts/reset-db.sh --with-seed           # + run seed afterwards
#   ./infra/scripts/reset-db.sh --no-backup --yes     # destructive + silent
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

if ! instance_running "$INST_POSTGRES"; then
  echo "✗ $INST_POSTGRES not running. Start the stack first: ./infra/scripts/start.sh"
  exit 1
fi

# ── Flag parsing ────────────────────────────────────────────────────
WITH_SEED=0
WITH_BACKUP=1
SKIP_CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    --with-seed) WITH_SEED=1 ;;
    --no-backup) WITH_BACKUP=0 ;;
    --yes) SKIP_CONFIRM=1 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) echo "✗ unknown arg: $arg"; exit 1 ;;
  esac
done
[ "${CONFIRM:-}" = "yes" ] && SKIP_CONFIRM=1

# ── Confirm ─────────────────────────────────────────────────────────
echo "About to RESET database '$POSTGRES_DB' to a clean state."
echo "  - DROP SCHEMA public CASCADE  ←  every table goes away"
echo "  - alembic upgrade head        ←  recreate schema"
[ "$WITH_SEED" -eq 1 ] && echo "  - python -m app.scripts.seed  ←  reload seed data"
[ "$WITH_BACKUP" -eq 1 ] && echo "  + safety backup → infra/backups/pre-reset-*.sql.gz"
echo
echo "⚠ 모든 문서 / 사용자 / 토큰이 사라집니다."

if [ "$SKIP_CONFIRM" -ne 1 ]; then
  printf "Continue? Type 'RESET' to proceed: "
  read -r REPLY
  if [ "$REPLY" != "RESET" ]; then
    echo "✗ aborted"
    exit 1
  fi
fi

# ── Safety backup ───────────────────────────────────────────────────
if [ "$WITH_BACKUP" -eq 1 ]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  PRE_BACKUP="$REPO_ROOT/infra/backups/pre-reset-$TS.sql.gz"
  echo "→ taking safety backup → $PRE_BACKUP"
  "$REPO_ROOT/infra/scripts/backup-db.sh" "$PRE_BACKUP" >/dev/null
  echo "  ✓ safety backup ready (restore via: ./infra/scripts/restore-db.sh $PRE_BACKUP)"
fi

# ── Stop API to avoid concurrent writes ─────────────────────────────
API_WAS_RUNNING=0
if instance_running "$INST_API"; then
  API_WAS_RUNNING=1
  echo "→ stopping $INST_API"
  "$APPTAINER" instance stop "$INST_API" >/dev/null 2>&1 || true
fi

# ── Drop + recreate schema ──────────────────────────────────────────
echo "→ DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
"$APPTAINER" exec instance://"$INST_POSTGRES" \
  /bin/sh -c "PGPASSWORD='$POSTGRES_PASSWORD' psql \
    --host=127.0.0.1 \
    --port='$POSTGRES_PORT' \
    --username='$POSTGRES_USER' \
    --dbname='$POSTGRES_DB' \
    --quiet \
    --set ON_ERROR_STOP=1 \
    --command='DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO PUBLIC;'"

# ── Re-run alembic so the API has tables to talk to ─────────────────
# We run alembic in a one-shot via the api.sif image rather than the
# (now-stopped) instance, so the API stays cleanly down until end.
echo "→ alembic upgrade head"
"$APPTAINER" exec \
  --bind "$REPO_ROOT:/workspace" \
  "$API_SIF" \
  /bin/sh -c "cd /workspace/apps/api && \
    DATABASE_URL='postgresql+asyncpg://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:$POSTGRES_PORT/$POSTGRES_DB' \
    alembic upgrade head"

# ── Optional seed ───────────────────────────────────────────────────
if [ "$WITH_SEED" -eq 1 ]; then
  echo "→ python -m app.scripts.seed"
  "$APPTAINER" exec \
    --bind "$REPO_ROOT:/workspace" \
    "$API_SIF" \
    /bin/sh -c "cd /workspace/apps/api && \
      DATABASE_URL='postgresql+asyncpg://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:$POSTGRES_PORT/$POSTGRES_DB' \
      python -m app.scripts.seed"
fi

# ── Restart API ─────────────────────────────────────────────────────
if [ "$API_WAS_RUNNING" -eq 1 ]; then
  echo "→ restarting $INST_API"
  "$REPO_ROOT/infra/scripts/start.sh" >/dev/null
fi

echo
echo "✓ database reset complete"
[ "$WITH_BACKUP" -eq 1 ] && echo "  Rollback if needed:  ./infra/scripts/restore-db.sh $PRE_BACKUP"
