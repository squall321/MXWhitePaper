#!/usr/bin/env bash
# Wipe all on-disk state — bind volumes (postgres / meili / minio data),
# Apptainer instances, optionally the .sif images.
#
# Useful when:
#   - data dirs carry over from another machine with wrong ownership
#     (typical after `tar -xf bundle.tar`) and a service can't open them.
#   - you want a guaranteed-clean reset before running fresh.sh.
#
# Does NOT touch:
#   - source code / node_modules / repo files
#   - .env
#
# Usage
#   ./infra/scripts/clean.sh                 # stop + wipe data dirs
#   ./infra/scripts/clean.sh --with-images   # + delete .sif images too
#   ./infra/scripts/clean.sh --yes           # skip confirm prompt
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

WITH_IMAGES=0
SKIP_CONFIRM=0
for arg in "$@"; do
  case "$arg" in
    --with-images) WITH_IMAGES=1 ;;
    --yes)         SKIP_CONFIRM=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $arg"; exit 1 ;;
  esac
done
[ "${CONFIRM:-}" = "yes" ] && SKIP_CONFIRM=1

echo "About to WIPE local stack state:"
echo "  - stop all instances (postgres / meili / minio / api / web)"
echo "  - rm -rf $DATA_DIR/{postgres,postgres-run,meili,minio}"
[ "$WITH_IMAGES" -eq 1 ] && echo "  - rm -f $APPT_DIR/*.sif  (you'll need to rebuild)"
echo
echo "⚠  모든 DB / 검색 인덱스 / 업로드 파일이 사라집니다."

if [ "$SKIP_CONFIRM" -ne 1 ]; then
  printf "Continue? Type 'CLEAN' to proceed: "
  read -r REPLY
  [ "$REPLY" = "CLEAN" ] || { echo "✗ aborted"; exit 1; }
fi

# ── stop everything (preserves data this time, then we wipe) ────────
"$REPO_ROOT/infra/scripts/stop.sh" || true

# ── nuke data dirs ──────────────────────────────────────────────────
echo "→ wiping data dirs"
rm -rf \
  "$DATA_DIR/postgres" \
  "$DATA_DIR/postgres-run" \
  "$DATA_DIR/meili" \
  "$DATA_DIR/minio"

# Recreate with permissive perms so the in-container service users
# (which may not match host UID after a cross-machine transfer) can
# write to them on first init.
mkdir -p "$DATA_DIR/postgres" "$DATA_DIR/meili" "$DATA_DIR/minio"
chmod 777 "$DATA_DIR/meili" "$DATA_DIR/minio"
echo "  ✓ data dirs recreated (empty, world-writable for meili/minio)"

# ── optional: also nuke .sif images ─────────────────────────────────
if [ "$WITH_IMAGES" -eq 1 ]; then
  echo "→ removing .sif images"
  rm -f "$APPT_DIR"/*.sif
  echo "  ✓ run build.sh next to rebuild"
fi

echo
echo "✓ clean complete"
echo "  Next: ./infra/scripts/fresh.sh    (or start.sh + migrate.sh + seed.sh manually)"
