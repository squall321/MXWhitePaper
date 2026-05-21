#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  MX White Paper — One-shot quickstart (Apptainer)
#
#  Runs every step needed to bring up the stack from a fresh checkout:
#    0. preflight (apptainer / pnpm / python)
#    1. .env from .env.example (if missing)
#    2. host-side dependencies (pnpm install + datamodel-code-generator)
#    3. schema codegen (TS + Python)
#    4. apptainer images (.sif build/pull)
#    5. start 5-instance stack
#    6. alembic migrate + seed
#    7. status
#
#  Idempotent — re-running skips completed steps.
#  Use --skip-N to skip step N, --only-N to run only step N.
#
#  Usage:  ./quickstart.sh
#          ./quickstart.sh --skip-2 --skip-3   # ports + apptainer only
#          ./quickstart.sh --only-7            # status check
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── colors ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[1;34m'; C_GREEN=$'\033[1;32m'
  C_YELLOW=$'\033[1;33m'; C_RED=$'\033[1;31m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_DIM=""
fi

step()  { printf "\n${C_BLUE}▶ Step %s — %s${C_RESET}\n" "$1" "$2"; }
ok()    { printf "  ${C_GREEN}✓${C_RESET} %s\n" "$*"; }
warn()  { printf "  ${C_YELLOW}!${C_RESET} %s\n" "$*"; }
fail()  { printf "  ${C_RED}✗${C_RESET} %s\n" "$*"; exit 1; }
note()  { printf "  ${C_DIM}%s${C_RESET}\n" "$*"; }

# ── arg parsing ─────────────────────────────────────────────────────
SKIP=()
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --skip-*) SKIP+=("${arg#--skip-}") ;;
    --only-*) ONLY="${arg#--only-}" ;;
    -h|--help)
      # Print only the leading header-doc block: every # line up to (but not
      # including) the first non-# line. Shebang is skipped.
      awk 'NR==1 && /^#!/ {next}
           /^[^#]/        {exit}
           /^#$/          {print ""; next}
           /^# /          {print substr($0,3)}' "$0"
      exit 0 ;;
    *) fail "unknown arg: $arg (try --help)" ;;
  esac
done

run_step() {
  local n="$1"
  if [ -n "$ONLY" ] && [ "$ONLY" != "$n" ]; then return 1; fi
  for s in "${SKIP[@]}"; do [ "$s" = "$n" ] && return 1; done
  return 0
}

cd "$(dirname "$0")"
ROOT="$(pwd)"

# ── Step 0: preflight ───────────────────────────────────────────────
# 정책: 시스템 apptainer 버전 무관 — 항상 *우리 프로젝트 내부의 1.3.6* 사용.
# (시스템에 1.5.0 있으면 cgroup v2 + dbus 의존성으로 instance start 실패하는
#  케이스가 잦아서. 1.3.6 은 더 관대한 fallback.)
#
# Step 0 첫 부분에서:
#   1) 우리 1.3.6 이 infra/apptainer/bin-1.3.6/ 에 없으면 자동 설치 (vendored .deb)
#   2) .env 의 APPTAINER= 한 줄 자동 갱신 (또는 추가)
#   3) 그 이후 모든 단계가 그 apptainer 사용
#
# 시스템 apptainer 가 1.3.x 라서 굳이 vendored 안 써도 될 때 → SKIP_VENDORED_APPTAINER=1
if run_step 0; then
  step 0 "preflight"

  # ── 0a) vendored 1.3.6 자동 설치 (default ON) ─────────────────────
  VENDORED_APPTAINER="$ROOT/infra/apptainer/bin-1.3.6/usr/bin/apptainer"
  if [ "${SKIP_VENDORED_APPTAINER:-0}" = "1" ]; then
    note "SKIP_VENDORED_APPTAINER=1 — vendored 1.3.6 건너뜀, 시스템 apptainer 사용"
    APPTAINER_CMD="apptainer"
  else
    if [ ! -x "$VENDORED_APPTAINER" ]; then
      note "vendored apptainer 1.3.6 미설치 — install-apptainer-1.3.6.sh --auto 자동 실행"
      bash "$ROOT/infra/scripts/install-apptainer-1.3.6.sh" --auto || \
        fail "vendored apptainer 1.3.6 설치 실패. 수동: bash infra/scripts/install-apptainer-1.3.6.sh --auto"
    else
      ok "vendored apptainer 1.3.6 이미 설치됨: $VENDORED_APPTAINER"
    fi
    APPTAINER_CMD="$VENDORED_APPTAINER"

    # .env 에 APPTAINER= 가 없거나 다른 경로면 갱신
    if [ -f .env ]; then
      CUR_ENV_APPT="$(grep '^APPTAINER=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
      if [ "$CUR_ENV_APPT" != "$VENDORED_APPTAINER" ]; then
        if grep -q '^APPTAINER=' .env; then
          sed -i "s|^APPTAINER=.*|APPTAINER=$VENDORED_APPTAINER|" .env
          ok ".env 의 APPTAINER 갱신 → $VENDORED_APPTAINER"
        else
          echo "" >> .env
          echo "# auto-added by quickstart.sh — use vendored 1.3.6" >> .env
          echo "APPTAINER=$VENDORED_APPTAINER" >> .env
          ok ".env 에 APPTAINER 추가 → $VENDORED_APPTAINER"
        fi
      else
        ok ".env APPTAINER 이미 정확"
      fi
    fi
  fi

  # ── 0b) apptainer 동작 확인 ────────────────────────────────────────
  if command -v "$APPTAINER_CMD" >/dev/null 2>&1 || [ -x "$APPTAINER_CMD" ]; then
    APPTAINER_VER="$("$APPTAINER_CMD" --version 2>&1 | head -1 | awk '{print $NF}')"
    ok "apptainer: $APPTAINER_CMD ($APPTAINER_VER)"
  else
    fail "apptainer not found ($APPTAINER_CMD)"
  fi

  # ── 0c) 나머지 toolchain ──────────────────────────────────────────
  command -v pnpm >/dev/null 2>&1 \
    && ok "pnpm: $(pnpm -v)" \
    || fail "pnpm not found. Install via 'corepack enable && corepack prepare pnpm@9 --activate'"

  command -v node >/dev/null 2>&1 \
    && ok "node: $(node -v)" \
    || fail "node ≥20 required"

  command -v python3 >/dev/null 2>&1 \
    && ok "python: $(python3 --version)" \
    || fail "python3 ≥3.12 required"
fi

# ── Step 1: .env ────────────────────────────────────────────────────
if run_step 1; then
  step 1 ".env"
  if [ -f .env ]; then
    ok ".env already exists"
  else
    cp .env.example .env
    ok ".env created from .env.example"
    warn "Edit .env and change JWT_SECRET / MINIO_SECRET_KEY before going to prod."
  fi
fi

# ── Step 2: host-side deps ──────────────────────────────────────────
if run_step 2; then
  step 2 "host-side dependencies"
  # node_modules 디렉토리 존재만으로 skip 하지 말고, *핵심 의존성 하나* 까지 확인.
  # 첫 install 이 중간에 끊겼으면 디렉토리는 있지만 내부 dep 누락 — fast-deep-equal 같은
  # transitive dep 결락이 그 신호.
  if [ -d node_modules ] \
     && [ -d apps/web/node_modules ] \
     && [ -d packages/shared/node_modules/fast-deep-equal ]; then
    ok "node_modules present (skip pnpm install)"
  else
    note "running: pnpm install"
    pnpm install --frozen-lockfile=false
    ok "pnpm install"
  fi

  # Detection via the CLI entry-point (works regardless of whether the
  # package lives in system site-packages or a pipx-managed venv).
  if command -v datamodel-codegen >/dev/null 2>&1 \
     || python3 -c "import datamodel_code_generator" 2>/dev/null; then
    ok "datamodel-code-generator already installed"
  else
    # Ubuntu 24.04 enforces PEP-668 — plain `pip install --user` errors
    # out with "externally-managed-environment". Preferred install path
    # is pipx (separate venv, no system-site collision); fall back to
    # `pip --break-system-packages --ignore-installed` only if pipx
    # isn't on the host (rare on 24.04 where bootstrap-host.sh adds it).
    if command -v pipx >/dev/null 2>&1; then
      note "running: pipx install datamodel-code-generator"
      pipx install datamodel-code-generator
      pipx ensurepath || true
      # `pipx ensurepath` modifies the shell rc but doesn't affect the
      # current process; export the standard pipx bin dir so the codegen
      # step right below can find the binary without a re-login.
      export PATH="$HOME/.local/bin:/root/.local/bin:$PATH"
    else
      warn "pipx not found — falling back to pip --break-system-packages"
      note "(consider running sudo ./scripts/bootstrap-host.sh first)"
      python3 -m pip install --user --quiet --break-system-packages \
        --ignore-installed datamodel-code-generator
    fi
    ok "datamodel-code-generator"
  fi
fi

# ── Step 3: codegen ─────────────────────────────────────────────────
if run_step 3; then
  step 3 "schema codegen"
  pnpm -w schema:validate
  ok "golden samples valid"
  pnpm -w schema:gen
  ok "TS + Python types generated"
  if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
    if [ -n "$(git status --porcelain apps/web/src/types/document.ts apps/api/app/schemas/document.py 2>/dev/null || true)" ]; then
      warn "Generated files differ from git baseline."
      note "Commit them once to establish baseline:"
      note "  git add apps/web/src/types/document.ts apps/api/app/schemas/document.py"
      note "  git commit -m 'chore: codegen baseline'"
    else
      ok "codegen output matches baseline"
    fi
  fi
fi

# ── Step 4: apptainer images ────────────────────────────────────────
if run_step 4; then
  step 4 "apptainer images (build/pull)"
  ./infra/scripts/build.sh
fi

# ── Step 5: bring up stack ──────────────────────────────────────────
if run_step 5; then
  step 5 "start 5-instance stack"
  ./infra/scripts/start.sh
fi

# ── Step 6: migrate + seed ──────────────────────────────────────────
if run_step 6; then
  step 6 "migrate + seed"
  ./infra/scripts/migrate.sh
  ./infra/scripts/seed.sh
fi

# ── Step 7: status ──────────────────────────────────────────────────
if run_step 7; then
  step 7 "status"
  ./infra/scripts/status.sh
fi

# ── done ────────────────────────────────────────────────────────────
# Only print the "stack is up" banner if the start step actually ran.
if run_step 5; then
  . ./.env 2>/dev/null || true
  : "${API_PORT:=8000}"
  : "${WEB_PORT:=5173}"
  : "${MEILI_PORT:=7700}"
  : "${MINIO_CONSOLE_PORT:=9001}"

  printf "\n${C_GREEN}✓ MX White Paper stack is up.${C_RESET}\n"
  cat <<EOF

   Web    →  http://localhost:${WEB_PORT}
   API    →  http://localhost:${API_PORT}/docs
   Meili  →  http://localhost:${MEILI_PORT}
   MinIO  →  http://localhost:${MINIO_CONSOLE_PORT}

   Stop:    make down
   Logs:    make logs SVC=api   (or web/postgres/meili/minio)
   Reset:   make clean          (DESTRUCTIVE — removes .sif + data)
EOF
else
  printf "\n${C_GREEN}✓ done.${C_RESET}\n"
fi
