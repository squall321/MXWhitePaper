#!/usr/bin/env bash
# One-shot update — pulls latest code + applies all changes.
#
# What it does (in order):
#   1. git pull origin main          (source code)
#   2. detect changed files          (.def, requirements, alembic/, schema)
#   3. pnpm install (idempotent)     if package.json / pnpm-lock changed
#   4. pnpm schema:gen               if SSOT JSON schema changed
#   5. rebuild .sif                  if .def changed (api/web only on target;
#                                    base/postgres/meili/minio rarely change)
#   6. restart affected instances    so they pick up new sif / new env
#   7. alembic upgrade head          if new alembic versions arrived
#   8. diag.sh                       final state report
#
# Bind-mounted code (/workspace) auto-reloads via vite HMR + uvicorn --reload
# so MOST TS/PY edits don't even need restart. This script handles the cases
# that DO need action.
#
# Usage:
#   ./infra/scripts/update.sh                    # auto-detect everything
#   ./infra/scripts/update.sh --no-pull          # skip git pull (use local changes)
#   ./infra/scripts/update.sh --no-restart       # skip restart (HMR handles it)
#   ./infra/scripts/update.sh --rebuild-sif      # force .sif rebuild
#   ./infra/scripts/update.sh --rebuild-sif=api  # rebuild specific .sif
set -uo pipefail
. "$(dirname "$0")/_common.sh"
set +e

PULL=1
RESTART=1
FORCE_REBUILD=""
for arg in "$@"; do
  case "$arg" in
    --no-pull)        PULL=0 ;;
    --no-restart)     RESTART=0 ;;
    --rebuild-sif)    FORCE_REBUILD="all" ;;
    --rebuild-sif=*)  FORCE_REBUILD="${arg#*=}" ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $arg"; exit 1 ;;
  esac
done

cd "$REPO_ROOT"

echo "═══════════════════════════════════════════════════════════════"
echo "  MXWhitePaper — update"
echo "═══════════════════════════════════════════════════════════════"

# ── 1. git pull ─────────────────────────────────────────────────────
OLD_HEAD=""
if [ "$PULL" = 1 ] && [ -d .git ]; then
  echo
  echo "▶ 1/8  git pull"
  OLD_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
  git pull --ff-only origin main 2>&1 | sed 's/^/  /'
  NEW_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
  if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
    echo "  (no new commits)"
  else
    echo "  $OLD_HEAD → $NEW_HEAD"
  fi
else
  echo
  echo "▶ 1/8  git pull (skipped)"
fi

# ── 2. detect what changed since OLD_HEAD ───────────────────────────
echo
echo "▶ 2/8  detect changed files"
CHANGED=""
if [ -n "$OLD_HEAD" ] && [ -d .git ]; then
  CHANGED=$(git diff --name-only "$OLD_HEAD" HEAD 2>/dev/null)
fi

changed_in() {
  # $1 = path prefix or glob
  [ -z "$CHANGED" ] && return 0   # no diff data — assume yes (idempotent)
  echo "$CHANGED" | grep -qE "$1"
}

NEED_PNPM_INSTALL=0
NEED_SCHEMA_GEN=0
NEED_MIGRATE=0
NEED_REBUILD_API=0
NEED_REBUILD_WEB=0

if [ -z "$CHANGED" ]; then
  echo "  (no diff data — running all idempotent steps)"
  NEED_PNPM_INSTALL=1
  NEED_SCHEMA_GEN=1
  NEED_MIGRATE=1
else
  echo "$CHANGED" | head -20 | sed 's/^/    /'
  changed_in '(package\.json|pnpm-lock\.yaml)$'          && NEED_PNPM_INSTALL=1
  changed_in '(schemas/|schema\.json)$'                  && NEED_SCHEMA_GEN=1
  changed_in 'apps/api/alembic/versions/'                && NEED_MIGRATE=1
  changed_in 'infra/apptainer/api\.def$'                 && NEED_REBUILD_API=1
  changed_in 'infra/apptainer/web\.def$'                 && NEED_REBUILD_WEB=1
fi

# Force rebuild flag override
case "$FORCE_REBUILD" in
  all) NEED_REBUILD_API=1; NEED_REBUILD_WEB=1 ;;
  api) NEED_REBUILD_API=1 ;;
  web) NEED_REBUILD_WEB=1 ;;
esac

# .env is NOT in git, so the diff above doesn't catch its changes.
# Compare its mtime with the last-restart marker — if .env was
# touched after the last restart, the running instances are using
# stale env (typical scenario: user edited POSTGRES_PORT, web→api
# proxy still hits the old port and alembic fails with
# ConnectionRefusedError).
ENV_CHANGED_SINCE_RESTART=0
ENV_MARK="$REPO_ROOT/infra/.last-restart-mtime"
if [ -f .env ]; then
  ENV_MTIME=$(stat -c %Y .env)
  LAST_MTIME=$(cat "$ENV_MARK" 2>/dev/null || echo 0)
  if [ "$ENV_MTIME" -gt "$LAST_MTIME" ]; then
    ENV_CHANGED_SINCE_RESTART=1
    echo "  .env modified since last restart — will restart"
  fi
fi

# ── 3. pnpm install ─────────────────────────────────────────────────
echo
if [ "$NEED_PNPM_INSTALL" = 1 ]; then
  echo "▶ 3/8  pnpm install (package.json / lockfile changed)"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm install 2>&1 | tail -5
  else
    echo "  ⚠ pnpm not on host — skipping (web container will re-install on next start)"
  fi
else
  echo "▶ 3/8  pnpm install (skipped — no FE dep changes)"
fi

# ── 4. schema codegen ───────────────────────────────────────────────
echo
if [ "$NEED_SCHEMA_GEN" = 1 ]; then
  echo "▶ 4/8  pnpm schema:gen (TS + Pydantic)"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm schema:gen 2>&1 | tail -5 || echo "  ⚠ schema:gen failed — check manually"
  else
    echo "  ⚠ pnpm not on host — skipping"
  fi
else
  echo "▶ 4/8  schema:gen (skipped — no schema changes)"
fi

# ── 5. rebuild .sif ─────────────────────────────────────────────────
echo
echo "▶ 5/8  .sif rebuild"
REBUILT_ANY=0
rebuild_sif() {
  local name="$1"
  local sif="$APPT_DIR/${name}.sif"
  local def="$APPT_DIR/${name}.def"
  echo "  → rebuild $name"
  apptainer instance stop "mxwp_${name}" >/dev/null 2>&1
  apptainer build --force "$sif" "$def" 2>&1 | tail -3
  REBUILT_ANY=1
}

if [ "$NEED_REBUILD_API" = 1 ]; then
  rebuild_sif api
fi
if [ "$NEED_REBUILD_WEB" = 1 ]; then
  rebuild_sif web
fi
[ "$REBUILT_ANY" = 0 ] && echo "  (no .def changes)"

# ── 6. restart ──────────────────────────────────────────────────────
echo
if [ "$RESTART" = 1 ]; then
  if [ "$REBUILT_ANY" = 1 ] || [ -n "$CHANGED" ] || [ "$ENV_CHANGED_SINCE_RESTART" = 1 ]; then
    echo "▶ 6/8  restart stack"
    # Force restart — apptainer instance start skips already-running
    # instances and that's exactly what we want to avoid when env changed.
    "$APPTAINER" instance stop --all >/dev/null 2>&1 || true
    "$REPO_ROOT/infra/scripts/start.sh" 2>&1 | sed 's/^/  /' | tail -10
    date +%s > "$ENV_MARK"
  else
    echo "▶ 6/8  restart (skipped — nothing requires it; HMR handles code changes)"
  fi
else
  echo "▶ 6/8  restart (--no-restart)"
fi

# ── 7. migrate ──────────────────────────────────────────────────────
echo
if [ "$NEED_MIGRATE" = 1 ]; then
  echo "▶ 7/8  alembic upgrade head"
  "$REPO_ROOT/infra/scripts/migrate.sh" 2>&1 | sed 's/^/  /' | tail -10
else
  echo "▶ 7/8  migrate (skipped — no new alembic versions)"
fi

# ── 8. diag ─────────────────────────────────────────────────────────
echo
echo "▶ 8/8  status report"
"$REPO_ROOT/infra/scripts/diag.sh" 2>&1 | tail -25

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ update complete"
echo "═══════════════════════════════════════════════════════════════"
if [ "$REBUILT_ANY" = 1 ]; then
  echo "  Note: .sif rebuilt — if you bundle for transport,"
  echo "        re-run the tar | split step before scp."
fi
if [ -z "$OLD_HEAD" ] || [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
  echo "  Nothing new from git — services restarted anyway (env may have changed)"
fi
echo "═══════════════════════════════════════════════════════════════"
