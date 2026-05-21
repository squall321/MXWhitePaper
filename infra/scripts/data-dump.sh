#!/usr/bin/env bash
# Dump content tables + MinIO objects to a portable tar.gz archive.
# Unlike snapshot.sh (full pg_dump), this dumps only content tables as JSONL
# and is designed for cross-server merging with data-merge.sh.
#
# Archive shape (extracted):
#   mxwp-data-<id>/
#     manifest.json           (dump metadata: id, counts, sha256, host)
#     documents.jsonl
#     tags.jsonl
#     document_tags.jsonl
#     divisions.jsonl, teams.jsonl, groups.jsonl, parts.jsonl
#     minio/
#       <bucket-name>/...     (non-backup buckets)
#
# Output: infra/backups/data-dumps/mxwp-data-YYYYMMDD-HHMMSSZ.tar.gz
#         infra/backups/data-dumps/latest.tar.gz (symlink)
#
# Usage:
#   ./infra/scripts/data-dump.sh
#   ./infra/scripts/data-dump.sh --note "to-new-server"
#   ./infra/scripts/data-dump.sh --no-minio
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

# ── Parse args ──────────────────────────────────────────────────────────────
NOTE=""
NO_MINIO=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --note)       NOTE="${2:-}"; shift 2 ;;
    --note=*)     NOTE="${1#*=}"; shift ;;
    --no-minio)   NO_MINIO=1; shift ;;
    -h|--help)
      sed -n '1,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "✗ unknown arg: $1"; exit 1 ;;
  esac
done

# ── Sanity ───────────────────────────────────────────────────────────────────
if ! instance_running "$INST_API"; then
  echo "✗ $INST_API not running — start the stack first"
  exit 1
fi
if [ "$NO_MINIO" -eq 0 ] && ! instance_running "$INST_MINIO"; then
  echo "✗ $INST_MINIO not running — use --no-minio or start the stack"
  exit 1
fi

DUMP_DIR="${DUMP_DIR:-$REPO_ROOT/infra/backups/data-dumps}"
mkdir -p "$DUMP_DIR"

TS_FILE="$(date -u +%Y%m%d-%H%M%SZ)"
TS_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DUMP_ID="$TS_FILE"
WORK_DIR="$(mktemp -d -t mxwp-data-dump-XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT
STAGE="$WORK_DIR/mxwp-data-$DUMP_ID"
mkdir -p "$STAGE"

echo "═════ MXWP data-dump $DUMP_ID ═════"
echo "  created_at : $TS_ISO"
[ -n "$NOTE" ] && echo "  note       : $NOTE"
echo "  no-minio   : $NO_MINIO"
echo

# ── 1) JSONL dump via dump_data.py ───────────────────────────────────────────
# apptainer instance 의 /tmp 는 *isolated tmpfs* — host bind 의 컨테이너측 target
# 으로 쓸 수 없다 ("Directory nonexistent"). /workspace 가 이미 host repo 에 bind 돼
# 있어 RW 라 그 안으로 우회.
JSONL_DIR="$STAGE/jsonl"
WORKSPACE_STAGE="$REPO_ROOT/.tmp/data-dump-$DUMP_ID"
mkdir -p "$WORKSPACE_STAGE"
trap 'rm -rf "$WORK_DIR" "$WORKSPACE_STAGE"' EXIT
echo "→ running dump_data.py"
"$APPTAINER" exec \
  instance://"$INST_API" \
  /bin/sh -c "cd /workspace/apps/api && python -m app.scripts.dump_data --out /workspace/.tmp/data-dump-$DUMP_ID/jsonl"

# Move the JSONL output into the staging dir for packaging.
if [ -d "$WORKSPACE_STAGE/jsonl" ]; then
  mv "$WORKSPACE_STAGE/jsonl" "$STAGE/jsonl"
fi

# Move manifest one level up for easier access
if [ -f "$STAGE/jsonl/manifest.json" ]; then
  cp "$STAGE/jsonl/manifest.json" "$STAGE/manifest.json"
fi
echo "  ✓ JSONL done"

# ── 2) MinIO mirror ──────────────────────────────────────────────────────────
if [ "$NO_MINIO" -eq 0 ]; then
  mkdir -p "$STAGE/minio"
  MC_ALIAS=local
  echo "→ enumerating MinIO buckets"
  BUCKET_LIST="$(
    "$APPTAINER" exec "$MC_SIF" /bin/sh -c "
      mc alias set $MC_ALIAS http://127.0.0.1:${MINIO_API_PORT} '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null 2>&1
      mc ls --json $MC_ALIAS
    " | python3 -c "
import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        rec = json.loads(line)
    except json.JSONDecodeError:
        continue
    name = (rec.get('key') or '').rstrip('/')
    if name:
        print(name)
"
  )"

  if [ -z "$BUCKET_LIST" ]; then
    echo "  ⚠ no MinIO buckets found"
  else
    for bucket in $BUCKET_LIST; do
      case "$bucket" in
        ${MINIO_BUCKET_BACKUPS:-mxwp-backups})
          echo "  · skipping $bucket (backup bucket)"
          continue
          ;;
      esac
      echo "  → mirroring $bucket"
      mkdir -p "$STAGE/minio/$bucket"
      "$APPTAINER" exec \
        --bind "$STAGE/minio/$bucket":/dest \
        "$MC_SIF" \
        /bin/sh -c "
          mc alias set $MC_ALIAS http://127.0.0.1:${MINIO_API_PORT} '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null 2>&1 &&
          mc mirror --quiet --overwrite $MC_ALIAS/$bucket /dest 2>&1
        " | sed 's/^/    /' || {
          echo "  ✗ mirror failed for $bucket"
          exit 1
        }
    done
  fi
  echo "  ✓ MinIO mirror done"
else
  echo "  · MinIO skipped (--no-minio)"
fi

# ── 3) Embed counts + sha256 into the top-level manifest ────────────────────
echo "→ finalising manifest.json"

# Compute per-bucket object counts (if minio dir exists)
buckets_json="[]"
if [ -d "$STAGE/minio" ]; then
  buckets_json="["
  first=1
  for bp in "$STAGE/minio"/*/; do
    [ -d "$bp" ] || continue
    bname="$(basename "$bp")"
    obj_count="$(find "$bp" -type f | wc -l | tr -d ' ')"
    size_bytes="$(du -sb "$bp" | awk '{print $1}')"
    [ "$first" -eq 1 ] || buckets_json="$buckets_json,"
    buckets_json="${buckets_json}{\"name\":\"${bname}\",\"object_count\":${obj_count},\"size_bytes\":${size_bytes}}"
    first=0
  done
  buckets_json="$buckets_json]"
fi

GIT_REV="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
HOSTNAME_VAL="$(hostname 2>/dev/null || echo unknown)"

# Read counts from jsonl manifest if available
COUNTS_JSON="{}"
if [ -f "$STAGE/jsonl/manifest.json" ]; then
  COUNTS_JSON="$(python3 -c "import json; m=json.load(open('$STAGE/jsonl/manifest.json')); print(json.dumps(m.get('counts', {})))")"
fi

cat > "$STAGE/manifest.json" <<JSON
{
  "dump_id": "$DUMP_ID",
  "dump_version": "1",
  "created_at": "$TS_ISO",
  "created_at_epoch": $(date -u +%s),
  "note": $(printf '%s' "$NOTE" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),
  "host": "$HOSTNAME_VAL",
  "git_rev": "$GIT_REV",
  "no_minio": $NO_MINIO,
  "counts": $COUNTS_JSON,
  "minio_buckets": $buckets_json
}
JSON

# ── 4) Pack ──────────────────────────────────────────────────────────────────
OUT_PATH="$DUMP_DIR/mxwp-data-$DUMP_ID.tar.gz"
echo "→ packing → $OUT_PATH"
tar -czf "$OUT_PATH" -C "$WORK_DIR" "mxwp-data-$DUMP_ID"
SIZE_MB=$(du -m "$OUT_PATH" | cut -f1)
SIZE_BYTES=$(stat -c%s "$OUT_PATH" 2>/dev/null || wc -c < "$OUT_PATH")
DUMP_SHA256="$(sha256sum "$OUT_PATH" | awk '{print $1}')"

printf '%s  %s\n' "$DUMP_SHA256" "$(basename "$OUT_PATH")" \
  > "$OUT_PATH.sha256"

ln -sf "$(basename "$OUT_PATH")" "$DUMP_DIR/latest.tar.gz"

echo
echo "✓ data-dump complete"
echo "  file    : $OUT_PATH"
echo "  size    : ${SIZE_MB} MB (${SIZE_BYTES} bytes)"
echo "  sha256  : $DUMP_SHA256"
echo "  latest  : $DUMP_DIR/latest.tar.gz → $(basename "$OUT_PATH")"
echo
echo "Merge into another server:"
echo "  ./infra/scripts/data-merge.sh $OUT_PATH"
