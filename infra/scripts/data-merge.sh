#!/usr/bin/env bash
# Merge a data dump (from data-dump.sh) INTO the current stack — additive.
# Unlike restore-snapshot.sh which wipes everything, this is non-destructive:
# existing rows are kept (or overwritten) according to --on-conflict policy.
#
# Usage:
#   ./infra/scripts/data-merge.sh <archive.tar.gz> [options]
#   ./infra/scripts/data-merge.sh latest
#   CONFIRM=yes ./infra/scripts/data-merge.sh latest --on-conflict=overwrite
#
# Options:
#   --on-conflict=skip|overwrite   (default: skip)
#   --dry-run                      count only, no writes
#   --no-minio                     skip MinIO object copy
#   --owner-email=<email>          assign new docs to this user
#   --yes                          skip confirmation prompt
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

DUMP_DIR="${DUMP_DIR:-$REPO_ROOT/infra/backups/data-dumps}"

# ── Parse args ──────────────────────────────────────────────────────────────
RAW_ARG="${1:-latest}"
ON_CONFLICT="skip"
DRY_RUN=0
NO_MINIO=0
SKIP_CONFIRM=0
OWNER_EMAIL=""

shift || true
while [ "$#" -gt 0 ]; do
  case "$1" in
    --on-conflict=*)  ON_CONFLICT="${1#*=}"; shift ;;
    --on-conflict)    ON_CONFLICT="${2:-skip}"; shift 2 ;;
    --dry-run)        DRY_RUN=1; shift ;;
    --no-minio)       NO_MINIO=1; shift ;;
    --yes)            SKIP_CONFIRM=1; shift ;;
    --owner-email=*)  OWNER_EMAIL="${1#*=}"; shift ;;
    --owner-email)    OWNER_EMAIL="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '1,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "✗ unknown arg: $1"; exit 1 ;;
  esac
done

if [ "${CONFIRM:-}" = "yes" ]; then
  SKIP_CONFIRM=1
fi

# Validate on-conflict value (skip / overwrite / newest)
case "$ON_CONFLICT" in
  skip|overwrite|newest) ;;
  *) echo "✗ --on-conflict must be 'skip', 'overwrite', or 'newest'"; exit 1 ;;
esac

# ── Resolve archive path ─────────────────────────────────────────────────────
if [ "$RAW_ARG" = "latest" ]; then
  ARCHIVE="$DUMP_DIR/latest.tar.gz"
elif [ -f "$RAW_ARG" ]; then
  ARCHIVE="$RAW_ARG"
elif [ -f "$DUMP_DIR/$RAW_ARG" ]; then
  ARCHIVE="$DUMP_DIR/$RAW_ARG"
else
  echo "✗ dump archive not found: $RAW_ARG"
  echo "  Available in $DUMP_DIR:"
  ls -t "$DUMP_DIR"/*.tar.gz 2>/dev/null | head -5 || echo "  (none)"
  exit 1
fi
RESOLVED="$(readlink -f "$ARCHIVE" 2>/dev/null || echo "$ARCHIVE")"
[ -f "$RESOLVED" ] || { echo "✗ resolved path does not exist: $RESOLVED"; exit 1; }
SIZE_MB=$(du -m "$RESOLVED" | cut -f1)

# ── Verify checksum ──────────────────────────────────────────────────────────
if [ -f "$RESOLVED.sha256" ]; then
  echo "→ verifying sha256"
  (cd "$(dirname "$RESOLVED")" && sha256sum -c "$(basename "$RESOLVED").sha256") \
    || { echo "✗ checksum mismatch — refuse to merge"; exit 1; }
fi

# ── Extract + inspect manifest ───────────────────────────────────────────────
WORK_DIR="$(mktemp -d -t mxwp-merge-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
echo "→ extracting to $WORK_DIR"
tar -xzf "$RESOLVED" -C "$WORK_DIR"
INNER_DIR="$(find "$WORK_DIR" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -d "$INNER_DIR" ] || { echo "✗ archive has no top-level directory"; exit 1; }

MANIFEST="$INNER_DIR/manifest.json"
[ -f "$MANIFEST" ] || { echo "✗ manifest.json missing from dump archive"; exit 1; }

DUMP_ID="$(python3 -c "import json; print(json.load(open('$MANIFEST')).get('dump_id','?'))")"
DUMP_AT="$(python3 -c "import json; print(json.load(open('$MANIFEST')).get('created_at','?'))")"
DUMP_NOTE="$(python3 -c "import json; print(json.load(open('$MANIFEST')).get('note') or '')")"
DUMP_VERSION="$(python3 -c "import json; print(json.load(open('$MANIFEST')).get('dump_version','?'))")"

if [ "$DUMP_VERSION" != "1" ]; then
  echo "✗ unsupported dump_version: $DUMP_VERSION (expected '1')"
  exit 1
fi

# JSONL dir may be at <inner>/jsonl/ or directly at <inner>/
JSONL_DIR="$INNER_DIR/jsonl"
if [ ! -d "$JSONL_DIR" ]; then
  JSONL_DIR="$INNER_DIR"
fi
[ -f "$JSONL_DIR/documents.jsonl" ] || {
  echo "✗ documents.jsonl not found inside archive"
  exit 1
}

# ── Sanity: instances running ────────────────────────────────────────────────
if ! instance_running "$INST_API"; then
  echo "✗ $INST_API not running — start the stack first"
  exit 1
fi
if ! instance_running "$INST_POSTGRES"; then
  echo "✗ $INST_POSTGRES not running — start the stack first"
  exit 1
fi
if [ "$NO_MINIO" -eq 0 ] && ! instance_running "$INST_MINIO"; then
  echo "⚠ $INST_MINIO not running — using --no-minio automatically"
  NO_MINIO=1
fi

# ── Confirm prompt ───────────────────────────────────────────────────────────
DOC_COUNT="$(python3 -c "
import json
m = json.load(open('$MANIFEST'))
print(m.get('counts', {}).get('documents', '?'))
")"

cat <<INFO
About to MERGE into the current MX White Paper stack:
  archive    : $RESOLVED
  size       : ${SIZE_MB} MB
  dump_id    : $DUMP_ID
  created_at : $DUMP_AT
  documents  : ~$DOC_COUNT rows
$( [ -n "$DUMP_NOTE" ] && echo "  note       : $DUMP_NOTE" )

  on-conflict: $ON_CONFLICT
  dry-run    : $DRY_RUN
  no-minio   : $NO_MINIO
$( [ -n "$OWNER_EMAIL" ] && echo "  owner      : $OWNER_EMAIL" )

This is ADDITIVE — existing rows are NOT deleted.
INFO

if [ "$DRY_RUN" -eq 1 ]; then
  echo "  (dry-run mode — no writes will occur)"
elif [ "$SKIP_CONFIRM" -ne 1 ]; then
  printf "Continue? Type 'yes' to proceed: "
  read -r REPLY
  if [ "$REPLY" != "yes" ]; then
    echo "✗ aborted"
    exit 1
  fi
fi

echo

# ── Build import_dump.py args ────────────────────────────────────────────────
# apptainer instance /tmp 는 isolated tmpfs — bind target 으로 못 씀.
# /workspace 가 host repo 에 bind 돼 있어 그 안으로 우회.
MERGE_STAGE_REL=".tmp/data-merge-$$"
MERGE_STAGE="$REPO_ROOT/$MERGE_STAGE_REL"
mkdir -p "$MERGE_STAGE"
cp -r "$JSONL_DIR/." "$MERGE_STAGE/"
trap 'rm -rf "$WORK_DIR" "$MERGE_STAGE"' EXIT
IMPORT_ARGS="--dir /workspace/$MERGE_STAGE_REL --on-conflict=$ON_CONFLICT"
[ "$DRY_RUN" -eq 1 ] && IMPORT_ARGS="$IMPORT_ARGS --dry-run"
[ -n "$OWNER_EMAIL" ] && IMPORT_ARGS="$IMPORT_ARGS --owner-email=$OWNER_EMAIL"

# ── Run import_dump.py ───────────────────────────────────────────────────────
echo "→ running import_dump.py"
"$APPTAINER" exec \
  --bind "$JSONL_DIR":/mxwp_merge_in \
  instance://"$INST_API" \
  /bin/sh -c "cd /workspace/apps/api && python -m app.scripts.import_dump $IMPORT_ARGS"

# ── MinIO additive copy ──────────────────────────────────────────────────────
MINIO_SRC="$INNER_DIR/minio"
if [ "$NO_MINIO" -eq 0 ] && [ -d "$MINIO_SRC" ]; then
  MC_ALIAS=local
  echo "→ merging MinIO objects (no-overwrite)"
  for bucket_dir in "$MINIO_SRC"/*/; do
    [ -d "$bucket_dir" ] || continue
    bucket="$(basename "$bucket_dir")"
    echo "  → bucket: $bucket"
    if [ "$DRY_RUN" -eq 0 ]; then
      # mc mirror /src -> remote: copies objects from dump into MinIO.
      # Without --overwrite, mc mirrors only objects that do not yet exist
      # on the destination (additive behaviour). Images are content-addressed
      # (sha256 in the path) so collisions mean identical content anyway.
      "$APPTAINER" exec \
        --bind "$bucket_dir":/src \
        "$MC_SIF" \
        /bin/sh -c "
          mc alias set $MC_ALIAS http://127.0.0.1:${MINIO_API_PORT} '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null 2>&1 &&
          mc mb -p $MC_ALIAS/$bucket >/dev/null 2>&1 || true
          mc mirror --quiet /src $MC_ALIAS/$bucket 2>&1
        " | sed 's/^/    /' || echo "  ⚠ some objects may not have copied"
    else
      obj_count="$(find "$bucket_dir" -type f | wc -l | tr -d ' ')"
      echo "    (dry-run) would copy $obj_count objects"
    fi
  done
  echo "  ✓ MinIO merge done"
elif [ "$NO_MINIO" -eq 1 ]; then
  echo "  · MinIO skipped (--no-minio)"
else
  echo "  · no minio/ directory in dump"
fi

# ── Post-processing ──────────────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 0 ]; then
  # NO_PROXY 자동 보강 — 회사 HTTPS_PROXY 가 설정된 환경에서 LAN/localhost 호출
  # (postgres, meili) 까지 proxy 거치려 해서 실패하는 케이스 방지.
  # 사내 LAN 의 *전체 10.252.39.0/24* 와 MEILI_HOST 의 host 부분 모두 우회.
  _MEILI_HOST_ONLY="$(echo "${MEILI_HOST:-http://127.0.0.1:7700}" \
    | sed -E 's|^https?://||; s|:[0-9]+$||; s|/.*$||')"
  AUTO_NO_PROXY="localhost,127.0.0.1,$_MEILI_HOST_ONLY"
  AUTO_NO_PROXY="$AUTO_NO_PROXY,10.252.39.181,10.252.39.140"
  AUTO_NO_PROXY="$AUTO_NO_PROXY,postgres,meili,minio,api"
  if [ -n "${NO_PROXY:-}" ]; then
    AUTO_NO_PROXY="$NO_PROXY,$AUTO_NO_PROXY"
  fi

  echo
  echo "→ post-processing: refresh_links"
  "$APPTAINER" exec \
    --env NO_PROXY="$AUTO_NO_PROXY" \
    --env no_proxy="$AUTO_NO_PROXY" \
    instance://"$INST_API" \
    /bin/sh -c "cd /workspace/apps/api && python -m app.scripts.refresh_links"

  echo "→ post-processing: reindex"
  "$APPTAINER" exec \
    --env MEILI_HOST="${MEILI_HOST:-http://127.0.0.1:7700}" \
    --env MEILI_MASTER_KEY="${MEILI_MASTER_KEY:-}" \
    --env NO_PROXY="$AUTO_NO_PROXY" \
    --env no_proxy="$AUTO_NO_PROXY" \
    instance://"$INST_API" \
    /bin/sh -c "cd /workspace/apps/api && python -m app.scripts.reindex"
fi

echo
echo "✓ data-merge complete"
[ "$DRY_RUN" -eq 1 ] && echo "  (dry-run — no data was modified)"
