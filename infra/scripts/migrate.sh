#!/usr/bin/env bash
# Run alembic migrations inside the api instance.
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

if ! instance_running "$INST_API"; then
  echo "✗ $INST_API not running. Start the stack first: ./infra/scripts/start.sh"
  exit 1
fi

# apptainer exec 은 instance 의 start 시점 env 를 상속하지 않는다 (instance 시작 시
# --env 로 전달한 값은 startscript process 에만 살아있고, 후속 exec 의 새 shell 엔
# 없음). 그러므로 alembic 이 필요한 DATABASE_URL 등 핵심 env 를 명시 전달.
# host 네트워크 모드 (MXWP_APPT_HOST_NET=1) 면 host 측 expose port 사용,
# 아니면 컨테이너 간 5432 사용. 우리 start.sh 와 동일 규칙.
if [ "${MXWP_APPT_HOST_NET:-0}" = "1" ]; then
  _DB_HOST="127.0.0.1"
  _DB_PORT="${POSTGRES_PORT:-5532}"
else
  _DB_HOST="127.0.0.1"
  _DB_PORT="${POSTGRES_PORT:-5532}"
fi
_DATABASE_URL="postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${_DB_HOST}:${_DB_PORT}/${POSTGRES_DB}"

"$APPTAINER" exec \
  --env DATABASE_URL="$_DATABASE_URL" \
  --env POSTGRES_USER="${POSTGRES_USER}" \
  --env POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  --env POSTGRES_DB="${POSTGRES_DB}" \
  --env POSTGRES_HOST="${_DB_HOST}" \
  --env POSTGRES_PORT="${_DB_PORT}" \
  instance://"$INST_API" \
  /bin/sh -c "cd /workspace/apps/api && alembic upgrade head"

echo "✓ migrations applied"
