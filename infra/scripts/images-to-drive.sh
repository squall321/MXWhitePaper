#!/usr/bin/env bash
# Push the BUILT .sif images to Google Drive via rclone, so cae00 (corporate TLS-intercept network
# where npm/Docker-Hub are unreachable) pulls them instead of building. Mirrors HWAXPortal's
# images-to-drive.sh. The web.sif has the prebuilt SPA dist baked in (see web.def), so cae00 runs it
# with NO pnpm/corepack.
#
# Run on an ONLINE build host, AFTER building:
#   MXWP_BASE_PATH=/mx-white-paper/ pnpm --filter @mx/web build     # base baked into dist
#   apptainer build infra/apptainer/web.sif infra/apptainer/web.def # bakes dist into the sif
#   ./infra/scripts/images-to-drive.sh
#
# Needs in .env:  MXWP_IMAGES_REMOTE=MxwpDrive:MXWhitePaper/images  (reuses the SAME rclone remote
# as MXWP_DRIVE_REMOTE — only the path segment differs, so no new OAuth).
set -euo pipefail
. "$(dirname "$0")/_common.sh"

RCLONE="${RCLONE:-rclone}"; command -v "$RCLONE" >/dev/null 2>&1 \
  || { echo "✗ rclone not found — run ./infra/scripts/setup-drive-sync.sh"; exit 1; }
REMOTE="${MXWP_IMAGES_REMOTE:-}"
[ -n "$REMOTE" ] \
  || { echo "✗ MXWP_IMAGES_REMOTE not set in .env (e.g. MxwpDrive:MXWhitePaper/images)"; exit 1; }
REMOTE="${REMOTE%/}"
RETAIN="${MXWP_IMAGES_RETAIN:-3}"

# Ship web.sif always (it changes with the SPA); api.sif optionally (set MXWP_IMAGES_WITH_API=1).
# postgres/meili/minio rarely change — ship them once with MXWP_IMAGES_ALL=1 if cae00 lacks them.
TO_SHIP=("$WEB_SIF")
[ "${MXWP_IMAGES_WITH_API:-0}" = "1" ] && TO_SHIP+=("$API_SIF")
[ "${MXWP_IMAGES_ALL:-0}" = "1" ] && TO_SHIP+=("$API_SIF" "$POSTGRES_SIF" "$MEILI_SIF" "$MINIO_SIF" "$MC_SIF")
for f in "${TO_SHIP[@]}"; do
  [ -f "$f" ] || { echo "✗ missing $f — build it first (./infra/scripts/build.sh)"; exit 1; }
done

TS="$(date -u +%Y%m%d-%H%M%SZ)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
# de-dup the list, copy in
printf '%s\n' "${TO_SHIP[@]}" | sort -u | while read -r f; do cp "$f" "$STAGE/"; done
( cd "$STAGE" && sha256sum ./*.sif > SHA256SUMS )

echo "→ uploading $(ls "$STAGE"/*.sif | wc -l) image(s) to $REMOTE/images-$TS/ (+ latest/)"
"$RCLONE" copy --progress "$STAGE/" "$REMOTE/images-$TS/"
"$RCLONE" sync --progress "$STAGE/" "$REMOTE/latest/"

if [ "$RETAIN" -gt 0 ]; then
  echo "→ retention: keep last $RETAIN image set(s)"
  # 최초 publish 때는 images-* 디렉터리가 하나도 없어 grep 이 rc=1 을 낸다. set -e 라
  # 그 자리에서 스크립트가 출력 없이 종료됐다 — 업로드는 끝났는데 exit 1 이라 호출자는
  # 실패로 본다. 파이프 전체를 `|| true` 로 감싸 '지울 게 없음'을 정상으로 취급한다.
  _old_sets="$("$RCLONE" lsf --dirs-only "$REMOTE/" 2>/dev/null | sed 's#/$##' \
                | grep -E '^images-' | sort | head -n -"$RETAIN" || true)"
  if [ -n "$_old_sets" ]; then
    printf '%s\n' "$_old_sets" | while read -r old; do
      [ -n "$old" ] || continue
      echo "  · deleting $old/"; "$RCLONE" purge "$REMOTE/$old" 2>/dev/null || true
    done
  else
    echo "  · 지울 이전 이미지 세트 없음"
  fi
fi

echo
echo "✓ pushed to $REMOTE"
echo "  On cae00:  set MXWP_IMAGES_REMOTE in .env  →  ./infra/scripts/images-from-drive.sh  →  ./infra/scripts/start.sh"
