#!/usr/bin/env bash
# Stop all MXWP Apptainer instances (preserves data volumes).
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

stop_instance() {
  local name="$1"
  if instance_running "$name"; then
    echo "→ stop $name"
    "$APPTAINER" instance stop "$name" || true
  else
    echo "✓ $name not running"
  fi
}

# Reverse order
stop_instance "$INST_WEB"
stop_instance "$INST_API"
stop_instance "$INST_MINIO"
stop_instance "$INST_MEILI"
stop_instance "$INST_POSTGRES"

echo "✓ stack stopped (data volumes preserved in $DATA_DIR)"
