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
log "step 0 — Ubuntu 24+ unprivileged userns 자동 처리"
# Ubuntu 24.04 부터 apparmor 가 *unprivileged user namespace* 를 default 차단해
# apptainer rootless instance 가 "Operation not permitted" 로 실패.
# 우리 스택은 rootless 가 표준이라 그 차단을 풀어야 함.
if [ "$CHECK_ONLY" -eq 0 ] && [ -r /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
  _restrict="$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo '?')"
  if [ "$_restrict" = "1" ]; then
    warn "Ubuntu 24+: apparmor_restrict_unprivileged_userns=1 차단 — 자동 해제"
    sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
    # 영구화
    if [ ! -f /etc/sysctl.d/99-userns.conf ] \
       || ! grep -q 'apparmor_restrict_unprivileged_userns' /etc/sysctl.d/99-userns.conf; then
      echo 'kernel.apparmor_restrict_unprivileged_userns=0' >> /etc/sysctl.d/99-userns.conf
      ok "영구화: /etc/sysctl.d/99-userns.conf"
    fi
  elif [ "$_restrict" = "0" ]; then
    ok "apparmor_restrict_unprivileged_userns 이미 0"
  fi
fi
# 또 하나 — unprivileged_userns_clone (구식 Ubuntu/Debian) 도 확인
if [ "$CHECK_ONLY" -eq 0 ] && [ -r /proc/sys/kernel/unprivileged_userns_clone ]; then
  _clone="$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo '?')"
  if [ "$_clone" = "0" ]; then
    warn "unprivileged_userns_clone=0 — 자동 활성"
    sysctl -w kernel.unprivileged_userns_clone=1
    echo 'kernel.unprivileged_userns_clone=1' >> /etc/sysctl.d/99-userns.conf
  fi
fi
echo

log "step 1/5 — OS 기본 도구"
for cmd in git curl; do
  if need_install "$cmd"; then
    miss "$cmd 미설치"
    [ "$CHECK_ONLY" -eq 0 ] && apt_install "$cmd"
  else
    ok "$cmd: $(command -v "$cmd")"
  fi
done

# apptainer fakeroot 가 의존하는 newuidmap/newgidmap (uidmap 패키지).
# 빠지면 'meili / minio' 같은 추가 instance 가 'newuidmap was not found' 로 실패.
if command -v newuidmap >/dev/null 2>&1 && command -v newgidmap >/dev/null 2>&1; then
  ok "newuidmap/newgidmap (uidmap pkg): $(command -v newuidmap)"
else
  miss "newuidmap/newgidmap 미설치 (apptainer fakeroot 에 필요)"
  if [ "$CHECK_ONLY" -eq 0 ] && [ "$PKG" = "apt" ]; then
    apt_install uidmap
  fi
fi

# apptainer 1.5.x rootless 가 cgroup v2 + systemd user manager + dbus 의존.
# 빠지면 'failed to connect to dbus ... could not detect the OwnerUID' 로
# instance start 실패 (playbook §6.거). 1.3.6 vendored 도 dbus-user-session
# 이 있으면 더 안정.
if [ "$PKG" = "apt" ]; then
  if dpkg -s dbus-user-session >/dev/null 2>&1; then
    ok "dbus-user-session: installed"
  else
    miss "dbus-user-session 미설치 (apptainer rootless dbus 의존성)"
    [ "$CHECK_ONLY" -eq 0 ] && apt_install dbus-user-session
  fi
fi

# squashfuse — apptainer 가 .sif (squashfs 이미지) 를 rootless 로 마운트할 때
# 사용. fakeroot 시나리오 외에도 'mxwp_*' 컨테이너 사용 가능성 있어 함께
# 설치. squashfs-tools 는 mksquashfs (build.sh 가 사용).
if [ "$PKG" = "apt" ]; then
  for pkg in squashfuse squashfs-tools; do
    if dpkg -s "$pkg" >/dev/null 2>&1; then
      ok "$pkg: installed"
    else
      miss "$pkg 미설치"
      [ "$CHECK_ONLY" -eq 0 ] && apt_install "$pkg"
    fi
  done
fi

# /etc/subuid 빈 사용자 → rootless instance 가 'newuidmap: write to uid_map
# failed: Invalid argument' 로 실패. install-host-deps 는 root 로 도는데
# 실제 사용자는 SUDO_USER 라 그 사용자 기준으로 추가.
TARGET_USER="${SUDO_USER:-$USER}"
if [ -n "$TARGET_USER" ] && [ "$TARGET_USER" != "root" ]; then
  if grep -q "^${TARGET_USER}:" /etc/subuid 2>/dev/null \
     && grep -q "^${TARGET_USER}:" /etc/subgid 2>/dev/null; then
    ok "/etc/subuid + /etc/subgid: $TARGET_USER 매핑 존재"
  else
    miss "/etc/subuid 또는 /etc/subgid 에 $TARGET_USER 매핑 없음"
    if [ "$CHECK_ONLY" -eq 0 ]; then
      if command -v usermod >/dev/null 2>&1; then
        usermod --add-subuids 100000-165535 --add-subgids 100000-165535 "$TARGET_USER" \
          && ok "subuid/subgid 100000-165535 추가 → $TARGET_USER"
      else
        warn "usermod 없음 — 수동: sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $TARGET_USER"
      fi
    fi
  fi

  # systemd-logind linger — user systemd 가 로그아웃 후에도 살아있어야
  # cgroup v2 rootless 가 안정. apptainer 1.5.x 가 강하게 의존.
  if command -v loginctl >/dev/null 2>&1; then
    if loginctl show-user "$TARGET_USER" 2>/dev/null | grep -q '^Linger=yes'; then
      ok "linger 활성: $TARGET_USER"
    else
      miss "linger 비활성: $TARGET_USER (logout 시 user systemd 죽음)"
      [ "$CHECK_ONLY" -eq 0 ] && loginctl enable-linger "$TARGET_USER" \
        && ok "enable-linger 적용 → $TARGET_USER"
    fi
  fi
fi
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

# 회사 SSL 가로채기 (MITM) proxy 환경에서 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' 발생.
# .env 의 MXWP_NODE_TLS_VERIFY=0 (default) 이면 NODE_TLS_REJECT_UNAUTHORIZED=0 적용.
# NODE_EXTRA_CA_CERTS 가 .env 에 있으면 그것도 자동 export.
_repo_root="$(cd "$(dirname "$(realpath "$0")")/../.." && pwd)"
_env_file=""
[ -f "$_repo_root/.env" ] && _env_file="$_repo_root/.env"
[ -z "$_env_file" ] && [ -f "$(pwd)/.env" ] && _env_file="$(pwd)/.env"
if [ -n "$_env_file" ]; then
  set -a; . "$_env_file"; set +a
  if [ "${MXWP_NODE_TLS_VERIFY:-0}" = "0" ]; then
    export NODE_TLS_REJECT_UNAUTHORIZED=0
    warn "MXWP_NODE_TLS_VERIFY=0 — NODE_TLS_REJECT_UNAUTHORIZED=0 (MITM proxy 우회)"
    # pip 도 같은 MITM 환경이라 PyPI 호출도 검증 실패. 회사 host 를
    # trusted-host 로 등록 (proxy 자체 + pypi.org 둘 다).
    export PIP_TRUSTED_HOST="pypi.org files.pythonhosted.org pypi.python.org"
  fi
  if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "$NODE_EXTRA_CA_CERTS" ]; then
    export NODE_EXTRA_CA_CERTS
    ok "NODE_EXTRA_CA_CERTS=$NODE_EXTRA_CA_CERTS"
  fi
fi

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

  # datamodel-code-generator — import / CLI / SUDO_USER 환경 3중 체크
  _dmc_user_check() {
    if [ -n "${SUDO_USER:-}" ]; then
      sudo -u "$SUDO_USER" -H python3 -c "import datamodel_code_generator" 2>/dev/null
    else
      python3 -c "import datamodel_code_generator" 2>/dev/null
    fi
  }
  _dmc_user_ver() {
    local v
    if [ -n "${SUDO_USER:-}" ]; then
      v="$(sudo -u "$SUDO_USER" -H python3 -c 'import datamodel_code_generator as m; print(m.__version__)' 2>/dev/null || true)"
      [ -z "$v" ] && v="$(sudo -u "$SUDO_USER" -H bash -lc 'command -v datamodel-codegen >/dev/null && datamodel-codegen --version' 2>/dev/null | head -1 || true)"
    else
      v="$(python3 -c 'import datamodel_code_generator as m; print(m.__version__)' 2>/dev/null || true)"
      [ -z "$v" ] && v="$(command -v datamodel-codegen >/dev/null 2>&1 && datamodel-codegen --version 2>/dev/null | head -1 || true)"
    fi
    echo "${v:-?}"
  }
  if _dmc_user_check || command -v datamodel-codegen >/dev/null 2>&1; then
    DMC_VER="$(_dmc_user_ver)"
    ok "datamodel-code-generator: $DMC_VER"
  elif [ "$CHECK_ONLY" -eq 1 ]; then
    miss "datamodel-code-generator 미설치 (check 모드 — 실제 install 시 자동)"
  else
    miss "datamodel-code-generator 미설치"
    if [ "$CHECK_ONLY" -eq 0 ]; then
      # 우선순위 (가장 안전한 격리 → 위험):
      #   1) pipx (격리 venv, PEP 668 안전)
      #   2) python3 -m venv ~/.venvs/mxwp-tools (수동 venv)
      #   3) --user (구식 시스템)
      #   4) --break-system-packages (마지막 수단)
      _installed=0

      # SUDO_USER 가 있으면 그 user 환경에 설치 (root home 에 설치되면 다음 단계 못 찾음)
      _run_as_user() {
        if [ -n "${SUDO_USER:-}" ]; then
          sudo -u "$SUDO_USER" -H "$@"
        else
          "$@"
        fi
      }

      # 1) pipx
      if ! command -v pipx >/dev/null 2>&1; then
        apt_install pipx 2>/dev/null || true
      fi
      if command -v pipx >/dev/null 2>&1; then
        log "pipx 로 설치 시도"
        if _run_as_user pipx install 'datamodel-code-generator>=0.26' 2>&1 | tail -5; then
          _run_as_user pipx ensurepath 2>/dev/null || true
          _installed=1
          ok "datamodel-code-generator (via pipx)"
          # 현재 shell 에도 즉시 적용 + 안내 (sudo 안에선 정작 user shell 에 반영
          # 안 되므로 한 줄 사용자 안내).
          export PATH="${SUDO_USER:+/home/$SUDO_USER}/.local/bin:$PATH"
          [ -z "${SUDO_USER:-}" ] && export PATH="$HOME/.local/bin:$PATH"
          warn "이 shell 의 PATH 에 ~/.local/bin 추가됨. 새 shell 에선:"
          echo "    source ~/.bashrc   (또는 새 터미널)"
        fi
      fi

      # 2) venv fallback
      if [ "$_installed" -eq 0 ]; then
        log "pipx 실패 — venv 로 fallback"
        _venv_dir="${SUDO_USER:+/home/$SUDO_USER}/.venvs/mxwp-tools"
        [ -z "${SUDO_USER:-}" ] && _venv_dir="$HOME/.venvs/mxwp-tools"
        if _run_as_user python3 -m venv "$_venv_dir" 2>/dev/null; then
          if _run_as_user "$_venv_dir/bin/pip" install --quiet 'datamodel-code-generator>=0.26' 2>&1 | tail -3; then
            _installed=1
            ok "datamodel-code-generator (venv: $_venv_dir)"
            warn "PATH 추가 필요 — ~/.bashrc 에 다음 한 줄:"
            echo "    export PATH=\"$_venv_dir/bin:\$PATH\""
          fi
        fi
      fi

      # 3) --user fallback (오래된 시스템)
      if [ "$_installed" -eq 0 ]; then
        log "venv 실패 — pip --user 로 fallback"
        _run_as_user python3 -m pip install --user --quiet 'datamodel-code-generator>=0.26' 2>&1 \
          | grep -vE '^Looking|^Requirement|^Collecting|^Downloading|^Installing|^Successfully' || true
        if _run_as_user python3 -c "import datamodel_code_generator" 2>/dev/null; then
          _installed=1
          ok "datamodel-code-generator (pip --user)"
        fi
      fi

      # 4) --break-system-packages (가장 위험, 마지막 수단)
      if [ "$_installed" -eq 0 ]; then
        warn "--user 실패 → --break-system-packages 로 재시도"
        python3 -m pip install --break-system-packages --quiet 'datamodel-code-generator>=0.26' 2>&1 \
          | grep -vE '^Looking|^Requirement|^Collecting|^Downloading|^Installing|^Successfully' || true
        if python3 -c "import datamodel_code_generator" 2>/dev/null; then
          _installed=1
          ok "datamodel-code-generator (--break-system-packages)"
        fi
      fi

      if [ "$_installed" -eq 0 ]; then
        miss "datamodel-code-generator 설치 실패 — 수동 시도:"
        echo "    sudo apt-get install -y pipx"
        echo "    pipx install 'datamodel-code-generator>=0.26'"
        echo "    pipx ensurepath"
        exit 1
      fi
    fi
  fi
fi
echo

# ── Step 6: LLM provider (GPU 있으면 ollama 자동 셋업) ──────────────────────
# triple 추출용 로컬 LLM. GPU 가 있으면 ollama 설치 + 모델 pull, 없으면 mock.
# setup-llm.sh 가 자체적으로 GPU 감지 + .env 갱신을 한다.
if [ "$CHECK_ONLY" -eq 0 ]; then
  log "Step 6 — LLM provider 셋업 (GPU 자동 감지)"
  _SETUP_LLM="$(dirname "$(realpath "$0")")/setup-llm.sh"
  if [ -x "$_SETUP_LLM" ]; then
    # setup-llm 실패해도 (ollama pull 실패 등) 전체 설치를 막지 않음 —
    # setup-llm 이 그 경우 .env 를 mock 으로 폴백시킨다.
    "$_SETUP_LLM" || warn "LLM 셋업 비정상 종료 — triple 추출은 mock 으로 동작"
  else
    warn "setup-llm.sh 없음/실행불가 — LLM 셋업 건너뜀"
  fi
  echo
fi

# ── 결과 요약 ────────────────────────────────────────────────────────────────
log "summary"
declare -A FINAL
FINAL[node]="$(command -v node >/dev/null 2>&1 && echo "✓ $(node --version)" || echo '✗')"
FINAL[pnpm]="$(command -v pnpm >/dev/null 2>&1 && echo "✓ $(pnpm --version)" || echo '✗')"
FINAL[rclone]="$(command -v rclone >/dev/null 2>&1 && echo "✓ $(rclone version 2>/dev/null | head -1 | awk '{print $2}')" || echo '✗')"
FINAL[python3]="$(command -v python3 >/dev/null 2>&1 && echo "✓ $(python3 --version | awk '{print $2}')" || echo '✗')"
FINAL[pip]="$(python3 -m pip --version >/dev/null 2>&1 && echo "✓ $(python3 -m pip --version | awk '{print $2}')" || echo '✗')"
FINAL[git]="$(command -v git >/dev/null 2>&1 && echo "✓ $(git --version | awk '{print $3}')" || echo '✗')"
# datamodel-codegen 의 version 표시: 3 단계 fallback (직접 import, CLI binary, file path)
_dmc_ver="$(python3 -c 'import datamodel_code_generator as m; print(m.__version__)' 2>/dev/null || true)"
if [ -z "$_dmc_ver" ] && command -v datamodel-codegen >/dev/null 2>&1; then
  _dmc_ver="$(datamodel-codegen --version 2>/dev/null | head -1 || true)"
fi
if [ -z "$_dmc_ver" ]; then
  # pipx venv 안 / SUDO_USER 환경 — root 가 아닌 user 의 환경에서 다시 시도
  if [ -n "${SUDO_USER:-}" ]; then
    _dmc_ver="$(sudo -u "$SUDO_USER" -H python3 -c 'import datamodel_code_generator as m; print(m.__version__)' 2>/dev/null || true)"
    [ -z "$_dmc_ver" ] && _dmc_ver="$(sudo -u "$SUDO_USER" -H bash -lc 'command -v datamodel-codegen >/dev/null && datamodel-codegen --version' 2>/dev/null | head -1 || true)"
  fi
fi
FINAL[datamodel-codegen]="$([ -n "$_dmc_ver" ] && echo "✓ $_dmc_ver" || echo '✗ (모듈 미확인 — pipx ensurepath; source ~/.bashrc 시도)')"
# ollama 는 GPU 있을 때만 — 없으면 '— (GPU 없음, mock)' 으로 표시.
if command -v ollama >/dev/null 2>&1; then
  FINAL[ollama]="✓ $(ollama --version 2>/dev/null | head -1 | awk '{print $NF}')"
else
  FINAL[ollama]="— (GPU 없음 → triple 추출 mock)"
fi

for k in git node pnpm python3 pip datamodel-codegen rclone ollama; do
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
