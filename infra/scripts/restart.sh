#!/usr/bin/env bash
# Stop + start the stack, preserving all data.
# Useful after .env edits or to recover from a wedged container.
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

"$REPO_ROOT/infra/scripts/stop.sh"
echo
"$REPO_ROOT/infra/scripts/start.sh"
echo
"$REPO_ROOT/infra/scripts/status.sh"
