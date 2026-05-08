#!/usr/bin/env bash
# Load seed data inside the api instance.
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

if ! instance_running "$INST_API"; then
  echo "✗ $INST_API not running. Start the stack first: ./infra/scripts/start.sh"
  exit 1
fi

"$APPTAINER" exec instance://"$INST_API" \
  /bin/sh -c "cd /workspace/apps/api && python -m app.scripts.seed"

echo "✓ seed loaded"
