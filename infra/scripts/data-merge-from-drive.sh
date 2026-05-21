#!/usr/bin/env bash
# Pull the most recent data-dump from Google Drive and merge into the local DB.
#
# 반대 방향 — 새 서버에서 한 줄로 *Drive 에서 최신 dump 받기 → 자동 merge*.
# default 정책 = newest (각 항목의 updated_at 더 최신 것 우선).
#
# Required env (load from $REPO_ROOT/.env or shell):
#   MXWP_DRIVE_REMOTE     rclone remote+path. e.g. "ApptainerImages:MXWhitePaper/data-dumps"
#
# Optional:
#   MXWP_MERGE_POLICY     skip | overwrite | newest (default: newest)
#   MXWP_MERGE_DRY_RUN=1  dry-run mode (count only, no DB writes)
#   MXWP_MERGE_NO_MINIO=1 skip MinIO objects
#   MXWP_MERGE_OWNER      assign new docs to this user (email)
#
# Usage:
#   ./infra/scripts/data-merge-from-drive.sh
#   ./infra/scripts/data-merge-from-drive.sh --dry-run
#   MXWP_MERGE_POLICY=overwrite ./infra/scripts/data-merge-from-drive.sh
set -euo pipefail
. "$(dirname "$0")/_common.sh"

if ! command -v rclone >/dev/null 2>&1; then
  echo "✗ rclone not installed. Install: apt-get install rclone"
  exit 1
fi

DRIVE_REMOTE="${MXWP_DRIVE_REMOTE:-}"
if [ -z "$DRIVE_REMOTE" ]; then
  echo "✗ MXWP_DRIVE_REMOTE not set."
  echo "  Example: MXWP_DRIVE_REMOTE=MxwpDrive:MXWhitePaper/data-dumps"
  exit 1
fi
DRIVE_REMOTE="${DRIVE_REMOTE%/}"

# CLI 가 env 보다 우선
POLICY="${MXWP_MERGE_POLICY:-newest}"
DRY_RUN=0
NO_MINIO=0
OWNER=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)        DRY_RUN=1; shift ;;
    --no-minio)       NO_MINIO=1; shift ;;
    --on-conflict=*)  POLICY="${1#*=}"; shift ;;
    --on-conflict)    POLICY="${2:-newest}"; shift 2 ;;
    --owner-email=*)  OWNER="${1#*=}"; shift ;;
    --owner-email)    OWNER="${2:-}"; shift 2 ;;
    *)                echo "✗ unknown arg: $1"; exit 1 ;;
  esac
done
[ "${MXWP_MERGE_DRY_RUN:-0}" = "1" ] && DRY_RUN=1
[ "${MXWP_MERGE_NO_MINIO:-0}" = "1" ] && NO_MINIO=1
[ -z "$OWNER" ] && OWNER="${MXWP_MERGE_OWNER:-}"

case "$POLICY" in
  skip|overwrite|newest) ;;
  *) echo "✗ policy must be 'skip', 'overwrite', or 'newest'"; exit 1 ;;
esac

echo "═════ MXWP data-merge ← Google Drive ═════"
echo "  remote  : $DRIVE_REMOTE"
echo "  policy  : $POLICY"
echo "  dry-run : $DRY_RUN"
echo "  no-minio: $NO_MINIO"
[ -n "$OWNER" ] && echo "  owner   : $OWNER"
echo

# ── 1) Find most recent archive on Drive ────────────────────────────────────
echo "→ listing $DRIVE_REMOTE/"
LATEST_NAME="$(
  rclone lsf --format "tp" --files-only "$DRIVE_REMOTE/" 2>/dev/null \
    | grep '^[0-9-]*T[0-9:.]*Z;mxwp-data-.*\.tar\.gz$' \
    | sort \
    | tail -n 1 \
    | awk -F';' '{print $2}' || true
)"

if [ -z "$LATEST_NAME" ]; then
  echo "✗ no mxwp-data-*.tar.gz found on $DRIVE_REMOTE/"
  echo "  Check: rclone ls $DRIVE_REMOTE/"
  exit 1
fi

echo "  ✓ latest: $LATEST_NAME"

# ── 2) Download (resumable) into infra/backups/data-dumps/ ──────────────────
DOWNLOAD_DIR="$REPO_ROOT/infra/backups/data-dumps"
mkdir -p "$DOWNLOAD_DIR"
LOCAL_PATH="$DOWNLOAD_DIR/$LATEST_NAME"

if [ -f "$LOCAL_PATH" ]; then
  echo "  · already present locally — skipping download"
else
  echo "→ downloading $LATEST_NAME"
  rclone copy --progress "$DRIVE_REMOTE/$LATEST_NAME" "$DOWNLOAD_DIR/"
  if [ ! -f "$LOCAL_PATH" ]; then
    echo "✗ download failed: $LOCAL_PATH not found"
    exit 1
  fi
fi

# 가이드 md 도 같이 받음 (있으면)
GUIDE_NAME="RESTORE-GUIDE-${LATEST_NAME%.tar.gz}.md"
if rclone ls "$DRIVE_REMOTE/$GUIDE_NAME" >/dev/null 2>&1; then
  rclone copy --quiet "$DRIVE_REMOTE/$GUIDE_NAME" "$DOWNLOAD_DIR/" 2>/dev/null || true
fi

# Update local 'latest' symlink
ln -sfn "$LATEST_NAME" "$DOWNLOAD_DIR/latest.tar.gz"

echo "  ✓ local: $LOCAL_PATH"
SIZE_MB="$(du -m "$LOCAL_PATH" | cut -f1)"
echo "  size : ${SIZE_MB} MB"

# ── 3) Run data-merge.sh with the assembled args ────────────────────────────
MERGE_ARGS=("$LOCAL_PATH" "--on-conflict=$POLICY")
[ "$DRY_RUN" -eq 1 ] && MERGE_ARGS+=("--dry-run")
[ "$NO_MINIO" -eq 1 ] && MERGE_ARGS+=("--no-minio")
[ -n "$OWNER" ] && MERGE_ARGS+=("--owner-email=$OWNER")

# CONFIRM 환경변수 통과 — 비대화식 환경 (cron 등) 대응
export CONFIRM="${CONFIRM:-yes}"

echo
echo "→ invoking data-merge.sh"
"$REPO_ROOT/infra/scripts/data-merge.sh" "${MERGE_ARGS[@]}"

echo
echo "✓ data-merge-from-drive complete"
