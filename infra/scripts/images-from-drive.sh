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

# 같은 내용이면 손대지 않는다 — 살아 있는 apptainer 인스턴스 밑의 SIF 를 덮어쓰면 squashfs 가 깨지고, cp 는 mtime 을 리셋해 포털 update-all 의
# 재기동 판정(지문: 이름·크기·mtime)이 매번 달라진다. 영구 캐시(rclone 이 안 바뀐 파일을 건너뛴다)와 짝이다. HWAXPortal docs/update-all-skip-unchanged.
_install_if_changed() { if [ -f "$2" ] && cmp -s "$1" "$2"; then echo "  · $(basename "$2") 같음 — 그대로"; return 0; fi; cp -p "$1" "$2"; return 0; }
# 영구 캐시 — 임시 디렉터리면 rclone 이 비교할 것이 없어 매번 전량 전송이다(Drive ~2MB/s). 캐시에 받으면 안 바뀐 파일은 전송 0.
STAGE="${MXWP_DRIVE_CACHE:-$APPT_DIR/.drive-cache}"; mkdir -p "$STAGE"
"$RCLONE" copy --progress "$SRC/" "$STAGE/"

if [ -f "$STAGE/SHA256SUMS" ]; then
  ( cd "$STAGE" && sha256sum -c SHA256SUMS ) || { echo "✗ checksum verification failed — not staging"; exit 1; }
  echo "  ✓ checksums OK"
fi
mkdir -p "$APPT_DIR"
for _s in "$STAGE"/*.sif; do _install_if_changed "$_s" "$APPT_DIR/$(basename "$_s")"; done
echo "  ✓ staged $(ls "$STAGE"/*.sif | wc -l) image(s) → $APPT_DIR (같은 것은 그대로)"
echo
echo "✓ images ready — now run:  ./infra/scripts/start.sh   (no build; web runs the baked dist)"
