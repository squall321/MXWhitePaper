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
#
#  Corporate proxy:
#    sudo -E ./scripts/bootstrap-host.sh                          # inherit HTTP(S)_PROXY env
#    sudo ./scripts/bootstrap-host.sh --proxy http://proxy:8080   # explicit URL
#    (script auto-detects "apt already has a proxy configured" → online)
#
#  Fallback proxy:
#    If a curl / npm / pip download fails on the first attempt, the script
#    automatically retries through the proxy in MXWP_FALLBACK_PROXY
#    (default http://169.219.61.252:8080 — Samsung MX network egress).
#    Override or disable:
#      MXWP_FALLBACK_PROXY=http://10.0.0.1:8080 sudo -E ./scripts/bootstrap-host.sh
#      MXWP_FALLBACK_PROXY=  sudo ./scripts/bootstrap-host.sh   # disable
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
PROXY_ARG=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --online)  MODE="online" ;;
    --offline) MODE="offline" ;;
    --dry-run) DRY_RUN=1 ;;
    --proxy)
      [ -n "${2:-}" ] || fail "--proxy requires a URL (e.g. http://proxy.corp:8080)"
      PROXY_ARG="$2"; shift
      ;;
    --proxy=*) PROXY_ARG="${1#--proxy=}" ;;
    -h|--help)
      sed -n '2,28p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *) fail "unknown arg: $1 (use --help)" ;;
  esac
  shift
done

# ── Proxy: accept either env vars (HTTP_PROXY / HTTPS_PROXY) or --proxy.
# `sudo` strips environment by default, so the user needs `sudo -E` OR
# `--proxy http://…`. Detect both and re-export to every downstream call.
PROXY_URL="${PROXY_ARG:-${HTTPS_PROXY:-${HTTP_PROXY:-${https_proxy:-${http_proxy:-}}}}}"
NO_PROXY_VAL="${NO_PROXY:-${no_proxy:-localhost,127.0.0.1,::1}}"

if [ -n "$PROXY_URL" ]; then
  export HTTP_PROXY="$PROXY_URL"
  export HTTPS_PROXY="$PROXY_URL"
  export http_proxy="$PROXY_URL"
  export https_proxy="$PROXY_URL"
  export NO_PROXY="$NO_PROXY_VAL"
  export no_proxy="$NO_PROXY_VAL"
  note "proxy in use: $PROXY_URL  (no_proxy: $NO_PROXY_VAL)"
fi

# Apply the proxy to apt/npm. pip + curl honour HTTPS_PROXY env directly,
# but apt and npm both need explicit config — apt reads
# /etc/apt/apt.conf.d/*, npm reads ~/.npmrc or its own config store.
apt_already_has_proxy() {
  # Look for any "Acquire::http(s)::Proxy" line in apt's config snippets.
  # `apt-config dump` is the most reliable way: it merges every file in
  # /etc/apt/apt.conf.d AND environment overrides.
  apt-config dump 2>/dev/null | grep -qE 'Acquire::https?::Proxy[[:space:]]+"[^"]+"'
}

configure_proxy_for_apt_and_npm() {
  [ -z "$PROXY_URL" ] && return 0
  if apt_already_has_proxy; then
    note "apt proxy already configured system-wide — leaving it as is"
  else
    local apt_conf=/etc/apt/apt.conf.d/99proxy-mxwp-bootstrap
    if [ "$DRY_RUN" -eq 1 ]; then
      note "[dry-run] would write $apt_conf with Acquire::http/https::Proxy"
    else
      cat > "$apt_conf" <<EOF
Acquire::http::Proxy "$PROXY_URL";
Acquire::https::Proxy "$PROXY_URL";
EOF
      ok "apt proxy config → $apt_conf"
    fi
  fi
  # npm — best-effort. Only run if npm is already on PATH (after Step 3
  # it always is). For the initial run we silently skip; the Step 4 pnpm
  # install retries after npm gets installed.
  if command -v npm >/dev/null 2>&1; then
    run npm config set proxy "$PROXY_URL"
    run npm config set https-proxy "$PROXY_URL"
  fi
}
configure_proxy_for_apt_and_npm

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    note "[dry-run] $*"
  else
    "$@"
  fi
}

# ── Fallback proxy for curl downloads ───────────────────────────────
# Some corporate networks expose a single dedicated egress proxy that
# Chrome (via Windows SSO) traverses fine but curl can't reach without
# being told explicitly. When the first curl attempt to fetch a .deb
# or installer script fails, we automatically retry through this fallback.
# Override at runtime with:
#   MXWP_FALLBACK_PROXY=http://10.x.x.x:8080 ./bootstrap-host.sh
# Set to empty to disable the second attempt.
FALLBACK_PROXY="${MXWP_FALLBACK_PROXY:-http://169.219.61.252:8080}"

# curl with two passes: first whatever-the-env-says, then with the
# fallback proxy if available. Bash arg order doesn't matter; positional
# args after `--` become the curl URL + flags carried as-is.
curl_with_proxy_fallback() {
  # Usage: curl_with_proxy_fallback OUTFILE URL [extra curl args...]
  local out="$1" url="$2"; shift 2
  local common=(-fL --retry 10 --retry-delay 5 --retry-all-errors
                --connect-timeout 30 --max-time 600 "$@")
  if curl "${common[@]}" "$url" -o "$out" 2>/tmp/mxwp-curl.err; then
    return 0
  fi
  if [ -n "$FALLBACK_PROXY" ]; then
    warn "first curl attempt failed; retrying via fallback proxy $FALLBACK_PROXY"
    note "$(tail -2 /tmp/mxwp-curl.err 2>/dev/null || true)"
    if curl "${common[@]}" --proxy "$FALLBACK_PROXY" "$url" -o "$out"; then
      ok "downloaded via fallback proxy"
      return 0
    fi
  fi
  return 1
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
  # 1) An apt proxy already configured system-wide is a strong signal we
  #    have a routable path to upstream archives. Trust that over curl
  #    probes — in corporate networks, direct curl to archive.ubuntu.com
  #    often fails even though `apt-get update` works via the proxy.
  if apt_already_has_proxy; then
    return 0
  fi
  # 2) Otherwise probe Ubuntu archive + NodeSource (5 s timeout each).
  #    curl honours HTTP(S)_PROXY env vars exported above.
  if curl -sSf --max-time 5 --head https://archive.ubuntu.com/ubuntu/ \
       >/dev/null 2>&1; then
    return 0
  fi
  if curl -sSf --max-time 5 --head https://deb.nodesource.com/ \
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
    # Strategy: try the official PPA first (slim install + future
    # auto-updates), and fall back to the maintainer's GitHub release
    # .deb if that fails. PPA can fail behind a corporate proxy because
    # `add-apt-repository` shells out to `gpg --keyserver hkps://...`
    # and the launchpad API, neither of which always honour the apt
    # proxy config. The GitHub .deb route only needs https + curl.
    ok "trying ppa:apptainer/ppa first"
    if [ "$DRY_RUN" -eq 1 ]; then
      note "[dry-run] add-apt-repository ppa:apptainer/ppa && apt install apptainer"
    elif add-apt-repository -y ppa:apptainer/ppa 2>/tmp/mxwp-ppa.err \
         && apt-get update -y \
         && apt-get install -y --no-install-recommends apptainer; then
      ok "installed via PPA"
    else
      warn "PPA route failed — likely add-apt-repository couldn't reach launchpad through the proxy."
      note "$(head -3 /tmp/mxwp-ppa.err 2>/dev/null || true)"
      note "falling back to GitHub release .deb"
      local_arch="$(dpkg --print-architecture)"
      # Pin to a version that's known to work on both 22.04 and 24.04.
      # Bump when a newer release is required; the failure mode if the
      # URL 404s is loud and easy to spot.
      apptainer_ver="1.3.6"
      url="https://github.com/apptainer/apptainer/releases/download/v${apptainer_ver}/apptainer_${apptainer_ver}_${local_arch}.deb"
      tmp_deb="$(mktemp --suffix=.deb)"

      # 1) Did the operator pre-stage the .deb? (corporate firewall friendly)
      #    Look in the offline cache dir even when we're in online mode —
      #    most useful when GitHub CDN keeps getting RST by a strict
      #    proxy and the user manually `scp`'d the file in.
      if ls "$DEB_DIR"/apptainer*.deb >/dev/null 2>&1; then
        ok "using pre-staged $DEB_DIR/apptainer*.deb (skipping download)"
        # `apt-get install` on absolute-path .deb files resolves
        # transitive dependencies in one shot (unlike `dpkg -i` which
        # would need a follow-up `apt-get install -f`).
        run apt-get install -y --no-install-recommends "$DEB_DIR"/apptainer*.deb
        rm -f "$tmp_deb"
      else
        ok "downloading $url (with retries — GitHub CDN can RST behind corp proxies)"
        # curl_with_proxy_fallback tries the env/system proxy first, then
        # automatically retries via $FALLBACK_PROXY when the first attempt
        # gets connection-reset by the corporate firewall.
        if ! curl_with_proxy_fallback "$tmp_deb" "$url"; then
          rm -f "$tmp_deb"
          fail "apptainer .deb download failed (both direct and fallback proxy).

  Workaround — download on a machine with internet access, then place
  the .deb here on this server:

    $DEB_DIR/

  and re-run this script. The file is on:

    $url

  Or curl with wget instead:
    wget --tries=10 --retry-connrefused $url -O $DEB_DIR/apptainer.deb"
        fi
        run apt-get install -y --no-install-recommends "$tmp_deb"
        rm -f "$tmp_deb"
      fi
    fi
  else
    # Offline: assume an `apptainer_*.deb` is present in the cache.
    if ls "$DEB_DIR"/apptainer*.deb >/dev/null 2>&1; then
      ok "installing apptainer from $DEB_DIR"
      run apt-get install -y --no-install-recommends "$DEB_DIR"/apptainer*.deb
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
    # Download the installer script via the proxy-aware helper so the
    # same fallback that handled GitHub also handles deb.nodesource.com.
    setup_script="$(mktemp --suffix=.sh)"
    if curl_with_proxy_fallback "$setup_script" "https://deb.nodesource.com/setup_20.x"; then
      run bash "$setup_script"
      rm -f "$setup_script"
      run apt-get install -y --no-install-recommends nodejs
    else
      rm -f "$setup_script"
      fail "NodeSource installer download failed. Pre-stage a nodejs*.deb in $DEB_DIR/ and re-run."
    fi
  else
    if ls "$DEB_DIR"/nodejs*.deb >/dev/null 2>&1; then
      ok "installing nodejs from $DEB_DIR"
      run apt-get install -y --no-install-recommends "$DEB_DIR"/nodejs*.deb
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
    # Try the env-configured proxy first (or no proxy); on failure retry
    # via the fallback proxy if defined.
    if ! run npm install -g pnpm@9; then
      if [ -n "$FALLBACK_PROXY" ]; then
        warn "npm install via current config failed; retrying via $FALLBACK_PROXY"
        run npm config set proxy "$FALLBACK_PROXY"
        run npm config set https-proxy "$FALLBACK_PROXY"
        run npm install -g pnpm@9
      else
        fail "npm install -g pnpm@9 failed and no fallback proxy configured"
      fi
    fi
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
    if ! run python3.12 -m pip install --break-system-packages \
        datamodel-code-generator; then
      if [ -n "$FALLBACK_PROXY" ]; then
        warn "pip install failed; retrying via $FALLBACK_PROXY"
        run python3.12 -m pip install --break-system-packages \
          --proxy "$FALLBACK_PROXY" datamodel-code-generator
      else
        fail "pip install failed and no fallback proxy configured"
      fi
    fi
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
