#!/usr/bin/env bash
# Install/uninstall/status helper for the MXWP MCP streamable-http user service.
#
# Why user systemd (not system-level):
#   The MXWP stack runs via apptainer rootless instances owned by the invoking
#   user (mxwp-stack.service is also a --user unit). The MCP HTTP server is
#   hosted *inside* instance://mxwp_api via `apptainer exec`, so it has to run
#   in the same user scope — a system-level unit (root) can't reach the
#   rootless instance.
#
# Usage:
#   ./install-mcp-http.sh --install     # copy unit + inject repo root + enable + start
#   ./install-mcp-http.sh --uninstall   # disable + remove unit file
#   ./install-mcp-http.sh --status      # show service status
#   ./install-mcp-http.sh --help
#
# 3-zone safety: this only installs into THIS host's
# ~/.config/systemd/user/. Other zones (dev/stage/prod) are untouched.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

UNIT_SRC_DIR="$REPO_ROOT/infra/systemd"
USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_NAME="mxwp-mcp-http.service"

usage() {
  cat <<EOF
Install/uninstall the MXWP MCP streamable-http user service.

  --install     Copy $SERVICE_NAME into $USER_UNIT_DIR, inject the repo path
                into the unit, then enable + start the service.
  --uninstall   Stop + disable the service, then delete the unit file.
  --status      Show service status and recent journal lines.
  --help        Show this help.

The unit template lives in this repo at:
  $UNIT_SRC_DIR/$SERVICE_NAME

Resolved repo root (injected into the unit on --install):
  $REPO_ROOT

The server binds (inside instance://mxwp_api) on MXWP_BIND_HOST:MXWP_BIND_PORT
(default 127.0.0.1:8765) and forwards each request's Authorization: Bearer to
MXWP_API_URL (default http://127.0.0.1:8800). Override via the unit's
Environment= lines or a drop-in.

Logs:
  journalctl --user -u mxwp-mcp-http -f
EOF
}

require_systemd_user() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "✗ systemctl not found — systemd is required" >&2
    exit 1
  fi
  # `systemctl --user` needs a running user manager. On headless boxes without
  # lingering enabled this can fail until first login.
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "✗ no systemd --user session detected." >&2
    echo "  Run 'loginctl enable-linger $USER' (with sudo) so the user" >&2
    echo "  manager stays alive across reboots." >&2
    exit 1
  fi
}

do_install() {
  require_systemd_user
  mkdir -p "$USER_UNIT_DIR"

  local src_service="$UNIT_SRC_DIR/$SERVICE_NAME"
  local dst_service="$USER_UNIT_DIR/$SERVICE_NAME"

  if [ ! -f "$src_service" ]; then
    echo "✗ unit template missing at $src_service" >&2
    exit 1
  fi

  # Inject the absolute repo path into the unit template. We do this at install
  # time (rather than committing an absolute path) so the checked-in unit stays
  # portable across machines/zones. Delimiter `|` is unlikely to appear in a path.
  echo "→ installing $SERVICE_NAME"
  sed "s|__REPO_ROOT__|$REPO_ROOT|g" "$src_service" > "$dst_service"
  chmod 0644 "$dst_service"

  echo "→ systemctl --user daemon-reload"
  systemctl --user daemon-reload

  echo "→ enabling + starting $SERVICE_NAME"
  systemctl --user enable --now "$SERVICE_NAME"

  echo
  echo "✓ installed. Status:"
  systemctl --user status "$SERVICE_NAME" --no-pager || true
}

do_uninstall() {
  require_systemd_user

  echo "→ stopping + disabling $SERVICE_NAME"
  systemctl --user disable --now "$SERVICE_NAME" 2>/dev/null || true

  echo "→ removing unit file"
  rm -f "$USER_UNIT_DIR/$SERVICE_NAME"

  echo "→ systemctl --user daemon-reload"
  systemctl --user daemon-reload

  echo "✓ uninstalled."
}

do_status() {
  require_systemd_user

  echo "── service ──"
  systemctl --user status "$SERVICE_NAME" --no-pager || true
  echo
  echo "── recent logs ──"
  journalctl --user -u "$SERVICE_NAME" -n 20 --no-pager || true
}

case "${1:-}" in
  --install)   do_install ;;
  --uninstall) do_uninstall ;;
  --status)    do_status ;;
  -h|--help|"") usage ;;
  *)
    echo "✗ unknown arg: $1" >&2
    usage >&2
    exit 1
    ;;
esac
