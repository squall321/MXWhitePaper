#!/usr/bin/env bash
# Show running instances + healthchecks.
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

echo "═════ Apptainer instances ═════"
"$APPTAINER" instance list || true

echo
echo "═════ Service healthchecks ═════"

check() {
  local name="$1" url="$2"
  printf "  %-10s " "$name"
  if curl -fsS -m 3 "$url" >/dev/null 2>&1; then
    echo "✓ $url"
  else
    echo "✗ $url unreachable"; ST_FAIL=$((${ST_FAIL:-0}+1))
  fi
}

check api      "http://127.0.0.1:${API_PORT}/api/v1/healthz"
check web      "http://127.0.0.1:${WEB_PORT}"
check meili    "http://127.0.0.1:${MEILI_PORT}/health"
check minio    "http://127.0.0.1:${MINIO_API_PORT}/minio/health/live"

printf "  %-10s " "postgres"
if instance_running "$INST_POSTGRES" \
  && "$APPTAINER" exec instance://"$INST_POSTGRES" pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$POSTGRES_USER" >/dev/null 2>&1; then
  echo "✓ ready"
else
  echo "✗ not ready"; ST_FAIL=$((${ST_FAIL:-0}+1))
fi

# 모든 항목이 ✗ 여도 exit 0 이었다 — 스크립트나 CI 가 종료코드로 판단할 방법이 없었다.
# 사람이 눈으로 보는 출력은 그대로 두고 종료코드만 정직하게 만든다.
if [ "${ST_FAIL:-0}" -gt 0 ]; then
  echo
  echo "  ✗ ${ST_FAIL}건 비정상 — 위 ✗ 항목을 확인하라"
  exit 1
fi
