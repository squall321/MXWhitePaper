# Serving MX White Paper behind the HWAX Portal (sub-path)

> Context for future work: this app can run **standalone** (at `/`) OR **behind the HWAX Portal**
> (`hwax.sec.samsung.net`), which reverse-proxies it under the sub-path **`/mx-white-paper/`** and
> **passes that prefix through** (does not strip it). So when behind the portal, every asset URL,
> the router, and the `/api` calls must live under `/mx-white-paper/`. This was wired up on
> 2026-06-07. Standalone behaviour is unchanged (base defaults to `/`).

## How it works

One env var drives everything: **`MXWP_BASE_PATH`** (in `.env`).

- Empty / unset → standalone, base `/` (original behaviour).
- `MXWP_BASE_PATH=/mx-white-paper/` → served under the portal sub-path.

`infra/scripts/start.sh` threads it into the web instance as:
- `VITE_BASE_PATH=$MXWP_BASE_PATH` — Vite `base` (assets), router `basename`, api-client default.
- `VITE_API_URL=<prefix>api/v1` — so the FE calls `/mx-white-paper/api/v1`.

## Production = prebuilt dist baked into web.sif, served by `serve` (NO build on the server)

> **IMPORTANT for cae00 (corporate TLS-intercept network): npm/corepack are UNREACHABLE there**
> (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`), so the web container must NOT run pnpm at start. It doesn't.

`infra/apptainer/web.def`:
- `%files apps/web/dist /opt/web/dist` — the **prebuilt SPA is baked into the image** at
  `apptainer build` time (online).
- `%post` bakes a tiny static server (`serve@14`).
- `%startscript` = **`exec serve -s /opt/web/dist -l 5173`** — pure static serve, SPA fallback, no
  pnpm, no network. `serve` serves at the **root**, so the front layer (portal) **strips**
  `/mx-white-paper/`; the SPA's asset/router/api URLs are baked with the prefix.
- `/api` is handled by the **front layer**, not the container: the portal routes
  `/mx-white-paper/api/` → the API `:8800` (`HWAXPortal/backend/config/routes.env`).
- `%runscript` still runs `vite dev` for interactive development on online machines only.

### Online build → Drive → cae00 (no build anywhere on cae00)

```bash
# ONLINE host (can reach npm):
MXWP_BASE_PATH=/mx-white-paper/ pnpm --filter @mx/web build        # base baked into dist
apptainer build infra/apptainer/web.sif infra/apptainer/web.def    # bakes dist into web.sif
./infra/scripts/images-to-drive.sh                                 # web.sif → Google Drive

# cae00 (no npm, no Docker Hub):
./infra/scripts/images-from-drive.sh    # pulls web.sif (+ verifies sha256) into infra/apptainer/
./infra/scripts/start.sh                # build.sh skips (sif exists); web runs `serve` (no build)
```

New env in `.env`: `MXWP_IMAGES_REMOTE=MxwpDrive:MXWhitePaper/images` (reuses the same rclone remote
as `MXWP_DRIVE_REMOTE`). Scripts: `infra/scripts/images-to-drive.sh` / `images-from-drive.sh`
(mirror HWAXPortal's). postgres/meili/minio/api sifs change rarely — ship them once with
`MXWP_IMAGES_ALL=1`; normally only `web.sif` is re-shipped.

## Files changed (for reference)

- `apps/web/vite.config.ts` — `BASE`/`API_PREFIX` from `VITE_BASE_PATH`; shared `API_PROXY` used by
  both `server` (dev) and `preview` (prod); `base: BASE`.
- `apps/web/src/main.tsx` — `<BrowserRouter basename={import.meta.env.BASE_URL}>`.
- `apps/web/src/lib/api/client.ts`, `features/sharing/api.ts`, `bootstrap.ts` — API base default
  `${import.meta.env.BASE_URL}api/v1` (still overridable via `VITE_API_URL`).
- `infra/apptainer/web.def` — `%startscript` = build + `vite preview` (was `vite dev`).
- `infra/scripts/start.sh` — injects `VITE_BASE_PATH`/`VITE_API_URL` from `MXWP_BASE_PATH`.
- `.env.example` — `MXWP_BASE_PATH` documented.

## Run behind the portal

```bash
# in .env:  MXWP_BASE_PATH=/mx-white-paper/
./infra/scripts/build.sh --force     # rebuild web.sif if web.def changed
./infra/scripts/start.sh             # web instance builds dist + serves via preview on :5173
```

The portal forwards `https://hwax.sec.samsung.net/mx-white-paper/` → `127.0.0.1:5173`.

## Gotchas

- `MXWP_BASE_PATH` must be present at **build time** (start.sh handles this) — base is baked into the
  static assets, not applied at serve time.
- The portal **passes the prefix through** (does not strip), so the SPA must be built with the base.
- `/api` proxy lives in BOTH `server` and `preview` config — keep them in sync (shared `API_PROXY`).
