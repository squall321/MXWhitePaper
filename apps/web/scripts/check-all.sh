#!/usr/bin/env bash
# CI-style "everything green" gate for the web app.
#
# Runs, in order, the four signals that catch the most regressions:
#   1) Schema sample validation (DocumentJSON v1.0 SSOT)
#   2) Web app TypeScript typecheck
#   3) Web app production build (Vite)
#   4) Vitest unit + integration suite (no e2e — that's Playwright-banned)
#
# Usage (from repo root or anywhere):
#   ./apps/web/scripts/check-all.sh
#
# Exit code 0 only if every step succeeds.
set -euo pipefail

# Resolve repo root regardless of where the script was launched from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

step() {
  echo
  echo "▶ $1"
  echo "─────────────────────────────────────────────────────────────"
}

step "1/4  Validate DocumentJSON samples"
pnpm --filter @mx/shared run validate

step "2/4  TypeScript typecheck (@mx/web)"
pnpm --filter @mx/web typecheck

step "3/4  Vite build (@mx/web)"
pnpm --filter @mx/web build

step "4/4  Vitest"
cd apps/web
pnpm vitest run

echo
echo "✓ check-all.sh — all gates green"
