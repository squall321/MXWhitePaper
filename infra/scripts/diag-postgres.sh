#!/usr/bin/env bash
# postgres 시작 실패 진단 — target 서버에서 "container cleanup failed:
# no instance found with name mxwp_postgres" 같은 모호한 메시지가 나올 때
# 진짜 원인을 찾아주는 종합 진단 스크립트.
#
# 사용법:
#   cd <MXWhitePaper-on-target>
#   bash infra/scripts/diag-postgres.sh
#
# 이 스크립트는 *쓰기 작업을 하지 않습니다* — 진단만.
# 결과를 통째로 복사해서 보내주세요.

set +e  # 한 단계 fail 해도 다음 진단 계속

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# .env 로드 (있으면)
[ -f .env ] && { set -a; . ./.env; set +a; }

PG_PORT="${POSTGRES_PORT:-5532}"
DATA_DIR="${DATA_DIR:-$REPO_ROOT/infra/data}"
USER_NAME="$(id -un)"

bar() { printf '\n────────── %s ──────────\n' "$1"; }

echo "MXWP postgres diagnostic — $(date '+%Y-%m-%d %H:%M:%S')"
echo "host=$(hostname)  user=$USER_NAME  pwd=$REPO_ROOT"

bar "1. 환경 (apptainer + 사용자)"
apptainer --version 2>&1 || echo "✗ apptainer 명령 없음 (PATH 확인)"
echo
echo "uid/gid:"
id
echo
echo "subuid/subgid (rootless 핵심):"
grep "$USER_NAME" /etc/subuid 2>/dev/null | sed 's/^/  /'
grep "$USER_NAME" /etc/subgid 2>/dev/null | sed 's/^/  /'
[ -z "$(grep "$USER_NAME" /etc/subuid 2>/dev/null)" ] && \
  echo "  ✗ /etc/subuid 에 $USER_NAME 항목 없음 — sudo usermod --add-subuids 100000-165535 $USER_NAME"

bar "2. 데이터 디렉토리 (PGDATA + run)"
for d in "$DATA_DIR/postgres" "$DATA_DIR/postgres/pgdata" "$DATA_DIR/postgres-run"; do
  if [ -e "$d" ]; then
    echo "$d:"
    stat -c '  owner=%U:%G  perm=%a  type=%F' "$d"
    ls -la "$d" 2>&1 | head -5 | sed 's/^/    /'
  else
    echo "$d: ✗ 존재하지 않음"
  fi
  echo
done

bar "3. PGDATA 안 내용 (initdb 됐는가)"
PGDATA_HOST="$DATA_DIR/postgres/pgdata"
if [ -f "$PGDATA_HOST/PG_VERSION" ]; then
  echo "✓ PGDATA initialized (PG_VERSION=$(cat $PGDATA_HOST/PG_VERSION 2>/dev/null))"
  echo "주요 파일:"
  ls "$PGDATA_HOST"/postgresql.conf "$PGDATA_HOST"/postmaster.pid "$PGDATA_HOST"/pg_dynshmem 2>&1 | head -10 | sed 's/^/  /'
  # postmaster.pid 존재하면 stale 가능성
  if [ -f "$PGDATA_HOST/postmaster.pid" ]; then
    PID=$(head -n1 "$PGDATA_HOST/postmaster.pid" 2>/dev/null)
    if [ -n "$PID" ] && ! kill -0 "$PID" 2>/dev/null; then
      echo "  ⚠ postmaster.pid 가 죽은 PID ($PID) 가리킴 → stale lock. rm 권장"
    fi
  fi
else
  echo "PGDATA 비어있음 (docker-entrypoint.sh 가 initdb 로 새로 만들 것)"
  ls -la "$PGDATA_HOST" 2>&1 | head -5
fi

bar "4. 포트 충돌 (POSTGRES_PORT=$PG_PORT)"
if command -v ss >/dev/null 2>&1; then
  ss -tlnp 2>/dev/null | grep -E ":$PG_PORT|:8800|:5173|:7700|:9000" | sed 's/^/  /'
elif command -v netstat >/dev/null 2>&1; then
  netstat -tlnp 2>/dev/null | grep -E ":$PG_PORT|:8800|:5173|:7700|:9000" | sed 's/^/  /'
fi
[ -z "$(ss -tlnp 2>/dev/null | grep ":$PG_PORT") " ] && echo "  (포트 $PG_PORT 비어있음)"

bar "5. apptainer 인스턴스 현재 상태"
apptainer instance list 2>&1 | head -10
echo
echo "mxwp_postgres 인스턴스 로그 (존재하면):"
LOG_BASE="$HOME/.apptainer/instances/logs"
if [ -d "$LOG_BASE" ]; then
  find "$LOG_BASE" -name "mxwp_postgres.*" 2>/dev/null | head -5 | while read f; do
    echo "  $f ($(stat -c '%s' "$f") bytes, 수정 $(stat -c '%y' "$f"))"
  done
  ERR=$(find "$LOG_BASE" -name "mxwp_postgres.err" -type f 2>/dev/null | head -1)
  if [ -n "$ERR" ]; then
    echo
    echo "--- mxwp_postgres.err (마지막 30 줄) ---"
    tail -30 "$ERR" 2>&1 | sed 's/^/  /'
  fi
  OUT=$(find "$LOG_BASE" -name "mxwp_postgres.out" -type f 2>/dev/null | head -1)
  if [ -n "$OUT" ]; then
    echo
    echo "--- mxwp_postgres.out (마지막 20 줄) ---"
    tail -20 "$OUT" 2>&1 | sed 's/^/  /'
  fi
else
  echo "  (apptainer instance log 폴더 $LOG_BASE 없음)"
fi

bar "6. start.sh 가 사용할 SIF 파일"
SIF="$REPO_ROOT/infra/apptainer/postgres.sif"
if [ -f "$SIF" ]; then
  echo "✓ $SIF ($(du -h "$SIF" | cut -f1))"
else
  echo "✗ $SIF 없음 — build.sh 또는 번들 압축 풀기 필요"
fi

bar "7. .env 환경변수 (민감 정보는 마스킹)"
if [ -f .env ]; then
  echo "DATABASE_URL: $(grep -E '^DATABASE_URL=' .env | sed 's/:[^:@]*@/:***@/' | head -1)"
  echo "POSTGRES_USER: $(grep -E '^POSTGRES_USER=' .env)"
  echo "POSTGRES_DB: $(grep -E '^POSTGRES_DB=' .env)"
  echo "POSTGRES_PORT: $(grep -E '^POSTGRES_PORT=' .env)"
  echo "MXWP_APPT_HOST_NET: $(grep -E '^MXWP_APPT_HOST_NET=' .env || echo '(unset)')"
else
  echo "✗ .env 없음 — cp .env.example .env 후 채우기"
fi

bar "8. 실제 postgres 시작 시도 (드라이런 — apptainer raw)"
# start.sh 와 동일한 옵션으로 *실제 시작 시도*. fail 하면 진짜 에러 메시지 노출.
# 이미 떠있으면 skip (안전).
if apptainer instance list 2>/dev/null | grep -q "^mxwp_postgres "; then
  echo "✓ mxwp_postgres 이미 떠있음 — 시작 시도 skip"
else
  # 권한 보정 (가장 흔한 fix — 만약 PGDATA 가 700 이 아니면)
  if [ -d "$PGDATA_HOST" ]; then
    CUR_PERM=$(stat -c '%a' "$PGDATA_HOST" 2>/dev/null)
    if [ "$CUR_PERM" != "700" ]; then
      echo "  ⚠ PGDATA 권한 $CUR_PERM → postgres 가 700 요구. chmod 700 권장"
    fi
  fi

  echo "→ apptainer instance start mxwp_postgres ... 시도"
  apptainer instance start \
    --bind "$DATA_DIR/postgres:/var/lib/postgresql/data" \
    --bind "$DATA_DIR/postgres-run:/var/run/postgresql" \
    --env "POSTGRES_USER=${POSTGRES_USER:-mxwp}" \
    --env "POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-mxwp_local_dev}" \
    --env "POSTGRES_DB=${POSTGRES_DB:-mxwp}" \
    --env "PGPORT=$PG_PORT" \
    --env "PGDATA=/var/lib/postgresql/data/pgdata" \
    --env "LANG=C.UTF-8" --env "LC_ALL=C.UTF-8" \
    "$SIF" mxwp_postgres 2>&1 | head -30 | sed 's/^/  /'
  RC=$?
  echo "  exit code: $RC"

  if [ $RC -eq 0 ]; then
    echo
    echo "→ pg_isready 5초 대기..."
    sleep 5
    apptainer exec instance://mxwp_postgres \
      pg_isready -h 127.0.0.1 -p "$PG_PORT" -U "${POSTGRES_USER:-mxwp}" 2>&1 | sed 's/^/  /'
    echo
    echo "→ 인스턴스 로그 (시작 직후):"
    sleep 1
    OUT_NEW=$(find "$LOG_BASE" -name "mxwp_postgres.out" -type f 2>/dev/null | head -1)
    [ -n "$OUT_NEW" ] && tail -15 "$OUT_NEW" 2>&1 | sed 's/^/  /'
  fi
fi

bar "9. 진단 종료"
echo
echo "위 결과 통째로 복사해서 보내주세요."
echo
echo "흔한 fix 후보 (위 §1~§3 에서 ✗/⚠ 보였다면):"
echo "  - subuid 미설정: sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 \$USER"
echo "  - PGDATA 권한: chmod 700 $DATA_DIR/postgres/pgdata"
echo "  - 폴더 부재: mkdir -p $DATA_DIR/postgres $DATA_DIR/postgres-run"
echo "  - stale lock: rm $DATA_DIR/postgres/pgdata/postmaster.pid"
echo "  - 깨끗하게 다시: bash infra/scripts/recover.sh"
