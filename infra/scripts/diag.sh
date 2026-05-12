#!/usr/bin/env bash
# Run a fixed set of checks against a deployed stack and print a
# diagnosis table. Use when something's off but you don't know which
# layer (apptainer / data dir / port / vite proxy / network) is broken.
#
# Usage
#   ./infra/scripts/diag.sh             # report only
#   ./infra/scripts/diag.sh --tail-logs # also tail recent log lines
set -u  # NOTE: not -e — keep running through individual failures
. "$(dirname "$0")/_common.sh"

TAIL_LOGS=0
TAIL_LINES=80
for arg in "$@"; do
  case "$arg" in
    --tail-logs) TAIL_LOGS=1 ;;
    --tail-logs=*) TAIL_LOGS=1; TAIL_LINES="${arg#--tail-logs=}" ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \?//'; exit 0 ;;
  esac
done

PASS="\033[32m✓\033[0m"
FAIL="\033[31m✗\033[0m"
WARN="\033[33m⚠\033[0m"

check() { printf "  %b %-40s " "$1" "$2"; shift 2; "$@"; }
result_ok()   { echo -e "$PASS $*"; }
result_bad()  { echo -e "$FAIL $*"; }
result_warn() { echo -e "$WARN $*"; }

LOG_DIR="$HOME/.apptainer/instances/logs/$(hostname)/$(whoami)"

echo "═══════════════════════════════════════════════════════════════"
echo "  MXWhitePaper — stack diagnostics"
echo "  $(date -Iseconds)"
echo "  repo: $REPO_ROOT"
echo "═══════════════════════════════════════════════════════════════"

# ── A. Tooling ─────────────────────────────────────────────────────
echo
echo "▶ A. Tooling"
if command -v apptainer >/dev/null 2>&1; then
  echo -e "  $PASS apptainer  $(apptainer --version 2>&1 | head -1)"
else
  echo -e "  $FAIL apptainer  not installed — run scripts/bootstrap-host.sh"
fi

# ── B. Instances ───────────────────────────────────────────────────
echo
echo "▶ B. Apptainer instances"
for name in "$INST_POSTGRES" "$INST_MEILI" "$INST_MINIO" "$INST_API" "$INST_WEB"; do
  if instance_running "$name"; then
    echo -e "  $PASS $name"
  else
    echo -e "  $FAIL $name  (not running)"
  fi
done

# ── C. Bound ports ─────────────────────────────────────────────────
echo
echo "▶ C. Host-side port LISTEN"
probe_port() {
  local label="$1" port="$2"
  if command -v ss >/dev/null 2>&1; then
    if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE ":${port}$"; then
      echo -e "  $PASS ${label} listens on :${port}"
      return 0
    fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -tln 2>/dev/null | awk '{print $4}' | grep -qE ":${port}$"; then
      echo -e "  $PASS ${label} listens on :${port}"
      return 0
    fi
  fi
  echo -e "  $FAIL ${label} NOT listening on :${port}"
}
probe_port "postgres" "${POSTGRES_PORT}"
probe_port "meili   " "${MEILI_PORT}"
probe_port "minio   " "${MINIO_API_PORT}"
probe_port "api     " "${API_PORT}"
probe_port "web     " "${WEB_PORT}"

# ── D. HTTP health from host ───────────────────────────────────────
echo
echo "▶ D. HTTP health (from host loopback)"
http_check() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "$url" 2>/dev/null || echo "ERR")
  if [[ "$code" =~ ^[23] ]]; then
    echo -e "  $PASS ${label}  HTTP ${code}  ${url}"
  elif [[ "$code" =~ ^[45] ]]; then
    echo -e "  $WARN ${label}  HTTP ${code}  ${url}  (responds but not 2xx)"
  else
    echo -e "  $FAIL ${label}  ${code}  ${url}"
  fi
}
http_check "api docs    " "http://127.0.0.1:${API_PORT}/docs"
http_check "api health  " "http://127.0.0.1:${API_PORT}/api/v1/admin/health"
http_check "web         " "http://127.0.0.1:${WEB_PORT}/"
http_check "web→api proxy" "http://127.0.0.1:${WEB_PORT}/api/v1/admin/health"
http_check "meili health" "http://127.0.0.1:${MEILI_PORT}/health"
http_check "minio health" "http://127.0.0.1:${MINIO_API_PORT}/minio/health/live"

# ── E. Cross-container reachability (the big one) ──────────────────
echo
echo "▶ E. From inside web container → API (the typical login-hang root cause)"
if instance_running "$INST_WEB"; then
  # node:20-bookworm-slim has no curl/wget. Try node (always present)
  # → falls back to a tiny http.get one-liner.
  inner=$("$APPTAINER" exec instance://"$INST_WEB" /bin/sh -c "
    if command -v curl >/dev/null 2>&1; then
      curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:${API_PORT}/api/v1/admin/health 2>/dev/null
    elif command -v node >/dev/null 2>&1; then
      node -e 'require(\"http\").get(\"http://127.0.0.1:${API_PORT}/api/v1/admin/health\", r => { console.log(r.statusCode); process.exit(0); }).on(\"error\", () => { console.log(\"CONN_REFUSED\"); process.exit(0); }).setTimeout(3000, function(){ console.log(\"TIMEOUT\"); this.destroy(); })'
    elif command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
      \$(command -v python3 || command -v python) -c 'import urllib.request; print(urllib.request.urlopen(\"http://127.0.0.1:${API_PORT}/api/v1/admin/health\", timeout=3).status)' 2>/dev/null || echo CONN_REFUSED
    else
      echo NO_TOOL
    fi
  ")
  if [[ "$inner" =~ ^[23] ]]; then
    echo -e "  $PASS web container can reach host loopback :${API_PORT}  (HTTP ${inner})"
  elif [ "$inner" = "NO_TOOL" ]; then
    echo -e "  $WARN no curl/node/python in container — can't verify (D section is authoritative)"
  else
    echo -e "  $FAIL web container CANNOT reach host loopback :${API_PORT}  ($inner)"
    echo "    → try VITE_PROXY_TARGET=http://<server-public-ip>:${API_PORT} in .env"
    echo "    → or MXWP_APPT_HOST_NET=1 if /etc/apptainer/network has 'host' CNI"
    echo "    → then ./infra/scripts/restart.sh"
  fi
else
  echo "  (web not running — skipping)"
fi

# ── F. .env sanity ─────────────────────────────────────────────────
echo
echo "▶ F. .env critical values"
print_env() {
  local key="$1"
  local val
  val=$(grep -E "^${key}=" "$REPO_ROOT/.env" 2>/dev/null | tail -1 | cut -d= -f2-)
  if [ -n "$val" ]; then
    echo -e "  $PASS ${key}=${val}"
  else
    echo -e "  $WARN ${key}  (not set in .env)"
  fi
}
print_env "API_PORT"
print_env "WEB_PORT"
print_env "CORS_ORIGINS"
print_env "MXWP_APPT_HOST_NET"

# ── G. Recent logs (optional) ──────────────────────────────────────
if [ "$TAIL_LOGS" = 1 ]; then
  echo
  echo "▶ G. Recent log tails (${TAIL_LINES} lines each)"
  echo "    full path of each log shown below — use 'cat' or 'less' for more."
  for name in mxwp_api mxwp_web mxwp_meili mxwp_minio mxwp_postgres; do
    for ext in out err; do
      f="$LOG_DIR/${name}.${ext}"
      if [ -s "$f" ]; then
        echo
        echo "  ── $f  ($(wc -l <"$f") lines total)"
        tail -n "$TAIL_LINES" "$f" | sed 's/^/    /'
      fi
    done
  done
fi

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  Summary"
echo "═══════════════════════════════════════════════════════════════"
echo "  If E shows FAIL → MXWP_APPT_HOST_NET=1 fix"
echo "  If D shows ERR  → service crashed; see G (--tail-logs)"
echo "  If C shows FAIL → service didn't bind; rerun start.sh"
echo "  If B shows FAIL → instance died; fresh.sh to re-init"
