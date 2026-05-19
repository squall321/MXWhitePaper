#!/usr/bin/env bash
# MXWhitePaper — boot-time service starter.
#
# 호스트 OS reboot 후 5 인스턴스 (postgres / meili / minio / api / web) 자동 시작.
# start.sh 는 멱등 (이미 떠있으면 skip) 이라 안전하게 반복 호출 가능.
#
# 사용법 (둘 중 택일):
#
#   1) systemd --user (정석)
#      $ sudo loginctl enable-linger koopark   # reboot 후에도 user systemd 살아있게
#      ~/.config/systemd/user/mxwp-stack.service 가 본 스크립트를 호출 (infra/systemd/ 참고)
#      $ systemctl --user enable --now mxwp-stack
#
#   2) cron @reboot (간단)
#      $ crontab -e
#      @reboot /home/koopark/claude/MXWhitePaper/infra/scripts/boot.sh >> /home/koopark/claude/MXWhitePaper/infra/logs/boot.log 2>&1
#
#   3) 수동
#      $ bash infra/scripts/boot.sh
#
# 부팅 직후 호스트가 안정화될 시간 확보 (네트워크/마운트). start.sh 직접 호출 시 race 가능.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts/ 의 부모는 infra/, 그 부모가 repo root.
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$REPO_ROOT/infra/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/boot.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" | tee -a "$LOG"; }

log "=== MXWP boot.sh start (pid=$$) ==="

# ── 부팅 직후 안정화 대기 (네트워크, /dev/shm tmpfs 마운트 등) ─────
# systemd basic.target 이 끝나도 일부 마운트는 아직일 수 있어 짧게 대기.
sleep 5
log "(sleep 5s for post-boot stabilisation)"

# ── apptainer 명령 확인 ──────────────────────────────────────────
if ! command -v apptainer >/dev/null 2>&1; then
  log "✗ apptainer command not found in PATH (PATH=$PATH)"
  log "  ↳ user systemd 라면 Environment=PATH=... 를 unit 에 명시해야 함"
  exit 1
fi

# ── 이미 떠있으면 OK (start.sh 가 멱등이지만 빠른 단축) ──────────
RUNNING=$(apptainer instance list 2>/dev/null | awk 'NR>1 && $1 ~ /^mxwp_/' | wc -l)
log "currently running mxwp_* instances: $RUNNING / 5"

# ── start.sh 호출 ────────────────────────────────────────────────
log "running start.sh ..."
if bash "$SCRIPT_DIR/start.sh" >>"$LOG" 2>&1; then
  log "✓ start.sh OK"
else
  rc=$?
  log "✗ start.sh failed (exit=$rc) — see above"
  # 부팅 시점에서는 fail 해도 user 가 직접 보기 어려우니 절대 silent exit 안 함
  exit $rc
fi

# ── healthz 확인 (API 가 진짜 응답하는가) ────────────────────────
sleep 3
HEALTH_URL="http://127.0.0.1:${API_PORT:-8800}/api/v1/healthz"
if curl -fsS -o /dev/null --max-time 10 "$HEALTH_URL"; then
  log "✓ API healthz OK ($HEALTH_URL)"
else
  log "⚠ API healthz not responding yet ($HEALTH_URL) — uvicorn may still be warming up"
fi

log "=== MXWP boot.sh done ==="
