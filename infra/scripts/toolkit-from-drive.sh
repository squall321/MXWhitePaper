#!/usr/bin/env bash
# Google Drive 에서 llm-docx-toolkit tarball 을 pull + 검증 + 추출 (images-from-drive.sh 의 툴킷판).
# cae00 등 빌드 안 하는 호스트가 최신 toolkit 바이너리(mxwp-mcp/mxwp-rules/...)를 받아 쓴다.
#
# .env: MXWP_TOOLKIT_REMOTE (미설정 시 MXWP_IMAGES_REMOTE 의 /images → /toolkit).
# 추출 위치: dist/llm-docx-toolkit/_release/lite-linux/ (tarball + 풀린 디렉토리).
set -euo pipefail
. "$(dirname "$0")/_common.sh"

RCLONE="${RCLONE:-rclone}"; command -v "$RCLONE" >/dev/null 2>&1 \
  || { echo "✗ rclone not found — run ./infra/scripts/setup-drive-sync.sh"; exit 1; }

REMOTE="${MXWP_TOOLKIT_REMOTE:-}"
if [ -z "$REMOTE" ]; then
  [ -n "${MXWP_IMAGES_REMOTE:-}" ] \
    || { echo "✗ set MXWP_TOOLKIT_REMOTE or MXWP_IMAGES_REMOTE in .env"; exit 1; }
  REMOTE="${MXWP_IMAGES_REMOTE%/}"; REMOTE="${REMOTE%/*}/toolkit"
fi
REMOTE="${REMOTE%/}"

SRC="$REMOTE/latest"
if ! "$RCLONE" lsf "$SRC/" 2>/dev/null | grep -q '\.tar\.gz$'; then
  NEWEST="$("$RCLONE" lsf --dirs-only "$REMOTE/" 2>/dev/null | sed 's#/$##' | grep -E '^toolkit-' | sort | tail -n 1 || true)"
  [ -n "$NEWEST" ] || { echo "✗ no toolkit on $REMOTE. Push from an online host: ./infra/scripts/toolkit-to-drive.sh"; exit 1; }
  SRC="$REMOTE/$NEWEST"
fi
echo "→ source: $SRC"

STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
"$RCLONE" copy --progress "$SRC/" "$STAGE/"

if [ -f "$STAGE/SHA256SUMS" ]; then
  ( cd "$STAGE" && sha256sum -c SHA256SUMS ) || { echo "✗ checksum verification failed — not extracting"; exit 1; }
  echo "  ✓ checksums OK"
fi

DEST="$REPO_ROOT/dist/llm-docx-toolkit/_release/lite-linux"
mkdir -p "$DEST"
cp "$STAGE"/*.tar.gz "$DEST/"
tar -xzf "$DEST/llm-docx-toolkit-lite-linux.tar.gz" -C "$DEST"
echo "  ✓ extracted → $DEST/llm-docx-toolkit-lite-linux/"
echo
echo "✓ toolkit ready — binaries at $DEST/llm-docx-toolkit-lite-linux/bin/"
