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
# ⚠ _common.sh:3 이 `set -euo pipefail` 이라 바로 위 9행의 의도(-e 없이 끝까지 진단)가
# 뒤집힌다. 실측: F 섹션의 print_env "MXWP_APPT_HOST_NET" 에서 grep 이 못 찾자(rc=1)
# 그 자리에서 종료 — G 섹션(로그 꼬리)은 한 번도 실행된 적이 없고 매번 exit 1 이었다.
# 진단 도구는 개별 실패를 지나 끝까지 가야 의미가 있으므로 여기서 다시 끈다.
# pipefail 도 끈다 — `... | grep -q` 처럼 조기 종료하는 파이프가 SIGPIPE 로 실패 처리된다.
set +e +o pipefail
set -u

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
  # `|| echo "ERR"` 을 붙이면 안 된다 — curl 은 연결 실패에도 -w 로 이미 '000' 을 찍고
  # 종료코드만 0 이 아니다. 폴백이 덧붙어 '000ERR' 이 되어 아래 정규식 어디에도 안 걸린다.
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "$url" 2>/dev/null)
  code="${code:-000}"
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
# web(:5173)은 정적 SPA 서버라 없는 경로도 index.html 을 200 으로 준다(실측: /zzz 도 200).
# 그래서 이 프로브는 API 가 죽어도 늘 통과했다. 상태코드가 아니라 본문으로 가른다.
_proxy_body="$(curl -s -m 3 "http://127.0.0.1:${WEB_PORT}/api/v1/admin/health" 2>/dev/null)"
if printf '%s' "$_proxy_body" | grep -qi '<!doctype html\|<html'; then
  echo -e "  $FAIL web→api proxy  SPA 폴백이 돌아옴(프록시 미동작) — :${WEB_PORT}/api/… 가 API 로 안 간다"
elif [ -z "$_proxy_body" ]; then
  echo -e "  $FAIL web→api proxy  무응답 — :${WEB_PORT} 확인"
else
  echo -e "  $PASS web→api proxy  API 응답 확인 (${_proxy_body:0:40})"
fi
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
