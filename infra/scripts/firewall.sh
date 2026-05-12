#!/usr/bin/env bash
# Open the MXWP service ports on ufw so external clients can reach them.
#
# By default this only allows the PRIVATE network ranges (10.0.0.0/8,
# 172.16.0.0/12, 192.168.0.0/16) — safer than 'allow from anywhere'.
# Pass --anywhere to open to the internet (NOT recommended for prod).
#
# Idempotent — re-running just refreshes the rules.
# Needs sudo (only ufw operations require it).
#
# Usage:
#   sudo ./infra/scripts/firewall.sh                  # internal LAN only
#   sudo ./infra/scripts/firewall.sh --anywhere       # public internet
#   sudo ./infra/scripts/firewall.sh --remove         # delete the rules
#   sudo ./infra/scripts/firewall.sh --status         # show current rules
#   sudo ./infra/scripts/firewall.sh --with-console   # also open minio:9001 / meili:7700
set -uo pipefail
. "$(dirname "$0")/_common.sh"

# Need root for ufw
if [ "$EUID" -ne 0 ]; then
  echo "✗ this script needs sudo (it's the only one that does)" >&2
  echo "  → sudo $0 $*" >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  echo "✗ ufw not installed"
  echo "  → sudo apt-get install -y ufw"
  exit 1
fi

ANYWHERE=0
REMOVE=0
STATUS_ONLY=0
WITH_CONSOLE=0
for arg in "$@"; do
  case "$arg" in
    --anywhere)     ANYWHERE=1 ;;
    --remove)       REMOVE=1 ;;
    --status)       STATUS_ONLY=1 ;;
    --with-console) WITH_CONSOLE=1 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "✗ unknown arg: $arg"; exit 1 ;;
  esac
done

# Ports always opened
PORTS_RUNTIME=(5173 8800)
# Ports only when --with-console
PORTS_CONSOLE=(9001 7700)

PORTS=("${PORTS_RUNTIME[@]}")
[ "$WITH_CONSOLE" = 1 ] && PORTS+=("${PORTS_CONSOLE[@]}")

# Private network ranges we want to accept from
PRIVATE_NETS=(10.0.0.0/8 172.16.0.0/12 192.168.0.0/16)

echo "═══════════════════════════════════════════════════════════════"
echo "  MXWP firewall (ufw)"
[ "$ANYWHERE" = 1 ] && echo "  scope     : ANYWHERE (⚠ public internet exposure)"
[ "$ANYWHERE" = 0 ] && echo "  scope     : private LAN only (${PRIVATE_NETS[*]})"
echo "  ports     : ${PORTS[*]}"
[ "$REMOVE" = 1 ] && echo "  mode      : REMOVE rules"
echo "═══════════════════════════════════════════════════════════════"

if [ "$STATUS_ONLY" = 1 ]; then
  ufw status verbose
  exit 0
fi

# ── enable ufw if inactive (after adding allow rules so we don't lock ourselves out) ─
UFW_STATUS=$(ufw status 2>/dev/null | head -1)
echo "→ current ufw: $UFW_STATUS"

# helper: idempotent rule add/remove. Pass each ufw arg as a separate
# positional — shell-quoting single-quoted comments inside a single
# string mangled the value (split on whitespace, ufw saw `'MXWP-...'`
# as literal-with-quotes and dropped the rule silently).
rule_op() {
  local op="$1"; shift
  ufw "$op" "$@" 2>&1 | grep -vE "Skipping|existing rule" || true
}

if [ "$REMOVE" = 1 ]; then
  echo "▶ removing rules"
  for port in "${PORTS[@]}"; do
    if [ "$ANYWHERE" = 1 ]; then
      rule_op delete allow "${port}/tcp"
    else
      for net in "${PRIVATE_NETS[@]}"; do
        rule_op delete allow from "$net" to any port "$port" proto tcp
      done
    fi
  done
  echo "  ✓ removed"
else
  echo "▶ adding rules"
  for port in "${PORTS[@]}"; do
    if [ "$ANYWHERE" = 1 ]; then
      rule_op allow "${port}/tcp"
    else
      for net in "${PRIVATE_NETS[@]}"; do
        rule_op allow from "$net" to any port "$port" proto tcp
      done
    fi
  done
  echo "  ✓ added"

  # Make sure ssh stays open if we're enabling ufw for the first time
  if echo "$UFW_STATUS" | grep -qi inactive; then
    echo "▶ ufw was inactive — preserving ssh (22) and enabling"
    rule_op allow OpenSSH
    echo "y" | ufw enable
  fi
fi

ufw reload >/dev/null 2>&1 || true

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  Current ufw rules:"
echo "═══════════════════════════════════════════════════════════════"
ufw status numbered | sed 's/^/  /'

echo
if [ "$REMOVE" = 0 ]; then
  echo "Test from another machine:"
  echo "  curl -m 5 http://$(hostname -I | awk '{print $1}'):5173/  -o /dev/null -w 'HTTP %{http_code}\\n'"
  echo "  curl -m 5 http://$(hostname -I | awk '{print $1}'):8800/docs"
  [ "$WITH_CONSOLE" = 1 ] && echo "  ⚠ minio console (9001) / meili (7700) are now reachable from LAN — protect them"
  echo
  echo "If service-side (vite/uvicorn) bound to 127.0.0.1 instead of 0.0.0.0,"
  echo "ufw allowing the port still won't help — check ss -tlnp."
fi
