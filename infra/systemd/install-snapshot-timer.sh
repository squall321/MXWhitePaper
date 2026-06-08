#!/usr/bin/env bash
# Install/uninstall/status helper for the MXWP nightly-snapshot user timer.
#
# Why user systemd (not system-level):
#   The MXWP stack runs via apptainer rootless instances owned by the
#   invoking user (mxwp-stack.service is also a --user unit). A system-
#   level timer would run as root with no access to those rootless
#   instances, so the timer has to live in the same scope.
#
# Usage:
#   ./install-snapshot-timer.sh --install     # copy units + enable + start
#   ./install-snapshot-timer.sh --uninstall   # disable + remove unit files
#   ./install-snapshot-timer.sh --status      # show timer + next fire time
#   ./install-snapshot-timer.sh --help
#
# 3-zone safety: this only installs into THIS host's
# ~/.config/systemd/user/. Other zones (dev/stage/prod) are untouched.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

USER_UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_NAME="mxwp-snapshot.service"
TIMER_NAME="mxwp-snapshot.timer"

usage() {
  cat <<EOF
Install/uninstall the MXWP nightly snapshot user timer.

  --install     Copy mxwp-snapshot.{service,timer} into $USER_UNIT_DIR,
                inject the repo path into ExecStart, then enable + start
                the timer.
  --uninstall   Stop + disable the timer, then delete the unit files.
                Existing snapshot archives are NOT touched.
  --status      Show timer + service status and the next scheduled run.
  --help        Show this help.

The unit files live in this repo at:
  $SCRIPT_DIR/$SERVICE_NAME
  $SCRIPT_DIR/$TIMER_NAME

Resolved repo root (injected into ExecStart on --install):
  $REPO_ROOT

Logs:
  journalctl --user -u mxwp-snapshot -f
EOF
}

require_systemd_user() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "✗ systemctl not found — systemd is required" >&2
    exit 1
  fi
  # `systemctl --user` needs a running user manager. On headless boxes
  # without lingering enabled this can fail until first login.
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

  local src_service="$SCRIPT_DIR/$SERVICE_NAME"
  local src_timer="$SCRIPT_DIR/$TIMER_NAME"
  local dst_service="$USER_UNIT_DIR/$SERVICE_NAME"
  local dst_timer="$USER_UNIT_DIR/$TIMER_NAME"

  if [ ! -f "$src_service" ] || [ ! -f "$src_timer" ]; then
    echo "✗ unit templates missing in $SCRIPT_DIR" >&2
    exit 1
  fi

  # Inject the absolute repo path into the service template. We do this
  # at install time (rather than committing an absolute path) so the
  # checked-in unit file stays portable across machines/zones.
  # Use a delimiter unlikely to appear in a path (`|`).
  echo "→ installing $SERVICE_NAME"
  sed "s|__REPO_ROOT__|$REPO_ROOT|g" "$src_service" > "$dst_service"
  chmod 0644 "$dst_service"

  echo "→ installing $TIMER_NAME"
  cp "$src_timer" "$dst_timer"
  chmod 0644 "$dst_timer"

  echo "→ systemctl --user daemon-reload"
  systemctl --user daemon-reload

  echo "→ enabling + starting $TIMER_NAME"
  systemctl --user enable --now "$TIMER_NAME"

  echo
  echo "✓ installed. Next run:"
  systemctl --user list-timers "$TIMER_NAME" --no-pager || true
}

do_uninstall() {
  require_systemd_user

  echo "→ stopping + disabling $TIMER_NAME"
  systemctl --user disable --now "$TIMER_NAME" 2>/dev/null || true

  # Also stop any in-flight service run.
  systemctl --user stop "$SERVICE_NAME" 2>/dev/null || true

  echo "→ removing unit files"
  rm -f "$USER_UNIT_DIR/$SERVICE_NAME" "$USER_UNIT_DIR/$TIMER_NAME"

  echo "→ systemctl --user daemon-reload"
  systemctl --user daemon-reload

  echo "✓ uninstalled. Existing snapshots in infra/backups/snapshots/ left intact."
}

do_status() {
  require_systemd_user

  echo "── timer ──"
  systemctl --user status "$TIMER_NAME" --no-pager || true
  echo
  echo "── service (last run) ──"
  systemctl --user status "$SERVICE_NAME" --no-pager || true
  echo
  echo "── upcoming ──"
  systemctl --user list-timers "$TIMER_NAME" --no-pager || true
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
