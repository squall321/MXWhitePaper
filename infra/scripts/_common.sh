#!/usr/bin/env bash
# Shared environment for MXWP Apptainer orchestration scripts.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

[ -f .env ] || { echo "✗ .env not found. Run: cp .env.example .env"; exit 1; }
# Export every key in .env (skip blanks/comments)
set -a; . ./.env; set +a

# Task A (2026-06-07) — secret placeholder guard. .env.example 의
# CHANGE_ME_<SERVICE> 가 *그대로 복사된* 채로 stack 이 부팅되면 forgeable
# JWT / weak DB password 같은 audit-grade finding 이라 abort.
#
# matching rule: 값이 `CHANGE_ME_` 로 시작해야 잡힌다. 즉 placeholder
# .env.example 그대로 → trigger. 사용자가 'mxwp_dev_password_change_me'
# 처럼 *suffix* 형태로 marker 를 남긴 회전된 secret → 통과 (false-
# positive 회피).
#
# DATABASE_URL 의 password 부분도 동일 규칙 — URL 안의 `:CHANGE_ME_` 패턴.
#
# 우회: ALLOW_PLACEHOLDER_SECRETS=1 (ephemeral CI 등 throwaway 환경).
if [ "${ALLOW_PLACEHOLDER_SECRETS:-0}" != "1" ]; then
  _placeholder_keys=$(grep -E '^(POSTGRES_PASSWORD|MEILI_MASTER_KEY|MINIO_SECRET_KEY|JWT_SECRET|SMTP_PASSWORD)=CHANGE_ME_' .env | sed -E 's/=.*//' || true)
  # DATABASE_URL 은 `user:password@host` 형태 — password 위치만 검사.
  if grep -qE '^DATABASE_URL=[^/]*//[^:]*:CHANGE_ME_' .env; then
    _placeholder_keys=$(printf '%s\nDATABASE_URL\n' "$_placeholder_keys" | sed '/^$/d')
  fi
  if [ -n "$_placeholder_keys" ]; then
    {
      echo "✗ .env still contains CHANGE_ME_* placeholders for:"
      echo "$_placeholder_keys" | sed 's/^/    /'
      echo "  Rotate each one (e.g. \`openssl rand -base64 24\` per service)"
      echo "  before bringing the stack up. Set ALLOW_PLACEHOLDER_SECRETS=1"
      echo "  ONLY for ephemeral throwaway environments."
    } >&2
    exit 1
  fi
fi

# ── Paths ───────────────────────────────────────────────────────────
APPT_DIR="$REPO_ROOT/infra/apptainer"
DATA_DIR="$REPO_ROOT/infra/data"
LOG_DIR="$REPO_ROOT/infra/logs"
mkdir -p \
  "$DATA_DIR/postgres" "$DATA_DIR/meili" "$DATA_DIR/minio" \
  "$LOG_DIR"

# ── Images (.sif) ───────────────────────────────────────────────────
POSTGRES_SIF="$APPT_DIR/postgres.sif"
MEILI_SIF="$APPT_DIR/meili.sif"
MINIO_SIF="$APPT_DIR/minio.sif"
MC_SIF="$APPT_DIR/mc.sif"
API_SIF="$APPT_DIR/api.sif"
WEB_SIF="$APPT_DIR/web.sif"

# ── Instances ───────────────────────────────────────────────────────
INST_POSTGRES=mxwp_postgres
INST_MEILI=mxwp_meili
INST_MINIO=mxwp_minio
INST_API=mxwp_api
INST_WEB=mxwp_web

# Default ports (override via .env)
: "${POSTGRES_PORT:=5432}"
: "${MEILI_PORT:=7700}"
: "${MINIO_API_PORT:=9000}"
: "${MINIO_CONSOLE_PORT:=9001}"
: "${API_PORT:=8000}"
: "${WEB_PORT:=5173}"

# Apptainer command. Prefer a LOCAL (extracted) apptainer over the system one: the system apptainer
# (e.g. 1.5.0) forces a rootless cgroup manager via a user D-Bus session ("failed to connect to
# dbus / could not detect the OwnerUID") and its root-owned conf can't be relaxed without sudo; an
# extracted apptainer's conf has `systemd cgroups = no`, so instances start with no D-Bus.
# Order: $APPTAINER → MXWhitePaper's own infra/apptainer/bin-* → the HWAX portal's extracted one.
if [ -z "${APPTAINER:-}" ]; then
  for _c in "$APPT_DIR"/bin-*/usr/bin/apptainer \
            "$REPO_ROOT"/../HWAXPortal/infra/apptainer/bin-*/usr/bin/apptainer \
            "$HOME"/Projects/HWAXPortal/infra/apptainer/bin-*/usr/bin/apptainer \
            "$HOME"/claude/HWAXPortal/infra/apptainer/bin-*/usr/bin/apptainer; do
    [ -x "$_c" ] && { APPTAINER="$_c"; break; }
  done
fi
: "${APPTAINER:=apptainer}"
# Ensure systemd cgroups is off in this apptainer's (user-owned) conf — no D-Bus needed.
_aconf="$(dirname "$(dirname "$(dirname "$APPTAINER")")")/etc/apptainer/apptainer.conf"
[ -w "$_aconf" ] && grep -qiE '^systemd cgroups = yes' "$_aconf" 2>/dev/null \
  && sed -i 's/^systemd cgroups = yes/systemd cgroups = no/' "$_aconf" 2>/dev/null || true

# VITE_PROXY_TARGET — auto-fill if missing. start.sh forwards this into
# the web container so vite can reach the API across netns boundaries.
# Missing this env causes login to hang with ERR_EMPTY_RESPONSE (most
# common failure mode on a new server). Default = this host's primary IP.
if [ -z "${VITE_PROXY_TARGET:-}" ]; then
  _HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ -n "$_HOST_IP" ]; then
    export VITE_PROXY_TARGET="http://${_HOST_IP}:${API_PORT}"
    echo "ℹ VITE_PROXY_TARGET not set in .env — auto-filled: $VITE_PROXY_TARGET" >&2
  fi
fi

require_apptainer() {
  command -v "$APPTAINER" >/dev/null 2>&1 || {
    echo "✗ '$APPTAINER' not found in PATH"
    exit 1
  }
}

instance_running() {
  "$APPTAINER" instance list --json 2>/dev/null \
    | grep -q "\"instance\": *\"$1\"" || return 1
}

ensure_image_pulled() {
  local sif="$1" url="$2"
  if [ ! -f "$sif" ]; then
    echo "  → pulling $(basename "$sif") from $url"
    "$APPTAINER" pull --force "$sif" "$url"
  fi
}
