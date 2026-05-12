#!/usr/bin/env bash
# Dump recent log output for all (or selected) MXWP instances at once.
# Complements diag.sh — when diag says "service didn't bind", this
# pulls the actual stderr so you see WHY.
#
# Usage:
#   ./infra/scripts/errors.sh                     # all instances, 80 lines each
#   ./infra/scripts/errors.sh --lines 200         # deeper tail
#   ./infra/scripts/errors.sh web meili           # specific instances only
#   ./infra/scripts/errors.sh --only-err          # stderr only (no stdout)
#   ./infra/scripts/errors.sh --grep              # highlight error keywords
#   ./infra/scripts/errors.sh --follow web        # live tail (Ctrl-C to exit)
#
# Output groups errors by service with clear separators and prints the
# full file path so you can `less` or `tail -f` the specific log.
set -uo pipefail
. "$(dirname "$0")/_common.sh"
set +e   # _common.sh enables errexit — we tolerate missing log files

LINES=80
ONLY_ERR=0
HIGHLIGHT=0
FOLLOW=0
SELECTED=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --lines)     LINES="$2"; shift 2 ;;
    --lines=*)   LINES="${1#*=}"; shift ;;
    -n)          LINES="$2"; shift 2 ;;
    --only-err)  ONLY_ERR=1; shift ;;
    --grep)      HIGHLIGHT=1; shift ;;
    --follow|-f) FOLLOW=1; shift ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) SELECTED+=("$1"); shift ;;
  esac
done

# default: all 5 instances
if [ "${#SELECTED[@]}" -eq 0 ]; then
  SELECTED=(postgres meili minio api web)
fi

LOG_DIR="$HOME/.apptainer/instances/logs/$(hostname -s)/$(id -un)"

if [ ! -d "$LOG_DIR" ]; then
  echo "✗ log dir not found: $LOG_DIR"
  echo "  (apptainer hasn't started any instance yet on this host)"
  exit 1
fi

# Map shortname → instance name
inst_of() {
  case "$1" in
    postgres) echo "$INST_POSTGRES" ;;
    meili)    echo "$INST_MEILI"    ;;
    minio)    echo "$INST_MINIO"    ;;
    api)      echo "$INST_API"      ;;
    web)      echo "$INST_WEB"      ;;
    *)        echo "$1" ;;
  esac
}

# ── follow mode: tail -F across multiple files ─────────────────────
if [ "$FOLLOW" = 1 ]; then
  FILES=()
  for svc in "${SELECTED[@]}"; do
    inst="$(inst_of "$svc")"
    [ -f "$LOG_DIR/${inst}.out" ] && FILES+=("$LOG_DIR/${inst}.out")
    [ -f "$LOG_DIR/${inst}.err" ] && FILES+=("$LOG_DIR/${inst}.err")
  done
  if [ "${#FILES[@]}" -eq 0 ]; then
    echo "✗ no log files for: ${SELECTED[*]}"; exit 1
  fi
  echo "▶ following $(echo "${SELECTED[*]}") — Ctrl-C to exit"
  exec tail -F "${FILES[@]}"
fi

# ── snapshot mode ───────────────────────────────────────────────────
RED=$'\033[31m'; YEL=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'

print_tail() {
  local label="$1" file="$2"
  [ -s "$file" ] || return
  local total
  total=$(wc -l <"$file")
  echo
  echo "${DIM}════════════════════════════════════════════════════════════════${OFF}"
  echo "  $label"
  echo "  $file  ($total lines total, showing last $LINES)"
  echo "${DIM}════════════════════════════════════════════════════════════════${OFF}"
  if [ "$HIGHLIGHT" = 1 ]; then
    tail -n "$LINES" "$file" | sed \
      -e "s/\(ERROR\|FATAL\|CRITICAL\|Traceback\|Exception\|denied\|refused\|FAILED\)/${RED}\1${OFF}/g" \
      -e "s/\(WARN\|warning\|deprecated\)/${YEL}\1${OFF}/g"
  else
    tail -n "$LINES" "$file"
  fi
}

for svc in "${SELECTED[@]}"; do
  inst="$(inst_of "$svc")"
  if [ "$ONLY_ERR" = 0 ]; then
    print_tail "$inst — stdout" "$LOG_DIR/${inst}.out"
  fi
  print_tail "$inst — stderr" "$LOG_DIR/${inst}.err"
done

echo
echo "${DIM}─────────────────────────────────────────────────────────────────${OFF}"
echo "  Hint: deeper view with"
echo "    ./infra/scripts/errors.sh --lines 300 ${SELECTED[*]}"
echo "    ./infra/scripts/errors.sh --follow ${SELECTED[*]}"
echo "    less $LOG_DIR/<instance>.err"
