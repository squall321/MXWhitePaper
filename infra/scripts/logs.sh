#!/usr/bin/env bash
# Tail the Apptainer instance log for a service.
# Usage:  ./logs.sh <service>     where service ∈ {postgres, meili, minio, api, web}
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

svc="${1:-api}"
case "$svc" in
  postgres) inst="$INST_POSTGRES" ;;
  meili)    inst="$INST_MEILI"    ;;
  minio)    inst="$INST_MINIO"    ;;
  api)      inst="$INST_API"      ;;
  web)      inst="$INST_WEB"      ;;
  *) echo "✗ unknown service: $svc"; exit 1 ;;
esac

# Apptainer instance logs live under ~/.apptainer/instances/logs/<host>/<user>/<name>.{out,err}
host="$(hostname -s)"
user="$(id -un)"
log_dir="$HOME/.apptainer/instances/logs/$host/$user"

out="$log_dir/${inst}.out"
err="$log_dir/${inst}.err"

if [ ! -f "$out" ] && [ ! -f "$err" ]; then
  echo "✗ no log file at $log_dir for $inst"
  echo "  (instance may not have been started)"
  exit 1
fi

echo "═════ $inst ═════"
echo "(stdout: $out)"
echo "(stderr: $err)"
echo
tail -F "$out" "$err"
