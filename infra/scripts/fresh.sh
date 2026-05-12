#!/usr/bin/env bash
# Full from-scratch bring-up:
#   clean → start → migrate → seed → status
#
# Use when:
#   - first install on a new machine
#   - after restoring from a project bundle (tar) where data dirs have wrong perms
#   - any time you want to start over from an empty DB
#
# Usage
#   ./infra/scripts/fresh.sh             # interactive (asks before wiping)
#   ./infra/scripts/fresh.sh --yes       # skip confirm (CI / scripted setup)
#   ./infra/scripts/fresh.sh --no-seed   # init schema but skip seed data
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

YES=0
SEED=1
for arg in "$@"; do
  case "$arg" in
    --yes)     YES=1 ;;
    --no-seed) SEED=0 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $arg"; exit 1 ;;
  esac
done

CLEAN_ARGS=()
[ "$YES" -eq 1 ] && CLEAN_ARGS+=("--yes")

echo "▶ Step 1/4 — clean"
"$REPO_ROOT/infra/scripts/clean.sh" "${CLEAN_ARGS[@]}"

echo
echo "▶ Step 2/4 — start"
"$REPO_ROOT/infra/scripts/start.sh"

echo
echo "▶ Step 3/4 — migrate"
"$REPO_ROOT/infra/scripts/migrate.sh"

if [ "$SEED" -eq 1 ]; then
  echo
  echo "▶ Step 4/4 — seed"
  "$REPO_ROOT/infra/scripts/seed.sh" || echo "  ⚠ seed.sh failed — continue anyway"
else
  echo "(--no-seed, skipping seed)"
fi

echo
echo "▶ status"
"$REPO_ROOT/infra/scripts/status.sh"

echo
echo "════════════════════════════════════════════════"
echo "  ✓ MXWhitePaper is fresh + running"
echo "════════════════════════════════════════════════"
echo "    web : http://127.0.0.1:${WEB_PORT}"
echo "    api : http://127.0.0.1:${API_PORT}/docs"
echo "════════════════════════════════════════════════"
