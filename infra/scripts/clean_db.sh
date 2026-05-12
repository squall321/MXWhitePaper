#!/usr/bin/env bash
# Wipe PostgreSQL data ONLY — other services (meili / minio / api / web)
# stay running. Use when:
#   - .env's POSTGRES_PASSWORD / USER / DB changed and existing data
#     dir was init'd with old values (auth fails)
#   - alembic state inconsistent with code
#   - "DuplicateTableError" from migrate against pre-populated data
#
# Difference from clean.sh:
#   clean.sh     → wipes ALL data dirs (postgres + meili + minio + web-tmp)
#   reset-db.sh  → keeps data dir, drops schema, takes safety backup
#   clean_db.sh  → wipes ONLY postgres data dir (others untouched)
#
# Usage:
#   ./infra/scripts/clean_db.sh                # interactive
#   ./infra/scripts/clean_db.sh --yes          # no prompt
#   ./infra/scripts/clean_db.sh --with-migrate # also run migrate + seed after
set -uo pipefail
. "$(dirname "$0")/_common.sh"
set +e
require_apptainer

YES=0
WITH_MIGRATE=0
for arg in "$@"; do
  case "$arg" in
    --yes)          YES=1 ;;
    --with-migrate) WITH_MIGRATE=1 ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $arg"; exit 1 ;;
  esac
done

echo "═══════════════════════════════════════════════════════════════"
echo "  MXWhitePaper — postgres data wipe"
echo "═══════════════════════════════════════════════════════════════"
echo "  ⚠  DB 의 모든 문서 / 사용자 / 토큰 / 감사로그 삭제됩니다."
echo "      meili / minio / web-tmp 는 보존."
echo "      복구 불가 — backup-db.sh 먼저 떠놨는지 확인."
echo "═══════════════════════════════════════════════════════════════"

if [ "$YES" -ne 1 ]; then
  printf "Continue? Type 'CLEAN_DB' to proceed: "
  read -r REPLY
  [ "$REPLY" = "CLEAN_DB" ] || { echo "✗ aborted"; exit 1; }
fi

# ── 1. stop postgres (다른 서비스는 살아있음) ────────────────────────
echo
echo "▶ 1/4  stop postgres"
"$APPTAINER" instance stop "$INST_POSTGRES" >/dev/null 2>&1 || true
echo "  ✓"

# ── 2. wipe data dirs ──────────────────────────────────────────────
echo
echo "▶ 2/4  wipe postgres data dirs"
# Try regular rm first; fall back to sudo if root-owned residue
rm -rf "$DATA_DIR/postgres" "$DATA_DIR/postgres-run" 2>/dev/null
if [ -e "$DATA_DIR/postgres" ] || [ -e "$DATA_DIR/postgres-run" ]; then
  echo "  → some files still here (root-owned?). Trying sudo…"
  sudo rm -rf "$DATA_DIR/postgres" "$DATA_DIR/postgres-run"
fi
mkdir -p "$DATA_DIR/postgres"
echo "  ✓ wiped"

# ── 3. start postgres (fresh init with current .env credentials) ───
echo
echo "▶ 3/4  start postgres (initdb with .env credentials)"
"$REPO_ROOT/infra/scripts/start.sh" 2>&1 | grep -E "postgres|✓|✗" | head -5

# Wait for postgres to accept connections
echo "  waiting for postgres to be ready…"
for i in $(seq 1 30); do
  if "$APPTAINER" exec instance://"$INST_POSTGRES" \
       pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$POSTGRES_USER" >/dev/null 2>&1; then
    echo "  ✓ ready (after ${i}s)"
    break
  fi
  sleep 1
done

# ── 4. optional: migrate + seed ─────────────────────────────────────
if [ "$WITH_MIGRATE" -eq 1 ]; then
  echo
  echo "▶ 4/4  migrate + seed"
  "$REPO_ROOT/infra/scripts/migrate.sh" 2>&1 | tail -10
  "$REPO_ROOT/infra/scripts/seed.sh" 2>&1 | tail -10 || echo "  ⚠ seed had errors — non-fatal"
else
  echo
  echo "▶ 4/4  migrate (skipped — pass --with-migrate to run, or:)"
  echo "    ./infra/scripts/migrate.sh && ./infra/scripts/seed.sh"
fi

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ clean_db complete — postgres init'd with current .env"
echo "═══════════════════════════════════════════════════════════════"
