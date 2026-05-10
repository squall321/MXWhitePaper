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
  "$APPTAINER" instance start "$@" "$sif" "$name"
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
  --env "APP_ENV=${APP_ENV}"

# ── web ─────────────────────────────────────────────────────────────
# VITE_API_URL is a relative path so the FE always asks its own origin
# for /api/v1. Vite's dev-server proxy (apps/web/vite.config.ts) forwards
# /api → http://127.0.0.1:${API_PORT}. This way logging in from a LAN
# host (e.g. http://192.168.x.x:5173) works without any extra CORS or
# host-aware build steps — the browser stays in same-origin land.
start_instance "$INST_WEB" "$WEB_SIF" \
  --bind "$REPO_ROOT:/workspace" \
  --env "VITE_API_URL=/api/v1"

echo
echo "✓ stack started"
echo "  postgres : 127.0.0.1:${POSTGRES_PORT}"
echo "  meili    : http://127.0.0.1:${MEILI_PORT}"
echo "  minio    : http://127.0.0.1:${MINIO_API_PORT} (console: ${MINIO_CONSOLE_PORT})"
echo "  api      : http://127.0.0.1:${API_PORT}/docs"
echo "  web      : http://127.0.0.1:${WEB_PORT}"
echo
echo "Next: ./infra/scripts/migrate.sh && ./infra/scripts/seed.sh"
