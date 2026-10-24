# Serving MX White Paper behind the HWAX Portal (sub-path)

> Context for future work: this app can run **standalone** (at `/`) OR **behind the HWAX Portal**
> (`hwax.sec.samsung.net`), which reverse-proxies it under the sub-path **`/mx-white-paper/`** and
> **strips that prefix** before forwarding (`HWAXPortal/backend/config/routes.env` —
> `mx-white-paper=http://localhost:5173/` and `mx-white-paper/api=http://localhost:8800/api/`; the
> trailing slash strips). The containers serve at their root, but the browser asks for
> `/mx-white-paper/…`, so the SPA's asset URLs, router basename and `/api` base are **baked with the
> prefix at build time**. Wired up on 2026-06-07. Standalone behaviour is unchanged (base defaults to `/`).

## How it works

One build-time value drives everything: **`VITE_BASE_PATH`** (read by `apps/web/vite.config.ts`).

- Empty / unset → standalone, base `/` (original behaviour).
- `VITE_BASE_PATH=/mx-white-paper/` → Vite `base` (assets), router `basename` and the api-client
  default (`${import.meta.env.BASE_URL}api/v1`) all sit under the portal sub-path.

`make build-web` passes the shell's `MXWP_BASE_PATH` (default `/mx-white-paper/`) to the build as
`VITE_BASE_PATH`. Vite reads **only** `VITE_BASE_PATH` — `MXWP_BASE_PATH=… pnpm build` alone bakes
base `/` (checked with `vite resolveConfig`, 2026-10-24). Nothing reads the prefix at run time:
`start.sh` passes no VITE env to the web instance, and `MXWP_BASE_PATH` in `.env` changes nothing.

## Production = prebuilt dist baked into web.sif, served by `serve` (NO build on the server)

> **IMPORTANT for cae00 (corporate TLS-intercept network): npm/corepack are UNREACHABLE there**
> (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`), so the web container must NOT run pnpm at start. It doesn't.

`infra/apptainer/web.def`:
- `%files apps/web/dist /opt/web/dist` — the **prebuilt SPA is baked into the image** at
  `apptainer build` time (online).
- `%post` bakes a tiny static server (`serve@14`).
- `%startscript` = **`serve -s /opt/web/dist -l tcp://0.0.0.0:5173`**, detached with `setsid nohup`
  (an `exec` there gets reaped) — pure static serve, SPA fallback, no pnpm, no network. `serve` serves
  at the **root**, so the front layer (portal) **strips** `/mx-white-paper/`; the SPA's
  asset/router/api URLs are baked with the prefix. `start.sh` relaunches the same `serve` if `:5173`
  does not answer.
- `/api` is handled by the **front layer**, not the container: the portal routes
  `/mx-white-paper/api/` → the API `:8800/api/` (`HWAXPortal/backend/config/routes.env`).
- `%runscript` still runs `vite dev` for interactive development on online machines only.

### Online build → Drive → cae00 (no build anywhere on cae00)

```bash
# ONLINE host (can reach npm):
make build-web                        # VITE_BASE_PATH=/mx-white-paper/ pnpm build + apptainer build web.sif
./infra/scripts/images-to-drive.sh    # web.sif → Google Drive   (make ship = both)

# cae00 (no npm, no Docker Hub):
./infra/scripts/images-from-drive.sh    # pulls web.sif (+ verifies sha256) into infra/apptainer/
./infra/scripts/start.sh                # build.sh skips (sif exists); web runs `serve` (no build)
```

New env in `.env`: `MXWP_IMAGES_REMOTE=MxwpDrive:MXWhitePaper/images` (reuses the same rclone remote
as `MXWP_DRIVE_REMOTE`). Scripts: `infra/scripts/images-to-drive.sh` / `images-from-drive.sh`
(mirror HWAXPortal's). postgres/meili/minio/api sifs change rarely — ship them once with
`MXWP_IMAGES_ALL=1`; normally only `web.sif` is re-shipped.

## Files changed (for reference)

- `apps/web/vite.config.ts` — `BASE`/`API_PREFIX` from `VITE_BASE_PATH`; the same `/api` proxy for
  `server` (dev) and `preview` (local check of a build); `base: BASE`.
- `apps/web/src/main.tsx` — `<BrowserRouter basename={import.meta.env.BASE_URL}>`.
- `apps/web/src/lib/api/client.ts`, `features/sharing/api.ts`, `bootstrap.ts` — API base default
  `${import.meta.env.BASE_URL}api/v1` (still overridable via `VITE_API_URL`).
- `infra/apptainer/web.def` — `%startscript` = `serve -s` of the baked dist (was build + `vite preview`,
  before that `vite dev`).
- `infra/scripts/start.sh` — starts the web instance with no VITE env and relaunches `serve` if needed.
- `Makefile` `build-web` — `MXWP_BASE_PATH` (default `/mx-white-paper/`) → `VITE_BASE_PATH`.

## Run behind the portal

```bash
# ONLINE build host:
make build-web                       # bake /mx-white-paper/ into dist, then dist into web.sif
# the serving box:
./infra/scripts/start.sh             # web instance: serve -s /opt/web/dist on :5173 (no build)
```

The portal forwards `https://hwax.sec.samsung.net/mx-white-paper/` → `127.0.0.1:5173/` and
`/mx-white-paper/api/` → `127.0.0.1:8800/api/` (prefix stripped). On the API side the same sub-path
needs `REFRESH_COOKIE_PATH=/` and `PORTAL_SSO_LANDING=/mx-white-paper/` (`docs/lat/core.md`).

## Identity — who MXWP thinks the caller is

Two doors, both opt-in by config; with nothing set MXWP behaves as a standalone app.

| Door | Turned on by | What happens |
| --- | --- | --- |
| Browser tile (jwt-handoff) | `PORTAL_JWKS_URL` (+ `PORTAL_AUDIENCE`, `REFRESH_COOKIE_PATH=/`, `PORTAL_SSO_LANDING`) | The portal POSTs a 90 s RS256 launch token to `POST /api/v1/auth/portal-callback`; MXWP verifies it against the portal JWKS, spends its `jti` once (DB table `portal_launch_jti`), upserts the user by email and sets the refresh cookie. The token's `affiliation` claim and the `plat:` entries of `groups` are stored on the user (`users.portal_*`) on every launch — the portal's signed snapshot. |
| Gateway / portal delegation | `MXWP_SSO_SECRET` in MXWP `.env` **and** the same value in `HWAXMcpGateway/provision.env` (with `PER_USER_SSO_APPS` `mx-white-paper:MXWP`, `MXWP_SSO_URL=http://127.0.0.1:8800/api/v1/auth/sso`, `MXWP_SEND_PLAT=1`) | The gateway calls `POST /api/v1/auth/sso` with the shared secret and the person's email and gets a 12 h token **in that person's name** (`typ=delegated`, scope read + write). Portal chat, deliberation and Claude then call MXWP as that person instead of the service account. Empty secret → 404, and the gateway stays on the service account (the off switch). |

Delegated calls also carry the person's portal affiliation and `plat:` permissions as **signed** headers
(`X-Heax-User-Affiliation` + `X-Heax-Aff-Proof`, `X-Heax-User-Plat` + `X-Heax-Plat-Proof`, HMAC-SHA256 with the same secret, bound to
the email, 120 s). MXWP trusts them only for that call; a plain header without a valid proof is ignored. A first-time user
lands in the team an admin mapped to their affiliation (`/api/v1/admin/aff-team-map`), else the first team.

Revoking — an admin bumps the generation (`POST /api/v1/admin/sso-delegations/{user_id}/revoke`), deactivates the user,
or rotates/empties `MXWP_SSO_SECRET`; each kills outstanding delegated tokens at once. Changing `.env` needs an
`mxwp_api` restart (the instance inherits `.env` at start). Details and tests: `docs/lat/core.md` §게이트웨이 · 포털 위임.

## Gotchas

- The prefix must be present at **build time** as `VITE_BASE_PATH` (`make build-web` maps
  `MXWP_BASE_PATH` to it) — base is baked into the static assets, not applied at serve time.
- The portal **strips** the prefix, so the containers see root paths while the browser sees
  `/mx-white-paper/…` — that is why the SPA must be built with the base.
- `/api` proxy lives in BOTH `server` and `preview` config — keep them in sync (`makeApiProxy()`).
