#!/usr/bin/env bash
# Pull the built .sif images from Google Drive into infra/apptainer/, so start.sh runs them with
# NO build (cae00 can't reach npm/Docker-Hub). Mirrors HWAXPortal's images-from-drive.sh.
# The web.sif already has the SPA dist baked in (web.def), so nothing builds on cae00.
#
# Needs in .env:  MXWP_IMAGES_REMOTE=MxwpDrive:MXWhitePaper/images
# After this:  ./infra/scripts/start.sh   (build.sh sees the sifs exist → "skip")
set -euo pipefail
. "$(dirname "$0")/_common.sh"

RCLONE="${RCLONE:-rclone}"; command -v "$RCLONE" >/dev/null 2>&1 \
  || { echo "✗ rclone not found — run ./infra/scripts/setup-drive-sync.sh"; exit 1; }
REMOTE="${MXWP_IMAGES_REMOTE:-}"
[ -n "$REMOTE" ] \
  || { echo "✗ MXWP_IMAGES_REMOTE not set in .env (e.g. MxwpDrive:MXWhitePaper/images)"; exit 1; }
REMOTE="${REMOTE%/}"

SRC="$REMOTE/latest"
if ! "$RCLONE" lsf "$SRC/" 2>/dev/null | grep -q '^web\.sif$'; then
  NEWEST="$("$RCLONE" lsf --dirs-only "$REMOTE/" 2>/dev/null | sed 's#/$##' | grep -E '^images-' | sort | tail -n 1 || true)"
  [ -n "$NEWEST" ] || { echo "✗ no images on $REMOTE. Push from an online host: ./infra/scripts/images-to-drive.sh"; exit 1; }
  SRC="$REMOTE/$NEWEST"
fi
echo "→ source: $SRC"

STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
"$RCLONE" copy --progress "$SRC/" "$STAGE/"

if [ -f "$STAGE/SHA256SUMS" ]; then
  ( cd "$STAGE" && sha256sum -c SHA256SUMS ) || { echo "✗ checksum verification failed — not staging"; exit 1; }
  echo "  ✓ checksums OK"
fi
mkdir -p "$APPT_DIR"
cp "$STAGE"/*.sif "$APPT_DIR/"
echo "  ✓ staged $(ls "$STAGE"/*.sif | wc -l) image(s) → $APPT_DIR"
echo
echo "✓ images ready — now run:  ./infra/scripts/start.sh   (no build; web runs the baked dist)"
