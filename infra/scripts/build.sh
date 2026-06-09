#!/usr/bin/env bash
# Build / pull all .sif images required for the MXWP stack.
# Idempotent — skips images that already exist (use --force to rebuild).
#
# Proxy handling:
#   Apptainer respects HTTP(S)_PROXY env for OCI registry pulls, but
#   `sudo` strips those vars by default. This script:
#     1. Inherits HTTP_PROXY / HTTPS_PROXY from the caller (sudo -E or
#        explicit `--preserve-env=HTTPS_PROXY` works).
#     2. Falls back to MXWP_FALLBACK_PROXY (default
#        http://168.219.61.252:8080 — Samsung MX egress) when no env
#        proxy is set OR when the first pull attempt fails.
#     3. Pre-staged .sif files in infra/apptainer/ are always honoured
#        first — no network call at all if the file already exists.
#
# Override or disable:
#   MXWP_FALLBACK_PROXY=http://10.0.0.1:8080 sudo -E ./build.sh
#   MXWP_FALLBACK_PROXY= sudo ./build.sh                 # disable fallback
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# Proxy: prefer existing env (sudo -E preserves HTTPS_PROXY etc.); fall
# back to the well-known corporate egress. Apptainer reads the lowercase
# variants — export both casings so any underlying lib finds them.
FALLBACK_PROXY="${MXWP_FALLBACK_PROXY:-http://168.219.61.252:8080}"
PROXY_URL="${HTTPS_PROXY:-${HTTP_PROXY:-${https_proxy:-${http_proxy:-}}}}"

if [ -z "$PROXY_URL" ] && [ -n "$FALLBACK_PROXY" ]; then
  PROXY_URL="$FALLBACK_PROXY"
  echo "ℹ no proxy in env — using fallback $PROXY_URL"
fi

if [ -n "$PROXY_URL" ]; then
  export HTTP_PROXY="$PROXY_URL"
  export HTTPS_PROXY="$PROXY_URL"
  export http_proxy="$PROXY_URL"
  export https_proxy="$PROXY_URL"
  export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}"
  export no_proxy="$NO_PROXY"
fi

_try_pull() {
  # Wrapper so we can retry once with the fallback proxy. apptainer pull
  # talks to the OCI registry over HTTPS — it honours HTTP(S)_PROXY env.
  local sif="$1" src="$2" proxy="${3:-}"
  if [ -n "$proxy" ]; then
    HTTPS_PROXY="$proxy" HTTP_PROXY="$proxy" \
    https_proxy="$proxy" http_proxy="$proxy" \
      "$APPTAINER" pull --force "$sif" "$src"
  else
    "$APPTAINER" pull --force "$sif" "$src"
  fi
}

build_or_pull() {
  local sif="$1" src="$2" def="${3:-}"
  if [ "$FORCE" -eq 1 ] || [ ! -f "$sif" ]; then
    if [ -n "$def" ]; then
      echo "→ build $(basename "$sif") from $def"
      "$APPTAINER" build --force "$sif" "$def"
    else
      echo "→ pull  $(basename "$sif") from $src"
      # 1) Use whatever proxy is already exported (FALLBACK applied at top).
      if _try_pull "$sif" "$src"; then
        return 0
      fi
      # 2) Explicit retry via the well-known fallback (in case current env
      # was misconfigured). Only fires when FALLBACK differs from current.
      if [ -n "$FALLBACK_PROXY" ] && [ "$FALLBACK_PROXY" != "${HTTPS_PROXY:-}" ]; then
        echo "  ↻ retry via $FALLBACK_PROXY"
        if _try_pull "$sif" "$src" "$FALLBACK_PROXY"; then
          return 0
        fi
      fi
      echo
      echo "✗ pull failed for $(basename "$sif")"
      echo "  Probable cause: corporate firewall blocking docker.io / registry-1.docker.io."
      echo
      echo "  Options:"
      echo "    a) Transfer pre-built .sif files from another machine:"
      echo "         scp <other-host>:.../infra/apptainer/*.sif $APPT_DIR/"
      echo "         then re-run this script (existing files are skipped)."
      echo "    b) Try a different proxy:"
      echo "         MXWP_FALLBACK_PROXY=http://<proxy>:<port> sudo -E $0"
      echo "    c) Use a corporate Docker Hub mirror — replace docker:// URLs above"
      echo "       with the mirror, e.g. docker://nexus.corp/dockerhub-proxy/<image>:<tag>"
      exit 1
    fi
  else
    echo "✓ skip  $(basename "$sif") (exists)"
  fi
}

# Base images pulled from docker-hub. *-base.sif have empty startscript
# (Apptainer keeps the docker ENTRYPOINT only in the runscript), so they
# cannot be launched directly via `instance start` and need wrapper builds
# below that supply an explicit %startscript.
build_or_pull "${APPT_DIR}/postgres-base.sif" "docker://pgvector/pgvector:pg15"
build_or_pull "${APPT_DIR}/meili-base.sif"    "docker://getmeili/meilisearch:v1.10"
build_or_pull "${APPT_DIR}/minio-base.sif"    "docker://minio/minio:RELEASE.2024-09-22T00-33-43Z"
build_or_pull "$MC_SIF"                       "docker://minio/mc:RELEASE.2024-09-16T17-43-14Z"

# Wrapper builds — add startscript so `apptainer instance start` actually
# launches the daemon.
build_or_pull "$POSTGRES_SIF" ""  "$APPT_DIR/postgres.def"
build_or_pull "$MEILI_SIF"    ""  "$APPT_DIR/meili.def"
build_or_pull "$MINIO_SIF"    ""  "$APPT_DIR/minio.def"

build_or_pull "$API_SIF"      ""  "$APPT_DIR/api.def"

# Audit fix H4 — web.def 의 `%files apps/web/dist /opt/web/dist` 가 dist 부재
# 시 silent 하게 빈 디렉토리를 바인드한다 → serve 가 빈 index.html 을 200
# 으로 응답해서 instance 가 healthy 처럼 보이지만 실제로는 broken SPA.
# build.sh 자체에서 미리 검출해 명시적 에러 + 빌드 명령 안내.
if [ ! -f "$REPO_ROOT/apps/web/dist/index.html" ]; then
  echo
  echo "✗ apps/web/dist/index.html 없음 — web.sif 가 빈 SPA 를 패키지 한다."
  echo "  Portal 모드: MXWP_BASE_PATH=/mx-white-paper/ pnpm --filter @mx/web build"
  echo "  Standalone : pnpm --filter @mx/web build"
  echo "  또는 make build-web (Drive ship pipeline 사용 시)."
  exit 1
fi
build_or_pull "$WEB_SIF"      ""  "$APPT_DIR/web.def"

echo
echo "✓ all images ready in $APPT_DIR"
