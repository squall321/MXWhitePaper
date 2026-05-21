#!/usr/bin/env bash
# 새 서버의 *호스트* 의존성을 한 번에 설치.
#
# 설치 대상:
#   - node ≥20 + corepack
#   - pnpm@9 (corepack 으로)
#   - rclone (Drive sync 용)
#   - python3 + pip + datamodel-code-generator (schema codegen 용)
#   - 기본 OS 도구 (git, curl, ca-certificates)
#
# 이미 깔린 건 skip. 멱등.
#
# 사용법:
#   sudo ./infra/scripts/install-host-deps.sh           # 전체
#   sudo ./infra/scripts/install-host-deps.sh --skip-rclone
#   ./infra/scripts/install-host-deps.sh --check-only   # 설치 안 하고 확인만
#
# Apptainer 1.3.6 vendor 설치는 quickstart.sh 가 알아서 함 (이 스크립트는 호스트만).
set -euo pipefail

# ── Args ────────────────────────────────────────────────────────────────────
CHECK_ONLY=0
SKIP_RCLONE=0
SKIP_PYTHON=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only) CHECK_ONLY=1; shift ;;
    --skip-rclone) SKIP_RCLONE=1; shift ;;
    --skip-python) SKIP_PYTHON=1; shift ;;
    --help|-h) sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $1"; exit 1 ;;
  esac
done

log()  { printf '\033[1;36m[install]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ⚠\033[0m %s\n' "$*"; }
miss() { printf '\033[1;31m  ✗\033[0m %s\n' "$*"; }

# ── Detect package manager ──────────────────────────────────────────────────
if command -v apt-get >/dev/null 2>&1; then
  PKG="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG="yum"
else
  echo "✗ apt/dnf/yum 모두 없음 — 수동 설치 필요"
  exit 1
fi

# ── 권한 확인 (check-only 가 아니면 sudo 필요) ───────────────────────────────
if [ "$CHECK_ONLY" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "✗ 설치는 sudo 필요. proxy 환경 변수도 같이 전달:"
  echo "    sudo -E $0 $*"
  echo "  또는 명시:"
  echo "    sudo HTTPS_PROXY=http://168.219.61.252:8080 HTTP_PROXY=http://168.219.61.252:8080 $0 $*"
  exit 1
fi

# ── proxy 환경 변수 알림 ────────────────────────────────────────────────────
if [ -n "${HTTPS_PROXY:-}${HTTP_PROXY:-}" ]; then
  log "proxy 감지: HTTPS_PROXY=${HTTPS_PROXY:-} HTTP_PROXY=${HTTP_PROXY:-}"
else
  log "proxy 환경 없음 — 사내망이면 다음으로 다시 시도:"
  log "  sudo -E $0    (caller env 보존)"
  log "  또는 sudo HTTPS_PROXY=http://proxy:8080 $0"
fi

# ── Helpers ─────────────────────────────────────────────────────────────────
need_install() {
  # Returns 0 if package is *missing* (i.e. needs install).
  command -v "$1" >/dev/null 2>&1 && return 1 || return 0
}

apt_install() {
  log "apt-get install: $*"
  apt-get install -y "$@"
}

# ── Step 1: OS 기본 도구 ───────────────────────────────────────────────────
log "step 1/5 — OS 기본 도구"
for cmd in git curl; do
  if need_install "$cmd"; then
    miss "$cmd 미설치"
    [ "$CHECK_ONLY" -eq 0 ] && apt_install "$cmd"
  else
    ok "$cmd: $(command -v "$cmd")"
  fi
done
# ca-certificates 는 library 라 command 가 없음 → dpkg 로 확인
if [ "$PKG" = "apt" ]; then
  if dpkg -s ca-certificates >/dev/null 2>&1; then
    ok "ca-certificates: installed"
  else
    miss "ca-certificates 미설치"
    [ "$CHECK_ONLY" -eq 0 ] && apt_install ca-certificates
  fi
fi
echo

# ── Step 2: Node + corepack ─────────────────────────────────────────────────
log "step 2/5 — Node + corepack"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_VER="$(node --version | sed 's/^v//' | cut -d. -f1)"
  if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
    ok "node $(node --version)"
    NODE_OK=1
  else
    warn "node $(node --version) — v20+ 필요"
  fi
else
  miss "node 미설치"
fi

if [ "$NODE_OK" -eq 0 ]; then
  if [ "$CHECK_ONLY" -eq 0 ]; then
    # NodeSource LTS — proxy 환경 고려해 sudo -E
    if [ "$PKG" = "apt" ]; then
      log "NodeSource LTS 추가 + nodejs 설치"
      curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
      apt_install nodejs
    else
      apt_install nodejs npm
    fi
    ok "node $(node --version)"
  else
    miss "node v20+ 설치 필요"
  fi
fi

# corepack — Node 16.10+ 에 번들. 보통 자동 있음
if command -v corepack >/dev/null 2>&1; then
  ok "corepack 존재"
else
  miss "corepack 미설치 (Node 가 너무 옛 버전?)"
  if [ "$CHECK_ONLY" -eq 0 ]; then
    npm install -g corepack || true
  fi
fi
echo

# ── Step 3: pnpm via corepack (또는 npm fallback) ──────────────────────────
log "step 3/5 — pnpm"

# sudo 로 실행 시, corepack 의 cache 가 root 소유 ~/.cache 에 만들어져서 일반 사용자가
# 못 쓰는 사례를 방지. SUDO_USER 가 있으면 그 user 의 home 의 .cache 를 미리 만들고
# 권한 부여.
if [ "$CHECK_ONLY" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
  _user_home="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
  if [ -n "$_user_home" ]; then
    install -d -m 755 -o "$SUDO_USER" -g "$(id -gn "$SUDO_USER")" \
      "$_user_home/.cache" "$_user_home/.cache/node" "$_user_home/.cache/node/corepack" 2>/dev/null || true
    chown -R "$SUDO_USER:$(id -gn "$SUDO_USER")" "$_user_home/.cache/node" 2>/dev/null || true
    ok "cache dir prepared for $SUDO_USER: $_user_home/.cache/node/corepack"
  fi
fi

if command -v pnpm >/dev/null 2>&1; then
  ok "pnpm: $(pnpm --version 2>/dev/null || echo '?')"
else
  miss "pnpm 미설치"
  if [ "$CHECK_ONLY" -eq 0 ]; then
    # corepack 가 registry 에 도달 못 하면 npm 으로 fallback.
    # 두 방법 다 인터넷/proxy 필요 — 둘 다 실패하면 사용자에게 안내.
    if corepack enable 2>/dev/null && corepack prepare pnpm@9 --activate 2>/dev/null; then
      ok "pnpm: $(pnpm --version 2>/dev/null || echo '?') (via corepack)"
    else
      warn "corepack 실패 — npm 으로 fallback"
      if npm install -g pnpm@9 2>&1 | tail -5; then
        ok "pnpm: $(pnpm --version 2>/dev/null || echo '?') (via npm)"
      else
        miss "pnpm 설치 실패 — 다음 중 하나 시도:"
        echo "    1) proxy 명시:"
        echo "       sudo HTTPS_PROXY=http://proxy:8080 npm install -g pnpm@9"
        echo "    2) 사내 npm 미러 설정:"
        echo "       sudo npm config set registry https://npm.corp.com/"
        echo "    3) 다른 머신에서 pnpm bin 받아 scp"
        exit 1
      fi
    fi
  fi
fi
echo

# ── Step 4: rclone ──────────────────────────────────────────────────────────
log "step 4/5 — rclone"
if [ "$SKIP_RCLONE" -eq 1 ]; then
  ok "rclone — skipped (--skip-rclone)"
else
  if command -v rclone >/dev/null 2>&1; then
    ok "rclone: $(rclone version | head -1 | awk '{print $2}')"
  else
    miss "rclone 미설치"
    if [ "$CHECK_ONLY" -eq 0 ]; then
      apt_install rclone
      ok "rclone: $(rclone version | head -1 | awk '{print $2}')"
    fi
  fi
fi
echo

# ── Step 5: Python + pip + venv + datamodel-code-generator ────────────────
log "step 5/5 — Python + pip + datamodel-code-generator"
if [ "$SKIP_PYTHON" -eq 1 ]; then
  ok "python — skipped (--skip-python)"
else
  # python3
  if command -v python3 >/dev/null 2>&1; then
    ok "python: $(python3 --version)"
  else
    miss "python3 미설치"
    [ "$CHECK_ONLY" -eq 0 ] && apt_install python3
  fi

  # pip — python3 -m pip 가 import 되는지로 판정 (별도 'pip' 명령 없어도 OK).
  if python3 -m pip --version >/dev/null 2>&1; then
    ok "pip: $(python3 -m pip --version | awk '{print $2}')"
  else
    miss "pip 미설치"
    if [ "$CHECK_ONLY" -eq 0 ]; then
      if [ "$PKG" = "apt" ]; then
        apt_install python3-pip
      else
        apt_install python3-pip || apt_install python-pip
      fi
      python3 -m pip --version >/dev/null 2>&1 \
        && ok "pip: $(python3 -m pip --version | awk '{print $2}')" \
        || { miss "pip 설치 후에도 import 안 됨"; exit 1; }
    fi
  fi

  # python3-venv — pip install --user 사용 시 일부 배포판 PEP 668 차단 (externally-managed).
  # venv 가 있어야 그쪽 회피 가능. 설치 안 됐어도 --break-system-packages 로 진행.
  if [ "$CHECK_ONLY" -eq 0 ] && [ "$PKG" = "apt" ]; then
    if ! dpkg -s python3-venv >/dev/null 2>&1; then
      apt_install python3-venv 2>/dev/null || true
    fi
  fi

  # datamodel-code-generator
  if python3 -c "import datamodel_code_generator" 2>/dev/null; then
    DMC_VER="$(python3 -c 'import datamodel_code_generator as m; print(m.__version__)' 2>/dev/null || echo '?')"
    ok "datamodel-code-generator: $DMC_VER"
  elif [ "$CHECK_ONLY" -eq 1 ]; then
    miss "datamodel-code-generator 미설치 (check 모드 — 실제 install 시 자동)"
  else
    miss "datamodel-code-generator 미설치"
    if [ "$CHECK_ONLY" -eq 0 ]; then
      # PEP 668 시스템 (Ubuntu 23.04+, Debian 12+) 에선 --break-system-packages 필요.
      # 안전하게 --user 시도 → 안 되면 break-system-packages.
      if python3 -m pip install --user --quiet 'datamodel-code-generator>=0.26' 2>&1 \
        | grep -vE '^Looking|^Requirement|^Collecting|^Downloading|^Installing|^Successfully'; then
        :
      fi
      if ! python3 -c "import datamodel_code_generator" 2>/dev/null; then
        warn "--user 실패 → --break-system-packages 로 재시도"
        python3 -m pip install --break-system-packages --quiet 'datamodel-code-generator>=0.26' 2>&1 \
          | grep -vE '^Looking|^Requirement|^Collecting|^Downloading|^Installing|^Successfully' || true
      fi
      if python3 -c "import datamodel_code_generator" 2>/dev/null; then
        ok "datamodel-code-generator installed"
      else
        miss "datamodel-code-generator 설치 실패 — 수동 시도:"
        echo "    sudo HTTPS_PROXY=\$HTTPS_PROXY python3 -m pip install --break-system-packages 'datamodel-code-generator>=0.26'"
        exit 1
      fi
    fi
  fi
fi
echo

# ── 결과 요약 ────────────────────────────────────────────────────────────────
log "summary"
declare -A FINAL
FINAL[node]="$(command -v node >/dev/null 2>&1 && echo "✓ $(node --version)" || echo '✗')"
FINAL[pnpm]="$(command -v pnpm >/dev/null 2>&1 && echo "✓ $(pnpm --version)" || echo '✗')"
FINAL[rclone]="$(command -v rclone >/dev/null 2>&1 && echo "✓ $(rclone version 2>/dev/null | head -1 | awk '{print $2}')" || echo '✗')"
FINAL[python3]="$(command -v python3 >/dev/null 2>&1 && echo "✓ $(python3 --version | awk '{print $2}')" || echo '✗')"
FINAL[pip]="$(python3 -m pip --version >/dev/null 2>&1 && echo "✓ $(python3 -m pip --version | awk '{print $2}')" || echo '✗')"
FINAL[git]="$(command -v git >/dev/null 2>&1 && echo "✓ $(git --version | awk '{print $3}')" || echo '✗')"
_dmc_ver="$(python3 -c 'import datamodel_code_generator as m; print(m.__version__)' 2>/dev/null || true)"
FINAL[datamodel-codegen]="$([ -n "$_dmc_ver" ] && echo "✓ $_dmc_ver" || echo '✗')"

for k in git node pnpm python3 pip datamodel-codegen rclone; do
  printf '  %-22s %s\n' "$k" "${FINAL[$k]}"
done

echo
if [ "$CHECK_ONLY" -eq 1 ]; then
  log "check 모드 — 설치는 안 함. 누락 항목 있으면 'sudo $0' 다시"
else
  ok "호스트 의존성 설치 완료"
  echo
  echo "  다음 단계:"
  echo "    cd $(dirname "$(dirname "$(realpath "$0")")")/.."
  echo "    ./quickstart.sh"
fi
