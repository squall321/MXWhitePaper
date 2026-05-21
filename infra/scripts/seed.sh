#!/usr/bin/env bash
# Load seed data inside the api instance.
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

if ! instance_running "$INST_API"; then
  echo "✗ $INST_API not running. Start the stack first: ./infra/scripts/start.sh"
  exit 1
fi

# apptainer exec 은 instance start 시점 env 를 상속하지 않음 — 명시 전달.
_DATABASE_URL="postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT:-5532}/${POSTGRES_DB}"

"$APPTAINER" exec \
  --env DATABASE_URL="$_DATABASE_URL" \
  --env POSTGRES_USER="${POSTGRES_USER}" \
  --env POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  --env POSTGRES_DB="${POSTGRES_DB}" \
  --env POSTGRES_HOST="127.0.0.1" \
  --env POSTGRES_PORT="${POSTGRES_PORT:-5532}" \
  instance://"$INST_API" \
  /bin/sh -c "cd /workspace/apps/api && python -m app.scripts.seed"

echo "✓ seed loaded"
