#!/usr/bin/env bash
# One-shot sync: git pull → (image rebuild if needed) → stack up → data merge from Drive.
#
# 새 서버를 *현재 GitHub main + 현재 운영 서버의 DB* 와 한 줄에 동기화.
# 정기 cron 으로 돌려도 됨.
#
# Usage:
#   ./sync-from-drive.sh                 # 기본 — newest 정책
#   ./sync-from-drive.sh --dry-run       # 영향 확인만 (git pull 은 함, DB 는 안 건드림)
#   ./sync-from-drive.sh --skip-git      # git pull 건너뛰기 (DB merge 만)
#   ./sync-from-drive.sh --skip-merge    # DB merge 건너뛰기 (git+rebuild 만)
#   ./sync-from-drive.sh --on-conflict=skip|overwrite|newest
#
# 필수 환경 (.env 에 박혀있어야 함):
#   MXWP_DRIVE_REMOTE     rclone remote+path. 예: ApptainerImages:MXWhitePaper/data-dumps
#
# Exit codes:
#   0  success
#   1  precondition failed (rclone 없음, git repo 아님, etc.)
#   2  git pull failed
#   3  stack start/restart failed
#   4  data-merge failed
set -euo pipefail

# ── Locate self ─────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ── Parse args ──────────────────────────────────────────────────────────────
DRY_RUN=0
SKIP_GIT=0
SKIP_MERGE=0
SKIP_REBUILD=0
ON_CONFLICT="newest"
EXTRA_MERGE_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)        DRY_RUN=1; shift ;;
    --skip-git)       SKIP_GIT=1; shift ;;
    --skip-merge)     SKIP_MERGE=1; shift ;;
    --skip-rebuild)   SKIP_REBUILD=1; shift ;;
    --on-conflict=*)  ON_CONFLICT="${1#*=}"; shift ;;
    --on-conflict)    ON_CONFLICT="${2:-newest}"; shift 2 ;;
    --no-minio)       EXTRA_MERGE_ARGS+=("--no-minio"); shift ;;
    --owner-email=*)  EXTRA_MERGE_ARGS+=("$1"); shift ;;
    --help|-h)
      sed -n '2,18p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "✗ unknown arg: $1"
      exit 1
      ;;
  esac
done

# ── Helpers ─────────────────────────────────────────────────────────────────
log()  { printf '\033[1;36m[sync]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ⚠\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m  ✗\033[0m %s\n' "$*" >&2; }

# ── Precondition checks ─────────────────────────────────────────────────────
[ -d "$REPO_ROOT/.git" ] || { err "$REPO_ROOT is not a git repo"; exit 1; }
[ -f "$REPO_ROOT/.env" ] || { err ".env not found in $REPO_ROOT — copy from .env.example first"; exit 1; }

if [ "$SKIP_MERGE" -eq 0 ]; then
  command -v rclone >/dev/null 2>&1 \
    || { err "rclone not installed (apt-get install rclone)"; exit 1; }
fi

echo "════════════════════════════════════════════════════════"
echo "  MXWhitePaper sync — $(date '+%Y-%m-%d %H:%M:%S')"
echo "════════════════════════════════════════════════════════"
echo "  repo       : $REPO_ROOT"
echo "  git        : $([ "$SKIP_GIT" -eq 1 ] && echo 'skip' || echo 'pull')"
echo "  rebuild    : $([ "$SKIP_REBUILD" -eq 1 ] && echo 'skip' || echo 'auto (when needed)')"
echo "  merge      : $([ "$SKIP_MERGE" -eq 1 ] && echo 'skip' || echo "from Drive, on-conflict=$ON_CONFLICT")"
echo "  dry-run    : $DRY_RUN"
echo

# ── 1) git pull ─────────────────────────────────────────────────────────────
NEEDS_REBUILD=0
NEEDS_RESTART=0
if [ "$SKIP_GIT" -eq 0 ]; then
  log "step 1/4 — git pull"
  PREV_HEAD="$(git rev-parse HEAD)"
  if ! git pull --ff-only 2>&1; then
    err "git pull failed (not fast-forward — manual fix needed)"
    exit 2
  fi
  NEW_HEAD="$(git rev-parse HEAD)"

  if [ "$PREV_HEAD" = "$NEW_HEAD" ]; then
    ok "already up-to-date"
  else
    ok "updated $PREV_HEAD → $NEW_HEAD"
    CHANGED="$(git diff --name-only "$PREV_HEAD" "$NEW_HEAD")"
    echo "$CHANGED" | head -20 | sed 's/^/    · /'
    N=$(echo "$CHANGED" | wc -l)
    [ "$N" -gt 20 ] && echo "    ... and $((N - 20)) more"

    # *.def 또는 quickstart 같은 인프라 변경 → image rebuild 필요
    if echo "$CHANGED" | grep -qE '^infra/apptainer/.*\.def$|^infra/scripts/build\.sh$|^quickstart\.sh$'; then
      NEEDS_REBUILD=1
      warn "infra .def changed — image rebuild needed"
    fi
    # alembic migration → 자동 migrate 필요 (api 재기동 시 우리 startscript 가 처리)
    if echo "$CHANGED" | grep -qE '^apps/api/alembic/versions/'; then
      NEEDS_RESTART=1
      warn "new alembic migration — api restart needed"
    fi
    # FE/BE 코드 변경은 api/web 의 --reload 가 자동 감지 → 별도 동작 없음
  fi
  echo
else
  log "step 1/4 — git pull (skipped)"
  echo
fi

# ── 2) image rebuild + stack up (멱등 — 이미 떠있으면 skip) ───────────────────
log "step 2/4 — stack state"

if [ "$SKIP_REBUILD" -eq 0 ] && [ "$NEEDS_REBUILD" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  warn "rebuilding images..."
  if ! ./infra/scripts/build.sh --force 2>&1 | tail -5; then
    err "image rebuild failed"
    exit 3
  fi
  ok "images rebuilt"
  NEEDS_RESTART=1
fi

if [ "$DRY_RUN" -eq 0 ]; then
  if [ "$NEEDS_RESTART" -eq 1 ]; then
    warn "restarting api instance for migration / new image..."
    APPTAINER="${APPTAINER:-apptainer}"
    set -a; . "$REPO_ROOT/.env"; set +a
    APPTAINER="${APPTAINER:-apptainer}"
    "$APPTAINER" instance stop mxwp_api 2>/dev/null || true
    sleep 2
  fi

  if ! ./infra/scripts/start.sh 2>&1 | tail -3; then
    err "start.sh failed — check apptainer / .env"
    exit 3
  fi

  # api healthz 가 응답할 때까지 잠시 대기 (최대 30초)
  log "waiting for api healthz"
  for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" --max-time 3 \
        http://127.0.0.1:8800/api/v1/healthz 2>/dev/null | grep -q "200"; then
      ok "api healthz OK"
      break
    fi
    sleep 1
    [ "$i" -eq 30 ] && { err "api not ready after 30s"; exit 3; }
  done
else
  ok "stack state — dry-run, skipped"
fi
echo

# ── 3) data merge from Drive ────────────────────────────────────────────────
if [ "$SKIP_MERGE" -eq 0 ]; then
  log "step 3/4 — data merge from Google Drive"

  MERGE_ARGS=("--on-conflict=$ON_CONFLICT")
  [ "$DRY_RUN" -eq 1 ] && MERGE_ARGS+=("--dry-run")
  # 빈 배열일 때 ${arr[@]:-} 는 빈 토큰 1개를 만들어 receiving 측에 unknown arg 오류.
  # 길이 체크 후에만 expand.
  if [ "${#EXTRA_MERGE_ARGS[@]}" -gt 0 ]; then
    MERGE_ARGS+=("${EXTRA_MERGE_ARGS[@]}")
  fi

  if ! ./infra/scripts/data-merge-from-drive.sh "${MERGE_ARGS[@]}"; then
    err "data merge failed"
    exit 4
  fi
  ok "data merge complete"
else
  log "step 3/4 — data merge (skipped)"
fi
echo

# ── 4) Summary ──────────────────────────────────────────────────────────────
log "step 4/4 — done"

if [ "$DRY_RUN" -eq 0 ]; then
  # 빠른 확인 — doc count, indegree 분포
  HERO="$(curl -s --max-time 5 http://127.0.0.1:8800/api/v1/home/hero 2>/dev/null || echo '{}')"
  echo "  도메인별 doc 수:"
  echo "$HERO" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for dom in d.get('data', {}).get('domains', []):
        print(f\"    · {dom['id']:10s} {dom['doc_count']:5d} docs  (top: {', '.join(t['title'] for t in dom.get('top_docs', [])[:2])})\")
except Exception as e:
    print(f'    (could not parse: {e})')
" 2>/dev/null || true
fi

echo
ok "sync complete"
echo "════════════════════════════════════════════════════════"
