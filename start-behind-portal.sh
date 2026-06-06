#!/usr/bin/env bash
# Start MX White Paper served UNDER the HWAX portal sub-path (base = /mx-white-paper/).
# The portal reverse-proxies https://hwax.sec.samsung.net/mx-white-paper/ → this app, passing the
# prefix through, so assets/router/api all sit under /mx-white-paper/ (handled by VITE_BASE_PATH).
#
#   ./start-behind-portal.sh             # vite dev on :5173, base /mx-white-paper/
#   WEB_PORT=5173 ./start-behind-portal.sh
#
# Standalone (no portal)? Run the normal dev/build — base defaults to "/".
# Apptainer setup? Export VITE_BASE_PATH=/mx-white-paper/ into the web instance env before start.sh.
set -euo pipefail
export VITE_BASE_PATH="${VITE_BASE_PATH:-/mx-white-paper/}"
cd "$(dirname "$0")"
echo "→ MX White Paper dev with base ${VITE_BASE_PATH} on :${WEB_PORT:-5173}"
exec pnpm --filter @mx/web dev --host 0.0.0.0 --port "${WEB_PORT:-5173}"
