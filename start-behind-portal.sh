#!/usr/bin/env bash
# Start MX White Paper served UNDER the HWAX portal sub-path (base = /mx-white-paper/).
# The portal reverse-proxies https://hwax.sec.samsung.net/mx-white-paper/ → this app, passing the
# prefix through, so assets/router/api all sit under /mx-white-paper/ (handled by VITE_BASE_PATH).
#
#   ./start-behind-portal.sh             # vite dev on :5173, base /mx-white-paper/
#   WEB_PORT=5173 ./start-behind-portal.sh
#
# Audit fix M4 (2026-06-09) — **이 스크립트는 DEV (vite dev + HMR) 전용**.
# Production deploy 는 49f5efd 이후 다음 흐름이다:
#   [online build host]   make ship           # MXWP_BASE_PATH=/mx-white-paper/ pnpm build + apptainer build + Drive push
#   [cae00 / 운영]         make pull-web && make up   # Drive 에서 web.sif 받고 serve -s /opt/web/dist 로 정적 서빙
# 따라서 이 스크립트를 cae00 같은 corp TLS-intercept 환경에서 돌리면
# pnpm install / dev 가 외부 npm 도달 실패로 깨진다 — 인터넷 가능한
# 개발 머신에서 *HMR 가 필요한 경우* 만 사용.
#
# Standalone (no portal)? Run the normal dev/build — base defaults to "/".
set -euo pipefail
export VITE_BASE_PATH="${VITE_BASE_PATH:-/mx-white-paper/}"
cd "$(dirname "$0")"
echo "→ MX White Paper dev with base ${VITE_BASE_PATH} on :${WEB_PORT:-5173}"
exec pnpm --filter @mx/web dev --host 0.0.0.0 --port "${WEB_PORT:-5173}"
