#!/usr/bin/env bash
# Recover from accidentally running Apptainer/pnpm/pip with sudo.
#
# Things sudo can break (and this script fixes):
#   - Apptainer instances started as root → still running, hidden from
#     user `apptainer instance list`
#   - infra/data/ owned by root → user can't write next time
#   - infra/logs/, infra/backups/ owned by root
#   - node_modules/, .pnpm-store/, .tsbuild-node/ owned by root
#   - /tmp/pnpm-install.log owned by root → blocks future writes
#   - .venv/ owned by root
#   - schema codegen output owned by root
#   - ~/.apptainer/ partial root ownership (instance state files)
#
# Usage:
#   ./infra/scripts/desudo.sh           # interactive (asks before chown)
#   ./infra/scripts/desudo.sh --yes     # skip prompt
#   ./infra/scripts/desudo.sh --dry-run # show what WOULD change
#
# Needs sudo itself — it has to delete root-owned files. That's the
# *only* time you should sudo into this codebase.
set -uo pipefail
cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
USER_UID="$(id -u)"
USER_GID="$(id -g)"
USER_NAME="$(id -un)"

YES=0
DRY=0
for arg in "$@"; do
  case "$arg" in
    --yes)     YES=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $arg"; exit 1 ;;
  esac
done

run() {
  if [ "$DRY" = 1 ]; then
    printf "  [dry-run] %s\n" "$*"
  else
    eval "$@"
  fi
}

echo "═══════════════════════════════════════════════════════════════"
echo "  MXWhitePaper — desudo (recover from sudo-run state)"
echo "  user : $USER_NAME ($USER_UID:$USER_GID)"
echo "  repo : $REPO_ROOT"
[ "$DRY" = 1 ] && echo "  MODE : dry-run (no changes)"
echo "═══════════════════════════════════════════════════════════════"

# ── A. find root-owned files inside the repo + state dirs ───────────
echo
echo "▶ A. scanning for root-owned files…"
ROOT_OWNED=$(find "$REPO_ROOT" "$HOME/.apptainer" /tmp/pnpm-install.log 2>/dev/null \
  -uid 0 -not -path "*/.git/*" 2>/dev/null | head -50)

if [ -z "$ROOT_OWNED" ]; then
  echo "  ✓ no root-owned files found"
else
  echo "  found (showing up to 50):"
  echo "$ROOT_OWNED" | sed 's/^/    /'
fi

# ── B. confirmation ─────────────────────────────────────────────────
if [ -n "$ROOT_OWNED" ] && [ "$YES" = 0 ] && [ "$DRY" = 0 ]; then
  echo
  printf "Proceed with cleanup? Type 'DESUDO' to continue: "
  read -r REPLY
  [ "$REPLY" = "DESUDO" ] || { echo "✗ aborted"; exit 1; }
fi

# ── C. stop both user + sudo-owned apptainer instances ─────────────
echo
echo "▶ C. stopping apptainer instances (user + root)"
if command -v apptainer >/dev/null 2>&1; then
  run "apptainer instance stop --all >/dev/null 2>&1 || true"
  if [ -d /root/.apptainer ] || sudo -n true 2>/dev/null; then
    run "sudo apptainer instance stop --all >/dev/null 2>&1 || true"
  fi
  echo "  ✓ all instances stopped"
else
  echo "  (apptainer not found — skipping)"
fi

# ── D. chown the worst offenders back to user ──────────────────────
echo
echo "▶ D. fixing ownership"
for d in \
  infra/data \
  infra/logs \
  infra/backups \
  infra/apptainer \
  node_modules \
  .pnpm-store \
  .tsbuild-node \
  apps/api/.venv \
  apps/web/node_modules \
  apps/web/dist \
  apps/api/app/schemas/generated \
  apps/web/src/types/generated \
  apps/api/__pycache__ \
  ; do
  if [ -e "$d" ]; then
    run "sudo chown -R $USER_UID:$USER_GID '$REPO_ROOT/$d'"
    echo "  ✓ $d"
  fi
done

# Fix the home apptainer state too
if [ -d "$HOME/.apptainer" ]; then
  run "sudo chown -R $USER_UID:$USER_GID '$HOME/.apptainer'"
  echo "  ✓ ~/.apptainer"
fi

# /tmp/pnpm-install.log — the startscript can't overwrite a root file
if [ -e /tmp/pnpm-install.log ]; then
  run "sudo rm -f /tmp/pnpm-install.log"
  echo "  ✓ /tmp/pnpm-install.log (deleted)"
fi

# Empty out the root-side apptainer state if any
if [ -d /root/.apptainer/instances ] && sudo -n true 2>/dev/null; then
  run "sudo rm -rf /root/.apptainer/instances/* 2>/dev/null || true"
  echo "  ✓ /root/.apptainer/instances (cleared)"
fi

# ── E. permissive perms for service data dirs ──────────────────────
echo
echo "▶ E. permissive perms on bind-mount targets"
for d in infra/data/meili infra/data/minio infra/data/postgres-run; do
  if [ -d "$d" ]; then
    run "chmod 777 '$REPO_ROOT/$d'"
    echo "  ✓ $d  (chmod 777)"
  fi
done

# postgres data dir — must be 700 / owned by user (or container user 999)
# Keeping user ownership; postgres in container respects --bind effective UID.
if [ -d "infra/data/postgres" ]; then
  run "chmod 700 '$REPO_ROOT/infra/data/postgres'"
  echo "  ✓ infra/data/postgres  (chmod 700)"
fi

# ── F. verify ──────────────────────────────────────────────────────
echo
echo "▶ F. verifying"
remaining=$(find "$REPO_ROOT" "$HOME/.apptainer" 2>/dev/null \
  -uid 0 -not -path "*/.git/*" 2>/dev/null | head -5)
if [ -z "$remaining" ]; then
  echo "  ✓ no root-owned files remaining"
else
  echo "  ⚠ still root-owned (run again or chown manually):"
  echo "$remaining" | sed 's/^/    /'
fi

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  ✓ desudo complete"
echo "═══════════════════════════════════════════════════════════════"
echo "  Next:"
echo "    ./infra/scripts/fresh.sh --yes    # full clean restart"
echo "  or"
echo "    ./infra/scripts/start.sh          # just bring back up"
echo "═══════════════════════════════════════════════════════════════"
