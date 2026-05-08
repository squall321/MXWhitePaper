#!/usr/bin/env bash
# Run alembic migrations inside the api instance.
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

if ! instance_running "$INST_API"; then
  echo "✗ $INST_API not running. Start the stack first: ./infra/scripts/start.sh"
  exit 1
fi

"$APPTAINER" exec instance://"$INST_API" \
  /bin/sh -c "cd /workspace/apps/api && alembic upgrade head"

echo "✓ migrations applied"
