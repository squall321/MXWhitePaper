/**
 * Service-worker registration helper. Lives outside `bootstrap.ts` so it can
 * be unit-tested in isolation (the bootstrap path imports the entire auth
 * stack, which makes it expensive to mock).
 *
 * Skips registration when:
 *   - `navigator.serviceWorker` is missing (SSR / non-secure / older browsers)
 *   - `import.meta.env.DEV === true` — Vite HMR + an active SW serving stale
 *     `/assets/*` rebuilds is a recipe for "old chunk" headaches.
 *
 * The helper is fire-and-forget. We log failures to the console but never
 * throw — a missing SW is a degraded mode, not a fatal error.
 */
export interface SwRegisterOptions {
  /** Override the dev flag — used by tests. Defaults to `import.meta.env.DEV`. */
  isDev?: boolean
  /** Stub navigator for tests. */
  navigator?: { serviceWorker?: ServiceWorkerContainer } | undefined
  /** Stub window for tests; defaults to `globalThis.window`. */
  win?: { addEventListener: Window['addEventListener'] } | undefined
  /** Path to the service-worker script. */
  scriptUrl?: string
}

export function registerServiceWorker(opts: SwRegisterOptions = {}): boolean {
  const isDev =
    opts.isDev ??
    (typeof import.meta !== 'undefined' && import.meta.env
      ? Boolean(import.meta.env.DEV)
      : false)
  if (isDev) return false

  const nav = opts.navigator ?? (typeof navigator !== 'undefined' ? navigator : undefined)
  if (!nav || !nav.serviceWorker) return false

  const win = opts.win ?? (typeof window !== 'undefined' ? window : undefined)
  if (!win) return false

  const url = opts.scriptUrl ?? '/service-worker.js'

  // Defer until `load` so the SW install doesn't compete with the initial
  // page render for bandwidth.
  win.addEventListener('load', () => {
    nav.serviceWorker!
      .register(url)
      .catch((err: unknown) => {
         
        console.warn('[mxwp] SW register failed', err)
      })
  })
  return true
}
