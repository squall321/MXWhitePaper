#!/usr/bin/env bash
# Shared environment for MXWP Apptainer orchestration scripts.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

[ -f .env ] || { echo "✗ .env not found. Run: cp .env.example .env"; exit 1; }
# Export every key in .env (skip blanks/comments)
set -a; . ./.env; set +a

# ── Paths ───────────────────────────────────────────────────────────
APPT_DIR="$REPO_ROOT/infra/apptainer"
DATA_DIR="$REPO_ROOT/infra/data"
LOG_DIR="$REPO_ROOT/infra/logs"
mkdir -p \
  "$DATA_DIR/postgres" "$DATA_DIR/meili" "$DATA_DIR/minio" \
  "$LOG_DIR"

# ── Images (.sif) ───────────────────────────────────────────────────
POSTGRES_SIF="$APPT_DIR/postgres.sif"
MEILI_SIF="$APPT_DIR/meili.sif"
MINIO_SIF="$APPT_DIR/minio.sif"
MC_SIF="$APPT_DIR/mc.sif"
API_SIF="$APPT_DIR/api.sif"
WEB_SIF="$APPT_DIR/web.sif"

# ── Instances ───────────────────────────────────────────────────────
INST_POSTGRES=mxwp_postgres
INST_MEILI=mxwp_meili
INST_MINIO=mxwp_minio
INST_API=mxwp_api
INST_WEB=mxwp_web

# Default ports (override via .env)
: "${POSTGRES_PORT:=5432}"
: "${MEILI_PORT:=7700}"
: "${MINIO_API_PORT:=9000}"
: "${MINIO_CONSOLE_PORT:=9001}"
: "${API_PORT:=8000}"
: "${WEB_PORT:=5173}"

# Apptainer command (allow override for env where it lives elsewhere)
: "${APPTAINER:=apptainer}"

require_apptainer() {
  command -v "$APPTAINER" >/dev/null 2>&1 || {
    echo "✗ '$APPTAINER' not found in PATH"
    exit 1
  }
}

instance_running() {
  "$APPTAINER" instance list --json 2>/dev/null \
    | grep -q "\"instance\": *\"$1\"" || return 1
}

ensure_image_pulled() {
  local sif="$1" url="$2"
  if [ ! -f "$sif" ]; then
    echo "  → pulling $(basename "$sif") from $url"
    "$APPTAINER" pull --force "$sif" "$url"
  fi
}
