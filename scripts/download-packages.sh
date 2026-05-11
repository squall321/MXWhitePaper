#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  MX White Paper — Offline package bundler
#
#  Run this on an ONLINE machine to populate `infra/packages/` so a
#  later `./scripts/bootstrap-host.sh --offline` run on an air-gapped
#  Ubuntu 24.04 server has everything it needs locally.
#
#  Output layout (matches what bootstrap-host.sh expects):
#    infra/packages/
#      deb/        # all .deb files (apt-get download)
#      npm/        # pnpm tarball (npm pack)
#      pip/        # python wheels (pip download)
#      sif/        # placeholder — copy your built .sif images here
#                  # (or run `make build` on the offline host once)
#
#  Approx final size: ~700 MB (sif images are the bulk).
#
#  Usage:
#    ./scripts/download-packages.sh                  # download everything
#    ./scripts/download-packages.sh --skip-sif       # skip apptainer images
#    ./scripts/download-packages.sh --help
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$REPO_ROOT/infra/packages"
DEB_DIR="$PKG_DIR/deb"
NPM_DIR="$PKG_DIR/npm"
PIP_DIR="$PKG_DIR/pip"
SIF_DIR="$PKG_DIR/sif"

if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_BLUE=""; C_GREEN=""; C_DIM=""
fi
step() { printf "\n${C_BLUE}▶ %s${C_RESET}\n" "$1"; }
ok()   { printf "  ${C_GREEN}✓${C_RESET} %s\n" "$*"; }
note() { printf "  ${C_DIM}%s${C_RESET}\n" "$*"; }

SKIP_SIF=0
for arg in "$@"; do
  case "$arg" in
    --skip-sif) SKIP_SIF=1 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown arg: $arg"; exit 1 ;;
  esac
done

mkdir -p "$DEB_DIR" "$NPM_DIR" "$PIP_DIR" "$SIF_DIR"

# ── Step 1: .deb files via apt-get download ─────────────────────────
# Note: `apt-get download` only fetches the named packages (no transitive
# deps). We use `apt-rdepends` to walk the closure. apt-rdepends itself
# gets installed first if missing.
step "Step 1 — apt packages (.deb closure into $DEB_DIR)"

if ! command -v apt-rdepends >/dev/null; then
  ok "installing apt-rdepends (one-time)"
  sudo apt-get install -y --no-install-recommends apt-rdepends
fi

# Add Apptainer + NodeSource repos so we can download their .deb too.
if ! apt-cache policy apptainer | grep -q "ppa.launchpad.*apptainer"; then
  ok "adding ppa:apptainer/ppa (one-time)"
  sudo add-apt-repository -y ppa:apptainer/ppa
fi
if ! grep -qr "nodesource" /etc/apt/sources.list.d/ 2>/dev/null; then
  ok "adding NodeSource 20.x repo (one-time)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
fi
sudo apt-get update -y

# Top-level packages we explicitly want. apt-rdepends pulls everything
# they transitively need, then `apt-get download` snapshots them all.
TOPS=(
  apptainer
  nodejs
  python3.12 python3.12-venv python3-pip
  git curl make build-essential ca-certificates gnupg lsb-release
  software-properties-common
)

ok "computing closure for: ${TOPS[*]}"
cd "$DEB_DIR"
# `apt-rdepends -p` outputs the dependency tree; sed strips arrows and
# duplicates. `grep -v '^ '` drops indirect annotations like "(>= 1.0)".
CLOSURE="$(apt-rdepends "${TOPS[@]}" 2>/dev/null \
  | grep -v "^ " \
  | sort -u)"
ok "downloading $(echo "$CLOSURE" | wc -l) packages…"
# `apt-get download` skips packages already on disk (filename match).
echo "$CLOSURE" | xargs apt-get download -y >/dev/null
cd - >/dev/null
ok "$(ls "$DEB_DIR" | wc -l) .deb files in $DEB_DIR"

# ── Step 2: pnpm tarball ────────────────────────────────────────────
step "Step 2 — pnpm tarball into $NPM_DIR"
ok "fetching pnpm@9 tarball"
( cd "$NPM_DIR" && npm pack pnpm@9 >/dev/null )
ok "$(ls "$NPM_DIR")"

# ── Step 3: pip wheels ──────────────────────────────────────────────
step "Step 3 — datamodel-code-generator wheel closure into $PIP_DIR"
ok "downloading wheels (with all deps)"
python3.12 -m pip download --break-system-packages \
  --dest "$PIP_DIR" \
  --no-cache-dir \
  --quiet \
  datamodel-code-generator
ok "$(ls "$PIP_DIR" | wc -l) wheels in $PIP_DIR"

# ── Step 4: Apptainer .sif images (optional) ────────────────────────
if [ "$SKIP_SIF" -eq 0 ]; then
  step "Step 4 — Apptainer .sif images into $SIF_DIR"
  if [ -d "$REPO_ROOT/infra/apptainer" ]; then
    note "copying any existing .sif images from infra/apptainer/"
    # Hardlink if same FS (saves disk on the bundling host); fall back
    # to copy if cross-device.
    cp -al "$REPO_ROOT"/infra/apptainer/*.sif "$SIF_DIR/" 2>/dev/null \
      || cp "$REPO_ROOT"/infra/apptainer/*.sif "$SIF_DIR/" 2>/dev/null \
      || note "no .sif files found yet — run 'make build' first then re-run"
  fi
  ok "$(ls "$SIF_DIR" 2>/dev/null | wc -l) .sif files"
fi

# ── Done ────────────────────────────────────────────────────────────
echo
ok "Offline cache ready at $PKG_DIR"
TOTAL=$(du -sh "$PKG_DIR" 2>/dev/null | cut -f1)
note "total size: $TOTAL"
echo
note "Bundle for transport:"
note "  tar -czf mxwp-offline-bundle.tar.gz infra/packages/"
note ""
note "On the air-gapped server:"
note "  tar -xzf mxwp-offline-bundle.tar.gz -C /path/to/MXWhitePaper"
note "  sudo ./scripts/bootstrap-host.sh --offline"
