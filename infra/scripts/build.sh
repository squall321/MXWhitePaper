#!/usr/bin/env bash
# Build / pull all .sif images required for the MXWP stack.
# Idempotent — skips images that already exist (use --force to rebuild).
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

build_or_pull() {
  local sif="$1" src="$2" def="${3:-}"
  if [ "$FORCE" -eq 1 ] || [ ! -f "$sif" ]; then
    if [ -n "$def" ]; then
      echo "→ build $(basename "$sif") from $def"
      "$APPTAINER" build --force "$sif" "$def"
    else
      echo "→ pull  $(basename "$sif") from $src"
      "$APPTAINER" pull  --force "$sif" "$src"
    fi
  else
    echo "✓ skip  $(basename "$sif") (exists)"
  fi
}

# Base images pulled from docker-hub. *-base.sif have empty startscript
# (Apptainer keeps the docker ENTRYPOINT only in the runscript), so they
# cannot be launched directly via `instance start` and need wrapper builds
# below that supply an explicit %startscript.
build_or_pull "${APPT_DIR}/postgres-base.sif" "docker://pgvector/pgvector:pg15"
build_or_pull "${APPT_DIR}/meili-base.sif"    "docker://getmeili/meilisearch:v1.10"
build_or_pull "${APPT_DIR}/minio-base.sif"    "docker://minio/minio:RELEASE.2024-09-22T00-33-43Z"
build_or_pull "$MC_SIF"                       "docker://minio/mc:RELEASE.2024-09-16T17-43-14Z"

# Wrapper builds — add startscript so `apptainer instance start` actually
# launches the daemon.
build_or_pull "$POSTGRES_SIF" ""  "$APPT_DIR/postgres.def"
build_or_pull "$MEILI_SIF"    ""  "$APPT_DIR/meili.def"
build_or_pull "$MINIO_SIF"    ""  "$APPT_DIR/minio.def"

build_or_pull "$API_SIF"      ""  "$APPT_DIR/api.def"
build_or_pull "$WEB_SIF"      ""  "$APPT_DIR/web.def"

echo
echo "✓ all images ready in $APPT_DIR"
