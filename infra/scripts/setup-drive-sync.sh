#!/usr/bin/env bash
# 새 서버에서 Google Drive 동기화 환경을 *대화식으로* 1회 설정.
#
# 한 번 통과하면:
#   - rclone 설치 확인 / 설치 안내
#   - rclone.conf 의 remote alias 점검 / 자동 생성
#   - 헤드리스 OAuth flow 안내 (다른 머신의 'rclone authorize' token paste)
#   - 결과 검증 (rclone ls)
#   - .env 에 MXWP_DRIVE_REMOTE 박기
#
# Usage:
#   ./infra/scripts/setup-drive-sync.sh
#   ./infra/scripts/setup-drive-sync.sh --reuse-existing       # 기존 alias 가 있으면 그것 재사용 (대화 0)
#   ./infra/scripts/setup-drive-sync.sh --remote-name=MxwpDrive --path=MXWhitePaper/data-dumps
#
# 끝나면 다음 한 줄로 sync 가능:
#   ./sync-from-drive.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && cd .. && pwd)"
cd "$REPO_ROOT"

# ── Args ────────────────────────────────────────────────────────────────────
REUSE_EXISTING=0
REMOTE_NAME="MxwpDrive"
REMOTE_PATH="MXWhitePaper/data-dumps"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --reuse-existing) REUSE_EXISTING=1; shift ;;
    --remote-name=*)  REMOTE_NAME="${1#*=}"; shift ;;
    --path=*)         REMOTE_PATH="${1#*=}"; shift ;;
    --help|-h) sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $1"; exit 1 ;;
  esac
done

log()  { printf '\033[1;36m[setup]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ⚠\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m  ✗\033[0m %s\n' "$*" >&2; }
prompt() { printf '\033[1;35m  ?\033[0m %s' "$*"; }

# ── 1) rclone 설치 확인 ─────────────────────────────────────────────────────
log "step 1/5 — rclone 설치 확인"
if command -v rclone >/dev/null 2>&1; then
  ok "rclone $(rclone version | head -1 | awk '{print $2}') 이미 설치됨"
else
  err "rclone 이 설치되지 않았습니다"
  echo "    설치 한 줄:"
  echo "      sudo apt-get update && sudo apt-get install -y rclone"
  echo "    또는 공식:"
  echo "      curl -fsSL https://rclone.org/install.sh | sudo bash"
  exit 1
fi
echo

# ── 2) 기존 remote alias 점검 ───────────────────────────────────────────────
log "step 2/5 — 기존 remote alias 점검"
EXISTING="$(rclone listremotes 2>/dev/null | sed 's/:$//' || true)"

if [ -n "$EXISTING" ]; then
  echo "  현재 설정된 remote:"
  echo "$EXISTING" | sed 's/^/    · /'

  if [ "$REUSE_EXISTING" -eq 1 ]; then
    # 첫 번째를 재사용
    REMOTE_NAME="$(echo "$EXISTING" | head -1)"
    ok "재사용 모드 — 첫 remote '$REMOTE_NAME' 사용"
  else
    if echo "$EXISTING" | grep -qx "$REMOTE_NAME"; then
      ok "원하는 alias '$REMOTE_NAME' 이미 존재"
    else
      echo
      prompt "기존 alias 중 하나를 재사용? (그 이름 입력 / 새로 만들려면 Enter): "
      read -r CHOSEN
      if [ -n "$CHOSEN" ]; then
        if echo "$EXISTING" | grep -qx "$CHOSEN"; then
          REMOTE_NAME="$CHOSEN"
          ok "재사용 — '$REMOTE_NAME'"
        else
          err "'$CHOSEN' 은 기존 remote 목록에 없음"
          exit 1
        fi
      fi
    fi
  fi
fi
echo

# ── 3) 새 remote 생성 (필요 시) ─────────────────────────────────────────────
if ! rclone listremotes 2>/dev/null | grep -qx "${REMOTE_NAME}:"; then
  log "step 3/5 — 새 remote '$REMOTE_NAME' 생성 (헤드리스 OAuth)"
  echo
  echo "  Google Drive 인증을 위해 다른 머신(개인 PC) 에서 token 을 받아야 합니다."
  echo "  ──────────────────────────────────────────────────────────────────"
  echo "  ① 개인 PC (브라우저 있는 곳) 의 터미널에서:"
  echo
  echo "      rclone authorize \"drive\""
  echo
  echo "    rclone 없으면: brew install rclone / scoop install rclone / apt install rclone"
  echo
  echo "  ② 브라우저가 자동으로 떠 Google 로그인 → 'rclone 권한 허용'"
  echo
  echo "  ③ PC 터미널에 출력된 JSON token 전체 (중괄호 포함) 복사"
  echo
  echo "    예시 (한 줄로 출력됨):"
  echo "      {\"access_token\":\"ya29...\",\"token_type\":\"Bearer\","
  echo "       \"refresh_token\":\"1//...\",\"expiry\":\"...\"}"
  echo "  ──────────────────────────────────────────────────────────────────"
  echo
  prompt "여기에 그 JSON 한 줄을 paste + Enter: "
  read -r TOKEN

  if [ -z "$TOKEN" ]; then
    err "token 입력이 없음 — 종료"
    exit 1
  fi
  if ! echo "$TOKEN" | grep -q '"access_token"'; then
    err "JSON 형식 아님 (access_token 필드 없음). 복사 잘못된 듯"
    exit 1
  fi

  # rclone.conf 에 직접 작성
  CONF_DIR="${HOME}/.config/rclone"
  mkdir -p "$CONF_DIR"
  chmod 700 "$CONF_DIR"
  CONF_FILE="$CONF_DIR/rclone.conf"

  # 기존 conf 보존
  if [ -f "$CONF_FILE" ]; then
    cp "$CONF_FILE" "${CONF_FILE}.bak-$(date +%s)"
    ok "기존 rclone.conf 백업: ${CONF_FILE}.bak-*"
  fi

  cat >> "$CONF_FILE" <<EOF

[${REMOTE_NAME}]
type = drive
scope = drive
token = ${TOKEN}
team_drive =

EOF
  chmod 600 "$CONF_FILE"
  ok "remote '$REMOTE_NAME' 작성 완료 → $CONF_FILE"
else
  log "step 3/5 — '$REMOTE_NAME' 이미 있어 skip"
fi
echo

# ── 4) 검증 ─────────────────────────────────────────────────────────────────
log "step 4/5 — 검증"
if rclone lsd "${REMOTE_NAME}:" >/dev/null 2>&1; then
  ok "rclone lsd ${REMOTE_NAME}: 정상 응답"
else
  err "rclone lsd ${REMOTE_NAME}: 실패"
  echo "    원인 가능성:"
  echo "      - token 만료 또는 잘못된 paste"
  echo "      - Google Drive API 차단"
  echo "      - 네트워크 / proxy 문제"
  echo "    fix: rclone config 으로 직접 reconnect 또는 token 다시 받기"
  exit 1
fi

# remote path 자동 생성 (없으면)
if ! rclone lsf "${REMOTE_NAME}:${REMOTE_PATH}" >/dev/null 2>&1; then
  warn "path '${REMOTE_PATH}' 이 비어있음 — Drive 에 새 폴더 자동 생성"
  # touch 파일로 폴더 생성 후 삭제
  TMP_TOUCH="$(mktemp)"
  echo "init" > "$TMP_TOUCH"
  rclone copy "$TMP_TOUCH" "${REMOTE_NAME}:${REMOTE_PATH}/" 2>/dev/null || true
  rclone deletefile "${REMOTE_NAME}:${REMOTE_PATH}/$(basename "$TMP_TOUCH")" 2>/dev/null || true
  rm -f "$TMP_TOUCH"
  ok "path 준비됨"
else
  ok "path '${REMOTE_PATH}' 이미 존재"
fi
echo

# ── 5) .env 에 변수 박기 ────────────────────────────────────────────────────
log "step 5/5 — .env 갱신"
ENV_FILE="$REPO_ROOT/.env"
[ -f "$ENV_FILE" ] || { err ".env 없음 — cp .env.example .env 먼저"; exit 1; }

FULL_REMOTE="${REMOTE_NAME}:${REMOTE_PATH}"
if grep -q "^MXWP_DRIVE_REMOTE=" "$ENV_FILE"; then
  # 기존 값 백업하고 덮어쓰기
  OLD="$(grep '^MXWP_DRIVE_REMOTE=' "$ENV_FILE" | head -1)"
  echo "  기존 값: $OLD"
  if [ "$OLD" = "MXWP_DRIVE_REMOTE=$FULL_REMOTE" ]; then
    ok ".env 이미 올바른 값"
  else
    sed -i "s|^MXWP_DRIVE_REMOTE=.*|MXWP_DRIVE_REMOTE=$FULL_REMOTE|" "$ENV_FILE"
    ok "MXWP_DRIVE_REMOTE 갱신 → $FULL_REMOTE"
  fi
else
  cat >> "$ENV_FILE" <<EOF

# Drive sync (added by setup-drive-sync.sh)
MXWP_DRIVE_REMOTE=$FULL_REMOTE
MXWP_DRIVE_RETAIN=5
EOF
  ok "MXWP_DRIVE_REMOTE 추가 → $FULL_REMOTE"
fi
echo

# ── Done ────────────────────────────────────────────────────────────────────
ok "Google Drive sync 환경 준비 완료"
echo
echo "  다음 단계:"
echo "    · 한 번에 동기화: ./sync-from-drive.sh --dry-run  # 영향 확인"
echo "    · 실제 적용:      ./sync-from-drive.sh"
echo "    · cron 정기 동기화:"
echo "        0 4 * * * cd $REPO_ROOT && ./sync-from-drive.sh >> /var/log/mxwp-sync.log 2>&1"
