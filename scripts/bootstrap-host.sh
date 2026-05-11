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

# Ensure standard system locations are on PATH even under `sudo` with a
# stripped env. Without this, `command -v apptainer` (etc.) can miss a
# binary that's clearly installed at /usr/bin/apptainer, and the script
# bizarrely re-tries to install something already present.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

# ── Cache-lookup helper used by apt-staged .deb installs ─────────────
# find_cached_deb <name-prefix> → echoes the absolute path to the first
# matching .deb (>=1 MB) it finds, or empty string if nothing usable.
# Searches operator-friendly locations + the canonical $DEB_DIR.
# Set MXWP_DEB_DIR to add a custom search root.
find_cached_deb() {
  local prefix="$1"
  local dirs=(
    "$DEB_DIR"
    "$REPO_ROOT/infra/deb"
    "$REPO_ROOT/infra/packages"
    "$REPO_ROOT"
    "${MXWP_DEB_DIR:-}"
  )
  shopt -s nullglob
  local found="" f sz
  for dir in "${dirs[@]}"; do
    [ -n "$dir" ] && [ -d "$dir" ] || continue
    # Match both lowercase and TitleCase filenames.
    for f in "$dir/${prefix}"*.deb "$dir/${prefix^}"*.deb; do
      [ -e "$f" ] || continue
      sz="$(stat -c %s "$f" 2>/dev/null || echo 0)"
      if [ "$sz" -lt 1000000 ]; then
        warn "skipping $f — size ${sz} bytes is too small (incomplete download?)" >&2
        continue
      fi
      found="$f"
      break 2
    done
  done
  shopt -u nullglob
  printf '%s' "$found"
}

# Listing dump used by every "couldn't find anything" error path.
dump_deb_search_paths() {
  local prefix="$1"
  local dirs=(
    "$DEB_DIR"
    "$REPO_ROOT/infra/deb"
    "$REPO_ROOT/infra/packages"
    "$REPO_ROOT"
    "${MXWP_DEB_DIR:-}"
  )
  note "searched (in priority order):"
  for dir in "${dirs[@]}"; do
    [ -n "$dir" ] || continue
    if [ -d "$dir" ]; then
      local matches
      matches="$(ls "$dir/${prefix}"*.deb 2>/dev/null | tr '\n' ' ')"
      note "    $dir/ → ${matches:-(no ${prefix}*.deb)}"
    else
      note "    $dir/ → (directory does not exist)"
    fi
  done
  note "    [tip] set MXWP_DEB_DIR=/path/to/your/dir to add a custom location"
}

# ── Helper: package version test ────────────────────────────────────
have_version() {
  # have_version <command> <minimum-major>
  # Returns 0 if `<command> --version` reports >= <minimum-major>.
  # Tries multiple discovery routes so a stripped sudo env or an unusual
  # install location (e.g. /opt/apptainer/bin) doesn't fool us into
  # thinking the tool is missing.
  local cmd="$1" min="$2"
  local bin=""
  if command -v "$cmd" >/dev/null 2>&1; then
    bin="$(command -v "$cmd")"
  else
    # Common fallbacks — apt-installed .deb lands in /usr/bin, the
    # Apptainer go-build sometimes lands in /usr/local/bin or
    # /opt/apptainer/bin. Pick whichever exists + is executable.
    for cand in "/usr/bin/$cmd" "/usr/local/bin/$cmd" "/opt/$cmd/bin/$cmd"; do
      [ -x "$cand" ] && bin="$cand" && break
    done
  fi
  [ -z "$bin" ] && return 1
  local v
  v="$("$bin" --version 2>&1 | head -1)"
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

# Diagnostic — print whatever the shell can see now, so if detection
# fails the user can compare with what they think is installed.
if [ -x /usr/bin/apptainer ] || command -v apptainer >/dev/null 2>&1; then
  note "apptainer binaries on PATH: $(command -v apptainer 2>/dev/null || echo '(not on PATH)')"
  note "explicit check: $(ls -la /usr/bin/apptainer 2>/dev/null || echo '/usr/bin/apptainer absent')"
fi

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

      # Persistent cache location — downloads go here so re-runs skip
      # the network entirely. The operator can also pre-`scp` a .deb
      # into this directory and the script will pick it up.
      mkdir -p "$DEB_DIR"
      target_deb="$DEB_DIR/apptainer_${apptainer_ver}_${local_arch}.deb"

      # Cache lookup via shared helper — searches every plausible
      # location (infra/packages/deb, infra/deb, infra/packages, repo
      # root, $MXWP_DEB_DIR override).
      note "looking for cached apptainer*.deb …"
      cached_deb="$(find_cached_deb apptainer)"
      [ -n "$cached_deb" ] && ok "found cached .deb: $cached_deb"
      if [ -z "$cached_deb" ]; then
        note "no cached .deb found."
        dump_deb_search_paths apptainer
      fi

      if [ -n "$cached_deb" ]; then
        ok "using cached $cached_deb (skipping download)"
        # `apt-get install` on absolute-path .deb files resolves
        # transitive dependencies in one shot (unlike `dpkg -i` which
        # would need a follow-up `apt-get install -f`).
        run apt-get install -y --no-install-recommends "$cached_deb"
      else
        ok "downloading $url → $target_deb"
        # curl_with_proxy_fallback tries the env/system proxy first, then
        # automatically retries via $FALLBACK_PROXY when the first attempt
        # gets connection-reset by the corporate firewall.
        if ! curl_with_proxy_fallback "$target_deb" "$url"; then
          rm -f "$target_deb"
          fail "apptainer .deb download failed (both direct and fallback proxy).

  Workaround — download on a machine with internet access, then place
  the .deb here on this server:

    $DEB_DIR/

  and re-run this script. The file is on:

    $url

  Or curl with wget instead:
    wget --tries=10 --retry-connrefused $url -O $DEB_DIR/apptainer.deb"
        fi
        ok "saved to $target_deb (cached for future runs)"
        run apt-get install -y --no-install-recommends "$target_deb"
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
  # 1) Cache-first .deb — operator-staged nodejs*.deb wins over the
  #    NodeSource repo download. Saves a curl roundtrip + works behind
  #    a strict proxy.
  cached_node_deb="$(find_cached_deb nodejs)"
  # 2) Cache-first tarball — accept node-v*-linux-x64.tar.{xz,gz} too.
  #    nodejs.org's tarball is the most universally-reachable Node 20
  #    distribution in restricted networks (often allowlisted because
  #    it's the canonical source).
  cached_node_tar=""
  shopt -s nullglob
  for dir in "$DEB_DIR" "$REPO_ROOT/infra/deb" "$REPO_ROOT/infra/packages" "$REPO_ROOT" "${MXWP_DEB_DIR:-}"; do
    [ -n "$dir" ] && [ -d "$dir" ] || continue
    for f in "$dir"/node-v*-linux-x64.tar.xz "$dir"/node-v*-linux-x64.tar.gz; do
      [ -e "$f" ] || continue
      cached_node_tar="$f"
      break 2
    done
  done
  shopt -u nullglob

  if [ -n "$cached_node_deb" ]; then
    ok "found cached .deb: $cached_node_deb (skipping NodeSource setup script)"
    run apt-get install -y --no-install-recommends "$cached_node_deb"
  elif [ -n "$cached_node_tar" ]; then
    ok "found cached tarball: $cached_node_tar"
    note "extracting to /usr/local (--strip-components=1)"
    run tar -xf "$cached_node_tar" -C /usr/local --strip-components=1
  elif [ "$MODE" = "online" ]; then
    note "no cached nodejs*.deb / node-v*.tar.xz found."
    dump_deb_search_paths nodejs
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
      # Tertiary fallback: pull the official nodejs.org tarball, which
      # tends to be reachable when deb.nodesource.com is blocked.
      warn "NodeSource setup script unreachable; trying nodejs.org tarball"
      node_ver="20.18.1"
      tar_url="https://nodejs.org/dist/v${node_ver}/node-v${node_ver}-linux-x64.tar.xz"
      tar_file="$DEB_DIR/node-v${node_ver}-linux-x64.tar.xz"
      mkdir -p "$DEB_DIR"
      if curl_with_proxy_fallback "$tar_file" "$tar_url"; then
        ok "extracting $tar_file to /usr/local"
        run tar -xf "$tar_file" -C /usr/local --strip-components=1
      else
        fail "Node.js install failed. Manual options:

  (a) download node-v20.x-linux-x64.tar.xz from https://nodejs.org/dist/
      and place it in one of the cache locations above, or
  (b) download a NodeSource .deb (Chrome via SSO usually works) from
      a specific file URL such as
        https://deb.nodesource.com/node_20.x/pool/main/n/nodejs/nodejs_20.18.1-1nodesource1_amd64.deb
      (browse the parent dir is blocked, but file URLs work) and
      place it as nodejs_*.deb in one of the cache locations."
      fi
    fi
  else
    fail "offline mode but no nodejs*.deb / node-v*.tar in any cache location (searched above)"
  fi
  ok "$(node --version)"
fi

# ── Step 4: pnpm 9 ──────────────────────────────────────────────────
step "Step 4 — pnpm 9"

if have_version pnpm 9; then
  ok "already installed: $(pnpm --version)"
else
  # 1) Cache-first — operator-staged pnpm-*.tgz wins. The npm CLI
  #    accepts a local tarball as `npm install -g <path.tgz>` so this
  #    skips the registry round-trip entirely.
  cached_pnpm=""
  shopt -s nullglob
  for dir in "$DEB_DIR" "$REPO_ROOT/infra/deb" "$REPO_ROOT/infra/packages" "$REPO_ROOT" "${MXWP_DEB_DIR:-}"; do
    [ -n "$dir" ] && [ -d "$dir" ] || continue
    for f in "$dir"/pnpm-*.tgz; do
      [ -e "$f" ] || continue
      cached_pnpm="$f"
      break 2
    done
  done
  shopt -u nullglob

  if [ -n "$cached_pnpm" ]; then
    ok "found cached tarball: $cached_pnpm"
    run npm install -g "$cached_pnpm"
  elif [ "$MODE" = "online" ]; then
    # Preconfigure npm: tight timeout + proxy + reduced chatter.
    # `--fetch-timeout` controls per-request timeouts but doesn't help
    # when DNS or TCP-SYN itself hangs — wrap the whole call with the
    # `timeout(1)` command for a hard upper bound that always works.
    ok "npm install -g pnpm@9 (90 s hard limit + proxy aware)"
    run npm config set fetch-timeout 30000
    run npm config set fetch-retries 3
    [ -n "$PROXY_URL" ] && run npm config set proxy "$PROXY_URL"
    [ -n "$PROXY_URL" ] && run npm config set https-proxy "$PROXY_URL"
    # Try the env-configured proxy (or no proxy if PROXY_URL is empty)
    # under a 90 s wall-clock cap. timeout 124 = process killed for
    # running too long; the caller treats that as plain failure and
    # moves on to the fallback proxy attempt.
    if ! run timeout --foreground 90 npm install -g --no-audit --no-fund pnpm@9; then
      if [ -n "$FALLBACK_PROXY" ]; then
        warn "first npm install attempt failed/timed-out; retrying via $FALLBACK_PROXY"
        run npm config set proxy "$FALLBACK_PROXY"
        run npm config set https-proxy "$FALLBACK_PROXY"
        if ! run timeout --foreground 90 npm install -g --no-audit --no-fund pnpm@9; then
          fail "npm install -g pnpm@9 failed even via fallback proxy.

  Workaround — download the pnpm tarball on a reachable machine and
  drop it into one of the cache locations searched above:

    curl -fL https://registry.npmjs.org/pnpm/-/pnpm-9.15.0.tgz -o pnpm-9.15.0.tgz
    # then scp to infra/deb/  and re-run this script"
        fi
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
