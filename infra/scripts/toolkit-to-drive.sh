#!/usr/bin/env bash
# llm-docx-toolkit 바이너리 tarball 을 Google Drive 로 push (images-to-drive.sh 의 툴킷판).
# sif 와 같은 rclone remote 를 쓰되 path 만 /toolkit 으로 분리한다 — 툴킷은 MCP/RAG 변경마다
# sif 보다 자주 바뀌므로 별도 경로/타겟으로 둔다 (새 OAuth 불필요).
#
# ONLINE build host 에서, 빌드 후 실행:
#   apptainer exec instance://mxwp_api bash -lc 'cd /workspace/dist/llm-docx-toolkit && python3 build.py --clean --variant lite'
#   ./infra/scripts/toolkit-to-drive.sh
#
# .env: MXWP_TOOLKIT_REMOTE (미설정 시 MXWP_IMAGES_REMOTE 의 /images 를 /toolkit 으로 치환).
set -euo pipefail
. "$(dirname "$0")/_common.sh"

RCLONE="${RCLONE:-rclone}"; command -v "$RCLONE" >/dev/null 2>&1 \
  || { echo "✗ rclone not found — run ./infra/scripts/setup-drive-sync.sh"; exit 1; }

# Default: reuse the images remote, swap the trailing path segment for /toolkit.
REMOTE="${MXWP_TOOLKIT_REMOTE:-}"
if [ -z "$REMOTE" ]; then
  [ -n "${MXWP_IMAGES_REMOTE:-}" ] \
    || { echo "✗ set MXWP_TOOLKIT_REMOTE or MXWP_IMAGES_REMOTE in .env"; exit 1; }
  REMOTE="${MXWP_IMAGES_REMOTE%/}"; REMOTE="${REMOTE%/*}/toolkit"
fi
REMOTE="${REMOTE%/}"
RETAIN="${MXWP_TOOLKIT_RETAIN:-3}"

TARBALL="$REPO_ROOT/dist/llm-docx-toolkit/_release/lite-linux/llm-docx-toolkit-lite-linux.tar.gz"
[ -f "$TARBALL" ] \
  || { echo "✗ missing $TARBALL — build it first (build.py --clean --variant lite)"; exit 1; }

TS="$(date -u +%Y%m%d-%H%M%SZ)"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp "$TARBALL" "$STAGE/"
( cd "$STAGE" && sha256sum ./*.tar.gz > SHA256SUMS )

echo "→ uploading toolkit tarball ($(du -h "$TARBALL" | cut -f1)) to $REMOTE/toolkit-$TS/ (+ latest/)"
"$RCLONE" copy --progress "$STAGE/" "$REMOTE/toolkit-$TS/"
"$RCLONE" sync --progress "$STAGE/" "$REMOTE/latest/"

if [ "$RETAIN" -gt 0 ]; then
  echo "→ retention: keep last $RETAIN toolkit set(s)"
  "$RCLONE" lsf --dirs-only "$REMOTE/" 2>/dev/null | sed 's#/$##' | grep -E '^toolkit-' \
    | sort | head -n -"$RETAIN" | while read -r old; do
        echo "  · deleting $old/"; "$RCLONE" purge "$REMOTE/$old" 2>/dev/null || true
      done
fi

echo
echo "✓ pushed to $REMOTE"
echo "  On cae00:  set MXWP_TOOLKIT_REMOTE (또는 MXWP_IMAGES_REMOTE) in .env  →  ./infra/scripts/toolkit-from-drive.sh"
