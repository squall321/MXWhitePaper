#!/usr/bin/env bash
# Start the 5-service MXWP stack as Apptainer instances (host network).
# Order: postgres → meilisearch → minio → minio-init (one-shot) → api → web
set -euo pipefail
. "$(dirname "$0")/_common.sh"
require_apptainer

# Ensure images exist (no-op if already built)
"$(dirname "$0")/build.sh"

start_instance() {
  local name="$1" sif="$2"; shift 2
  if instance_running "$name"; then
    echo "✓ $name already running"
    return 0
  fi
  echo "→ start $name"
  # Some Apptainer installs (e.g. when /etc/apptainer/apptainer.conf sets
  # default network = bridge) put each instance into its own netns, so
  # container 127.0.0.1 can't reach the host's loopback API on :8800.
  # Setting MXWP_APPT_HOST_NET=1 in .env forces explicit host network on
  # every instance start, fixing vite → API proxy in those environments.
  local net_args=()
  if [ "${MXWP_APPT_HOST_NET:-0}" = "1" ]; then
    net_args=(--net --network=host)
  fi
  "$APPTAINER" instance start "${net_args[@]}" "$@" "$sif" "$name"
}

# ── postgres ────────────────────────────────────────────────────────
# LANG must be set for initdb. /var/run/postgresql is read-only inside the
# rootless container; redirect the unix-socket dir into PGDATA via env.
mkdir -p "$DATA_DIR/postgres-run"
start_instance "$INST_POSTGRES" "$POSTGRES_SIF" \
  --bind "$DATA_DIR/postgres:/var/lib/postgresql/data" \
  --bind "$DATA_DIR/postgres-run:/var/run/postgresql" \
  --env "POSTGRES_USER=${POSTGRES_USER}" \
  --env "POSTGRES_PASSWORD=${POSTGRES_PASSWORD}" \
  --env "POSTGRES_DB=${POSTGRES_DB}" \
  --env "PGPORT=${POSTGRES_PORT}" \
  --env "PGDATA=/var/lib/postgresql/data/pgdata" \
  --env "LANG=C.UTF-8" \
  --env "LC_ALL=C.UTF-8"

# ── meilisearch ─────────────────────────────────────────────────────
start_instance "$INST_MEILI" "$MEILI_SIF" \
  --bind "$DATA_DIR/meili:/meili_data" \
  --env "MEILI_MASTER_KEY=${MEILI_MASTER_KEY}" \
  --env "MEILI_ENV=development" \
  --env "MEILI_HTTP_ADDR=0.0.0.0:${MEILI_PORT}"

# ── minio ───────────────────────────────────────────────────────────
start_instance "$INST_MINIO" "$MINIO_SIF" \
  --bind "$DATA_DIR/minio:/data" \
  --env "MINIO_ROOT_USER=${MINIO_ACCESS_KEY}" \
  --env "MINIO_ROOT_PASSWORD=${MINIO_SECRET_KEY}"

# Wait for postgres to accept connections, then minio
echo "→ waiting for services to become ready…"
for i in $(seq 1 40); do
  if "$APPTAINER" exec instance://"$INST_POSTGRES" pg_isready -h 127.0.0.1 -p "$POSTGRES_PORT" -U "$POSTGRES_USER" >/dev/null 2>&1; then
    echo "✓ postgres ready"
    break
  fi
  sleep 1
done

minio_ready=0
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${MINIO_API_PORT}/minio/health/live" >/dev/null 2>&1; then
    echo "✓ minio ready (after ${i}s)"
    minio_ready=1
    break
  fi
  sleep 1
done
[ "$minio_ready" = 1 ] || echo "  ⚠ minio not ready within 60s — bucket init may fail"

# ── minio-init (one-shot bucket creation) ───────────────────────────
echo "→ ensuring MinIO buckets exist"
for i in $(seq 1 5); do
  if "$APPTAINER" exec "$MC_SIF" /bin/sh -c "
        mc alias set local http://127.0.0.1:${MINIO_API_PORT} '${MINIO_ACCESS_KEY}' '${MINIO_SECRET_KEY}' >/dev/null 2>&1 &&
        mc mb -p local/${MINIO_BUCKET_IMAGES} >/dev/null 2>&1 || true
        mc mb -p local/${MINIO_BUCKET_FILES}  >/dev/null 2>&1 || true
        mc mb -p local/${MINIO_BUCKET_BACKUPS:-mxwp-backups} >/dev/null 2>&1 || true
        mc anonymous set download local/${MINIO_BUCKET_IMAGES} >/dev/null 2>&1 || true
      " 2>&1; then
    echo "  ✓ minio buckets ready"
    break
  fi
  echo "  retry $i/5…"; sleep 3
done

# ── api ─────────────────────────────────────────────────────────────
# Same proxy passthrough as the web instance — the API container may
# need to reach external services (Meilisearch update task queue,
# any PyPI install if the .def added new deps post-build, etc).
# 127.0.0.1 is added to no_proxy explicitly so the API doesn't try to
# tunnel localhost calls (postgres/meili/minio) through the proxy.
MXWP_PROXY="${HTTPS_PROXY:-${HTTP_PROXY:-${MXWP_FALLBACK_PROXY:-http://168.219.61.252:8080}}}"
start_instance "$INST_API" "$API_SIF" \
  --bind "$REPO_ROOT:/workspace" \
  --env "API_PORT=${API_PORT}" \
  --env "DATABASE_URL=postgresql+asyncpg://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT}/${POSTGRES_DB}" \
  --env "MEILI_HOST=http://127.0.0.1:${MEILI_PORT}" \
  --env "MEILI_MASTER_KEY=${MEILI_MASTER_KEY}" \
  --env "MINIO_ENDPOINT=http://127.0.0.1:${MINIO_API_PORT}" \
  --env "MINIO_PUBLIC_ENDPOINT=http://127.0.0.1:${MINIO_API_PORT}" \
  --env "MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}" \
  --env "MINIO_SECRET_KEY=${MINIO_SECRET_KEY}" \
  --env "JWT_SECRET=${JWT_SECRET}" \
  --env "CORS_ORIGINS=${CORS_ORIGINS}" \
  --env "APP_ENV=${APP_ENV}" \
  --env "HTTP_PROXY=${MXWP_PROXY}" \
  --env "HTTPS_PROXY=${MXWP_PROXY}" \
  --env "NO_PROXY=localhost,127.0.0.1,::1"

# ── web ─────────────────────────────────────────────────────────────
# VITE_API_URL is a relative path so the FE always asks its own origin
# for /api/v1. Vite's dev-server proxy (apps/web/vite.config.ts) forwards
# /api → http://127.0.0.1:${API_PORT}. This way logging in from a LAN
# host (e.g. http://192.168.x.x:5173) works without any extra CORS or
# host-aware build steps — the browser stays in same-origin land.
#
# Proxy env passthrough: the web container runs `pnpm install` in its
# %startscript on first boot, which talks to registry.npmjs.org. In
# corporate networks the registry isn't directly reachable, so forward
# the same proxy that the host scripts use (env > MXWP_FALLBACK_PROXY).
MXWP_PROXY="${HTTPS_PROXY:-${HTTP_PROXY:-${MXWP_FALLBACK_PROXY:-http://168.219.61.252:8080}}}"
# Apptainer warns when the same env name is passed twice (e.g. both
# lowercase + uppercase). We only set the uppercase variants here;
# the container's runtime libraries that look for lowercase fall
# back to the uppercase via standard libc conventions on Linux.
#
# Corepack runtime quirk: `corepack prepare pnpm@9.12.0 --activate`
# baked into web.def caches the pnpm binary in the image, but every
# `pnpm` call still pings the npm registry to verify the manifest hash.
# Behind a strict corporate firewall that check times out and the call
# aborts before our `pnpm install` even starts (corepack.cjs:22089).
# `COREPACK_ENABLE_NETWORK=0` tells corepack to trust the cached
# binary and skip the verification — safe because we *just* baked it
# in. `COREPACK_ENABLE_STRICT=0` covers older corepack versions.
start_instance "$INST_WEB" "$WEB_SIF" \
  --bind "$REPO_ROOT:/workspace" \
  --bind /tmp:/tmp \
  --env "VITE_API_URL=/api/v1" \
  --env "VITE_PROXY_TARGET=${VITE_PROXY_TARGET:-http://127.0.0.1:${API_PORT}}" \
  --env "HTTP_PROXY=${MXWP_PROXY}" \
  --env "HTTPS_PROXY=${MXWP_PROXY}" \
  --env "NO_PROXY=localhost,127.0.0.1,::1" \
  --env "COREPACK_ENABLE_NETWORK=0" \
  --env "COREPACK_ENABLE_STRICT=0" \
  --env "COREPACK_ENABLE_DOWNLOAD_PROMPT=0"

echo
echo "✓ stack started"
echo "  postgres : 127.0.0.1:${POSTGRES_PORT}"
echo "  meili    : http://127.0.0.1:${MEILI_PORT}"
echo "  minio    : http://127.0.0.1:${MINIO_API_PORT} (console: ${MINIO_CONSOLE_PORT})"
echo "  api      : http://127.0.0.1:${API_PORT}/docs"
echo "  web      : http://127.0.0.1:${WEB_PORT}"
echo
echo "Next: ./infra/scripts/migrate.sh && ./infra/scripts/seed.sh"
