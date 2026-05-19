#!/usr/bin/env bash
# Namu_Archive 일괄 import — 319 docx + 320 json 을 MXWhitePaper 서버에 적재.
#
# 사용:
#   bash examples/namu-archive-bulk/import-namu-archive.sh           # dry-run (기본)
#   bash examples/namu-archive-bulk/import-namu-archive.sh --go      # 진짜 업로드 (DB 변경)
#   bash examples/namu-archive-bulk/import-namu-archive.sh --resume  # 이전 실행의 실패 건만 재시도
#
# 필수 환경변수:
#   MXWP_TOKEN  — API 토큰 (admin 또는 editor 권한). export 또는 .env 에서 자동 load.
#
# 선택 환경변수:
#   MXWP_SERVER — API 주소 (기본: http://127.0.0.1:8800)
#   MXWP_OWNER  — 적재 시 owner 이메일 (기본: archive-importer@mx.local)
#
# 동작:
#   1) bulk.yml 의 ${BULK_SOURCE_DIR} 를 본 sh 파일 기준 절대경로로 자동 채움
#   2) dry-run 모드: server 호출 0, 무엇이 어디로 갈지만 출력
#   3) --go 모드: 실제 mxwp-import CLI 호출 → DB 업데이트
#   4) 로그 / 실패 목록: examples/namu-archive-bulk/_logs/ 안에 저장
#
# 안전 가드:
#   - MXWP_TOKEN 없으면 실행 거부
#   - server 가 reachable 한지 미리 확인 (curl healthz)
#   - --go 직전 사용자 확인 prompt (count + 첫 5건 미리보기)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$SCRIPT_DIR/_logs"
mkdir -p "$LOG_DIR"

# ── 색상 (TTY 일 때만) ───────────────────────────────────────────
if [ -t 1 ]; then
  C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'; C_YELLOW=$'\033[1;33m'
  C_RED=$'\033[1;31m'; C_DIM=$'\033[2m'; C_RESET=$'\033[0m'
else
  C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_DIM=""; C_RESET=""
fi
step() { printf "\n${C_BLUE}▶ %s${C_RESET}\n" "$1"; }
ok()   { printf "  ${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn() { printf "  ${C_YELLOW}!${C_RESET} %s\n" "$*"; }
fail() { printf "  ${C_RED}✗${C_RESET} %s\n" "$*"; exit 1; }
note() { printf "  ${C_DIM}%s${C_RESET}\n" "$*"; }

# ── 인자 파싱 ─────────────────────────────────────────────────────
MODE="dry-run"
EXTRA_FLAGS=""
for arg in "$@"; do
  case "$arg" in
    --go)     MODE="go" ;;
    --resume) MODE="resume" ;;
    --help|-h)
      sed -n '2,28p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    *) EXTRA_FLAGS="$EXTRA_FLAGS $arg" ;;
  esac
done

# ── .env 자동 load (repo root) ────────────────────────────────────
if [ -f "$REPO_ROOT/.env" ]; then
  # set -a 로 모든 키 자동 export. MXWP_TOKEN 등이 .env 에 있으면 picked up.
  set -a; . "$REPO_ROOT/.env"; set +a
fi

# ── 환경변수 검증 ────────────────────────────────────────────────
step "Step 1 — 환경 확인"
: "${MXWP_TOKEN:?✗ MXWP_TOKEN 미설정 — export MXWP_TOKEN=... 또는 .env 에 추가}"
: "${MXWP_SERVER:=http://127.0.0.1:8800}"
: "${MXWP_OWNER:=archive-importer@mx.local}"
# 자식 process (mxwp-import) 가 ${VAR} 치환 시 읽어야 하므로 명시적 export
export MXWP_TOKEN MXWP_SERVER MXWP_OWNER
export BULK_SOURCE_DIR="$SCRIPT_DIR"

ok "server  = $MXWP_SERVER"
ok "owner   = $MXWP_OWNER"
ok "source  = $BULK_SOURCE_DIR"
note "token   = ${MXWP_TOKEN:0:8}*** (masked)"

# ── server reachable 확인 ────────────────────────────────────────
step "Step 2 — server reachability"
if curl -fsS --max-time 5 "$MXWP_SERVER/api/v1/healthz" -o /dev/null; then
  ok "$MXWP_SERVER healthz OK"
else
  fail "$MXWP_SERVER healthz 실패 — server 가 떠있는지 확인. boot.sh 또는 recover.sh 먼저"
fi

# ── 파일 카운트 ──────────────────────────────────────────────────
step "Step 3 — source 데이터"
DOCX_COUNT=$(ls "$SCRIPT_DIR"/*.docx 2>/dev/null | wc -l)
JSON_COUNT=$(ls "$SCRIPT_DIR"/*.json 2>/dev/null | wc -l)
ok "docx = $DOCX_COUNT"
ok "json = $JSON_COUNT (매칭 안 되는 json 은 무시)"

if [ "$DOCX_COUNT" -eq 0 ]; then
  fail "*.docx 없음 — examples/namu-archive-bulk/ 가 비어있나? Namu_Archive 에서 다시 복사 필요"
fi

note "예상 소요 시간: ${DOCX_COUNT} × 12s ≈ $((DOCX_COUNT * 12 / 60)) 분 (rate limit 5/min)"

# ── mxwp-import 실행 위치 결정 ───────────────────────────────────
step "Step 4 — mxwp-import 실행 경로"

# 우선순위 1: lite 번들 풀어둔 곳 (target 운영)
LITE_BIN=""
for cand in \
  "$REPO_ROOT/llm-docx-toolkit-lite-linux/bin/mxwp-import-linux" \
  "$REPO_ROOT/dist/llm-docx-toolkit-lite-linux/bin/mxwp-import-linux" \
  "$HOME/llm-docx-toolkit-lite-linux/bin/mxwp-import-linux"; do
  if [ -x "$cand" ]; then
    LITE_BIN="$cand"; break
  fi
done

# 우선순위 2: source 직접 (dev)
SOURCE_DIR="$REPO_ROOT/dist/llm-docx-toolkit"
USE_SOURCE=0
if [ -z "$LITE_BIN" ] && [ -f "$SOURCE_DIR/imp/__main__.py" ]; then
  USE_SOURCE=1
fi

if [ -n "$LITE_BIN" ]; then
  ok "lite binary: $LITE_BIN"
  RUN_CMD=("$LITE_BIN" --config "$SCRIPT_DIR/bulk.yml")
elif [ "$USE_SOURCE" = "1" ]; then
  ok "source 사용: cd $SOURCE_DIR && python3 -m imp"
  RUN_CMD=(python3 -m imp --config "$SCRIPT_DIR/bulk.yml")
  cd "$SOURCE_DIR"
else
  fail "mxwp-import 못 찾음 — Github Release v1.0.4 lite 번들 다운로드 또는 dist/llm-docx-toolkit/imp/ 확인"
fi

# ── 모드별 실행 ──────────────────────────────────────────────────
case "$MODE" in
  dry-run)
    step "Step 5 — dry-run (server 호출 0)"
    note "DB 변경 없음. 무엇이 어디로 갈지만 확인."
    note "실제 실행은: bash $(basename "$0") --go"
    echo
    "${RUN_CMD[@]}" --dry-run $EXTRA_FLAGS 2>&1 | tee "$LOG_DIR/dry-run-$(date +%Y%m%d-%H%M%S).log"
    ;;

  go)
    step "Step 5 — 실제 업로드 (DB 변경)"
    warn "$DOCX_COUNT 건 적재. rate limit 으로 약 $((DOCX_COUNT * 12 / 60)) 분 소요."
    warn "실패한 건 _logs/failed.txt 에 모이고 --resume 으로 재시도 가능."
    echo
    read -r -p "계속하려면 'GO' 입력: " confirm
    if [ "$confirm" != "GO" ]; then
      fail "취소됨 (사용자가 'GO' 입력 안 함)"
    fi
    echo
    LOG="$LOG_DIR/go-$(date +%Y%m%d-%H%M%S).log"
    "${RUN_CMD[@]}" $EXTRA_FLAGS 2>&1 | tee "$LOG"
    echo
    ok "완료. 로그: $LOG"
    if [ -f "$LOG_DIR/failed.txt" ]; then
      warn "실패 건 있음 — $LOG_DIR/failed.txt 확인 후 재시도: bash $(basename "$0") --resume"
    fi

    # ── publish + reindex (검색 가능하게 만들기) ───────────────────
    # mxwp-import 는 doc 을 status=draft 로 넣는다. documents_flat_v 가
    # status='published' 만 보여주므로 검색에 안 잡힘. 임포트한 doc 들을
    # published 로 transition + Meili reindex.
    echo
    step "Step 6 — publish + reindex (검색 가능하게)"
    if command -v psql >/dev/null 2>&1 || apptainer instance list 2>/dev/null | grep -q mxwp_postgres; then
      PG_PW=$(grep "^POSTGRES_PASSWORD=" "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2)
      PG_PORT=$(grep "^POSTGRES_PORT=" "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2)
      PG_PORT=${PG_PORT:-5532}
      PG_USER=$(grep "^POSTGRES_USER=" "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2)
      PG_USER=${PG_USER:-mxwp}
      PG_DB=$(grep "^POSTGRES_DB=" "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2)
      PG_DB=${PG_DB:-mxwp}

      # bulk.yml 의 첫 namu-archive 태그를 통해 임포트한 doc 들만 published 로
      apptainer exec instance://mxwp_postgres bash -lc \
        "PGPASSWORD=$PG_PW LC_ALL=C psql -h 127.0.0.1 -p $PG_PORT -U $PG_USER -d $PG_DB -c \"
UPDATE documents SET status = 'published'
WHERE status = 'draft' AND id IN (
  SELECT dt.document_id FROM document_tags dt
  JOIN tags t ON dt.tag_id = t.id
  WHERE t.name = 'namu-archive'
);
\"" 2>&1 | grep -E "UPDATE [0-9]+" | head -1 && ok "publish 완료" || warn "publish skip"

      # Meili reindex (env 명시)
      apptainer exec instance://mxwp_api /bin/sh -c "
cd /workspace/apps/api && \
DATABASE_URL='postgresql+asyncpg://$PG_USER:$PG_PW@127.0.0.1:$PG_PORT/$PG_DB' \
MEILI_HOST='http://127.0.0.1:7700' \
MEILI_MASTER_KEY='$(grep ^MEILI_MASTER_KEY= "$REPO_ROOT/.env" 2>/dev/null | cut -d= -f2)' \
python3 -m app.scripts.reindex
" 2>&1 | tail -1 | grep -E "reindex complete" && ok "reindex 완료" || warn "reindex skip — 수동: apptainer exec instance://mxwp_api ..."

      ok "검색 가능 상태로 전환됨. 브라우저에서 http://<host>:5173/ 검색 확인"
    else
      warn "psql/postgres 인스턴스 못 찾음 — 수동으로 published 전환 + reindex 필요"
    fi
    ;;

  resume)
    step "Step 5 — resume (실패 건만 재시도)"
    [ -f "$LOG_DIR/failed.txt" ] || fail "$LOG_DIR/failed.txt 없음 — 이전 실행 fail 기록이 없음"
    LOG="$LOG_DIR/resume-$(date +%Y%m%d-%H%M%S).log"
    "${RUN_CMD[@]}" --resume --resume-from "$LOG_DIR/failed.txt" $EXTRA_FLAGS 2>&1 | tee "$LOG"
    ;;
esac
