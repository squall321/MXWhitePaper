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

## Production = build + serve (not the dev server)

The web instance no longer runs `vite dev` for production. `infra/apptainer/web.def` `%startscript`
now **builds** the SPA (base baked in) and serves the built `dist` via **`vite preview`**:

```
pnpm --filter @mx/web build      # VITE_BASE_PATH baked into asset/router/api URLs
vite preview --host 0.0.0.0 --port 5173
```

`vite preview` serves `dist` under the base AND handles the `/api` proxy — but note **preview does
NOT inherit `server.proxy`**, so `apps/web/vite.config.ts` declares a separate `preview` block
referencing the same `API_PROXY` object (matches `<base>api`, rewrites the prefix back to `/api`
before forwarding to `VITE_PROXY_TARGET` → the API on :8800).

`apptainer run` (`%runscript`) still launches **`vite dev`** (HMR) for interactive development.

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
