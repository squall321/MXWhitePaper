#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  MX White Paper — Host bootstrap (Ubuntu 24.04 LTS)
#
#  Installs the system-level dependencies that `quickstart.sh` assumes are
#  present:  apptainer, node 20, pnpm 9, python 3.12, git, make.
#
#  Two modes — auto-detected:
#    ONLINE   → fetches packages from upstream repos (apt / NodeSource / npm / pip)
#    OFFLINE  → uses pre-staged packages under `infra/packages/`
#
#  Offline cache layout (see `infra/packages/README.md`):
#    infra/packages/
#      deb/        # *.deb (apt-get install /...)  — apptainer, python, nodejs
#      npm/        # *.tgz (npm install -g)        — pnpm
#      pip/        # *.whl (pip install --user)    — datamodel-code-generator + deps
#      sif/        # optional pre-built .sif       — already handled by build.sh
#
#  Idempotent: re-running checks `--version` for every tool and skips
#  what's already installed.
#
#  Usage:
#    sudo ./scripts/bootstrap-host.sh                 # auto-detect online/offline
#    sudo ./scripts/bootstrap-host.sh --offline       # force offline
#    sudo ./scripts/bootstrap-host.sh --online        # force online
#    sudo ./scripts/bootstrap-host.sh --dry-run       # show what would be done
#    ./scripts/bootstrap-host.sh --help               # usage
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$REPO_ROOT/infra/packages"
DEB_DIR="$PKG_DIR/deb"
NPM_DIR="$PKG_DIR/npm"
PIP_DIR="$PKG_DIR/pip"

# ── Colour helpers ──────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'
  C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_DIM=""
fi
step() { printf "\n${C_BLUE}▶ %s${C_RESET}\n" "$1"; }
ok()   { printf "  ${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn() { printf "  ${C_YELLOW}!${C_RESET} %s\n" "$*"; }
fail() { printf "  ${C_RED}✗${C_RESET} %s\n" "$*"; exit 1; }
note() { printf "  ${C_DIM}%s${C_RESET}\n" "$*"; }

# ── Args ────────────────────────────────────────────────────────────
MODE="auto"
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --online)  MODE="online" ;;
    --offline) MODE="offline" ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,28p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "unknown arg: $arg (use --help)" ;;
  esac
done

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    note "[dry-run] $*"
  else
    "$@"
  fi
}

# ── Sanity ──────────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ] && [ "$DRY_RUN" -ne 1 ]; then
  fail "root required (apt / dpkg / npm -g 모두 sudo 필요). Re-run: sudo $0"
fi

if ! command -v apt-get >/dev/null; then
  fail "apt-get not found — this script targets Ubuntu / Debian only."
fi

# Detect Ubuntu major version. We hard-target 24.04 but stay compatible
# with 22.04 because that's what the dev workstation runs.
. /etc/os-release 2>/dev/null || true
DISTRO_ID="${ID:-unknown}"
DISTRO_VER="${VERSION_ID:-unknown}"
if [ "$DISTRO_ID" != "ubuntu" ]; then
  warn "Detected distro: $DISTRO_ID $DISTRO_VER (script tested on Ubuntu 24.04)"
fi

# ── Online detection ────────────────────────────────────────────────
detect_online() {
  # Try a tiny HEAD request against Ubuntu archive (5 s timeout).
  # If it works we're online; otherwise fall back to offline.
  if curl -sSf --max-time 5 --head https://archive.ubuntu.com/ubuntu/ \
       >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

if [ "$MODE" = "auto" ]; then
  if detect_online; then
    MODE="online"
    note "auto-detected: ONLINE (archive.ubuntu.com reachable)"
  else
    MODE="offline"
    note "auto-detected: OFFLINE (no archive.ubuntu.com)"
  fi
fi

if [ "$MODE" = "offline" ]; then
  [ -d "$DEB_DIR" ] || fail "offline mode but $DEB_DIR not found. Bundle packages first (see infra/packages/README.md)."
fi

# ── Helper: package version test ────────────────────────────────────
have_version() {
  # have_version <command> <minimum-major>
  # Returns 0 if `<command> --version` reports >= <minimum-major>.
  local cmd="$1" min="$2"
  command -v "$cmd" >/dev/null 2>&1 || return 1
  local v
  v="$($cmd --version 2>&1 | head -1)"
  # Extract first integer that looks like a version major.
  local major
  major="$(printf '%s' "$v" | grep -oE '[0-9]+' | head -1)"
  [ -n "$major" ] && [ "$major" -ge "$min" ]
}

# ── Step 1: apt update + base packages ──────────────────────────────
step "Step 1 — Base system packages (git / curl / make / build-essential / python3.12)"

NEED_APT=()
for pkg in git curl make build-essential ca-certificates gnupg lsb-release \
           python3.12 python3.12-venv python3-pip software-properties-common; do
  if ! dpkg -s "$pkg" >/dev/null 2>&1; then
    NEED_APT+=("$pkg")
  fi
done

if [ "${#NEED_APT[@]}" -eq 0 ]; then
  ok "all base packages already installed"
elif [ "$MODE" = "online" ]; then
  ok "installing via apt: ${NEED_APT[*]}"
  run apt-get update -y
  run apt-get install -y --no-install-recommends "${NEED_APT[@]}"
else
  ok "installing from $DEB_DIR (offline)"
  run apt-get install -y --no-install-recommends "$DEB_DIR"/*.deb
  # `apt-get install -f` resolves any leftover transitive deps from the
  # local cache (offline mode assumes the cache is complete).
  run apt-get install -y -f
fi

# ── Step 2: Apptainer ───────────────────────────────────────────────
step "Step 2 — Apptainer (≥ 1.3)"

if have_version apptainer 1; then
  CUR="$(apptainer --version 2>&1 | head -1)"
  ok "already installed: $CUR"
else
  if [ "$MODE" = "online" ]; then
    # Apptainer ships a PPA that supports both 22.04 (jammy) and 24.04
    # (noble). The PPA's add-apt-repository handles the keyring + sources
    # entry in one go. Backed by the maintainer (sylabs/apptainer-admins).
    ok "adding ppa:apptainer/ppa"
    run add-apt-repository -y ppa:apptainer/ppa
    run apt-get update -y
    run apt-get install -y --no-install-recommends apptainer
  else
    # Offline: assume an `apptainer_*.deb` is present in the cache.
    if ls "$DEB_DIR"/apptainer*.deb >/dev/null 2>&1; then
      ok "installing apptainer from $DEB_DIR"
      run dpkg -i "$DEB_DIR"/apptainer*.deb || run apt-get install -y -f
    else
      fail "offline mode but no apptainer*.deb in $DEB_DIR"
    fi
  fi
  ok "$(apptainer --version 2>&1 | head -1)"
fi

# ── Step 3: Node.js 20 (NodeSource) ─────────────────────────────────
step "Step 3 — Node.js 20"

if have_version node 20; then
  ok "already installed: $(node --version)"
else
  if [ "$MODE" = "online" ]; then
    ok "adding NodeSource 20.x repo"
    run bash -c 'curl -fsSL https://deb.nodesource.com/setup_20.x | bash -'
    run apt-get install -y --no-install-recommends nodejs
  else
    if ls "$DEB_DIR"/nodejs*.deb >/dev/null 2>&1; then
      ok "installing nodejs from $DEB_DIR"
      run dpkg -i "$DEB_DIR"/nodejs*.deb || run apt-get install -y -f
    else
      fail "offline mode but no nodejs*.deb in $DEB_DIR"
    fi
  fi
  ok "$(node --version)"
fi

# ── Step 4: pnpm 9 ──────────────────────────────────────────────────
step "Step 4 — pnpm 9"

if have_version pnpm 9; then
  ok "already installed: $(pnpm --version)"
else
  if [ "$MODE" = "online" ]; then
    ok "npm install -g pnpm@9"
    run npm install -g pnpm@9
  else
    if ls "$NPM_DIR"/pnpm-*.tgz >/dev/null 2>&1; then
      ok "installing pnpm from $NPM_DIR (offline tarball)"
      run npm install -g "$NPM_DIR"/pnpm-*.tgz
    else
      fail "offline mode but no pnpm-*.tgz in $NPM_DIR"
    fi
  fi
  ok "$(pnpm --version)"
fi

# ── Step 5: Python deps (datamodel-code-generator) ──────────────────
# Installed under root's home so re-runs see the same binary; the
# subsequent `quickstart.sh` step picks it up via PATH.
step "Step 5 — datamodel-code-generator (python codegen)"

if command -v datamodel-codegen >/dev/null 2>&1; then
  ok "already installed: $(datamodel-codegen --version 2>&1)"
else
  if [ "$MODE" = "online" ]; then
    ok "pip install --break-system-packages datamodel-code-generator"
    # Ubuntu 24.04 enforces PEP-668 (externally-managed env). For a
    # bootstrap script targeting a server context we accept the override;
    # users who want isolation can switch to a venv after install.
    run python3.12 -m pip install --break-system-packages \
      datamodel-code-generator
  else
    if ls "$PIP_DIR"/*.whl >/dev/null 2>&1; then
      ok "installing wheels from $PIP_DIR (offline)"
      run python3.12 -m pip install --break-system-packages \
        --no-index --find-links "$PIP_DIR" datamodel-code-generator
    else
      fail "offline mode but no wheels in $PIP_DIR"
    fi
  fi
fi

# ── Done ────────────────────────────────────────────────────────────
echo
ok "Bootstrap complete (mode: $MODE)"
echo
note "Next step: from a regular user account, run"
note "  cd $REPO_ROOT && ./quickstart.sh"
