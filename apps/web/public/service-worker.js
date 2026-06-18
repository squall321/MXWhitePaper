/* eslint-disable no-restricted-globals */
/* global self, caches, clients */
/**
 * MX White Paper service worker (cycle 7).
 *
 * No Workbox, no build deps — vanilla SW + Cache Storage. Vite copies this
 * file from `public/` into the build output verbatim, so the registration
 * URL `/service-worker.js` is stable across dev/prod.
 *
 * Caches:
 *   - mxwp-static-v1     →  app-shell + manifest + icons + offline.html
 *   - mxwp-runtime-v1    →  hashed `/assets/*` Vite bundles, stale-while-revalidate
 *   - mxwp-docs-v1       →  GET `/api/v1/documents/:slug` JSON, LRU-50
 *
 * Strategies (per route pattern):
 *   - /assets/*          → stale-while-revalidate
 *   - /api/v1/documents/:slug (GET) → network-first, doc cache fallback
 *   - /api/v1/*          → network-first, no cache fallback (always live)
 *   - HTML navigations   → network-first, cached app-shell or offline.html fallback
 *   - else               → pass through
 *
 * Custom response header: cached doc fallbacks include `X-Mxwp-Cache: hit`
 * so the UI can surface an "offline — cached version" banner.
 */

const STATIC_CACHE = 'mxwp-static-v1'
const RUNTIME_CACHE = 'mxwp-runtime-v1'
const DOCS_CACHE = 'mxwp-docs-v1'
const DOCS_LRU_LIMIT = 50

// Deployment base path, derived at runtime from the SW's own URL: the worker
// is served at `<base>service-worker.js`, so stripping that suffix yields the
// base (always ends with '/'). This makes every cached path / route match
// resolve under ANY sub-path — standalone ('/') or behind the HWAX portal
// ('/mx-white-paper/') — without a build step. `relPath` maps a request URL
// back to a base-relative path so the route patterns below stay simple.
const BASE = self.location.pathname.replace(/service-worker\.js$/, '')

function relPath(url) {
  return url.pathname.startsWith(BASE)
    ? '/' + url.pathname.slice(BASE.length)
    : url.pathname
}

const APP_SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'manifest.webmanifest',
  BASE + 'icon.svg',
  BASE + 'offline.html',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // `addAll` aborts the install on a single 404 — keep this list to
      // files we control. Icons that exist only as the PNG TODO are
      // intentionally omitted from the shell list.
      cache.addAll(APP_SHELL).catch((err) => {
        // Don't fail the install if a single shell asset is missing
        // (dev-server quirks, partial deploys).
        // eslint-disable-next-line no-console
        console.warn('[mxwp-sw] shell precache partial', err)
      }),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, RUNTIME_CACHE, DOCS_CACHE])
      const names = await caches.keys()
      await Promise.all(
        names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

/**
 * LRU trim for the doc cache. Cache Storage doesn't expose timestamps, so
 * we order by insertion (cache.keys() returns Requests in insertion order
 * per spec). When we exceed the limit, drop the oldest.
 */
async function trimDocCache() {
  const cache = await caches.open(DOCS_CACHE)
  const keys = await cache.keys()
  if (keys.length <= DOCS_LRU_LIMIT) return
  const overflow = keys.length - DOCS_LRU_LIMIT
  for (let i = 0; i < overflow; i++) {
    await cache.delete(keys[i])
  }
}

function isAssetRequest(url) {
  return relPath(url).startsWith('/assets/')
}

function isDocApiRequest(url) {
  // /api/v1/documents/:slug  (GET only) — but NOT /api/v1/documents (list).
  return /^\/api\/v1\/documents\/[^/]+$/.test(relPath(url))
}

function isApiRequest(url) {
  return relPath(url).startsWith('/api/')
}

function isHtmlNavigation(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' &&
      request.headers.get('accept')?.includes('text/html'))
  )
}

/**
 * Wrap a Response so we can stamp `X-Mxwp-Cache: hit` without mutating
 * the cached entry (Response headers are immutable). Returns the same
 * body, status, statusText.
 */
async function tagCachedResponse(response) {
  const headers = new Headers(response.headers)
  headers.set('X-Mxwp-Cache', 'hit')
  const body = await response.clone().blob()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone())
      return res
    })
    .catch(() => null)
  if (cached) {
    // Don't await network — return cached immediately, refresh in bg.
    network.catch(() => {})
    return cached
  }
  const fresh = await network
  if (fresh) return fresh
  // Genuinely offline + no cache. Bubble up a synthetic 504 instead of
  // throwing, so the page can show a sensible error.
  return new Response('offline', { status: 504, statusText: 'Offline' })
}

async function networkFirstDoc(request) {
  const cache = await caches.open(DOCS_CACHE)
  try {
    const fresh = await fetch(request)
    if (fresh.ok) {
      // Clone before consuming. Put cache write off the critical path.
      cache.put(request, fresh.clone()).then(trimDocCache).catch(() => {})
    }
    return fresh
  } catch (_err) {
    const cached = await cache.match(request)
    if (cached) return tagCachedResponse(cached)
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'application/json', 'X-Mxwp-Cache': 'miss' },
    })
  }
}

async function networkFirstApi(request) {
  try {
    return await fetch(request)
  } catch (_err) {
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'application/json', 'X-Mxwp-Cache': 'miss' },
    })
  }
}

async function navigationHandler(request) {
  try {
    const fresh = await fetch(request)
    return fresh
  } catch (_err) {
    const cache = await caches.open(STATIC_CACHE)
    const shell = await cache.match(BASE + 'index.html')
    if (shell) return tagCachedResponse(shell)
    const offline = await cache.match(BASE + 'offline.html')
    if (offline) return tagCachedResponse(offline)
    return new Response('offline', { status: 503, statusText: 'Offline' })
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Only handle GETs — anything that mutates state goes straight to the
  // network so the offline-queue in the auto-save store retries on its
  // own schedule.
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  // Cross-origin requests pass through. We don't proxy or cache them.
  if (url.origin !== self.location.origin) return

  if (isAssetRequest(url)) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }
  if (isDocApiRequest(url)) {
    event.respondWith(networkFirstDoc(request))
    return
  }
  if (isApiRequest(url)) {
    event.respondWith(networkFirstApi(request))
    return
  }
  if (isHtmlNavigation(request)) {
    event.respondWith(navigationHandler(request))
    return
  }
  // Everything else (favicons, manifest, icon.svg) — try the static cache
  // first, then fall through to the network.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).catch(() => new Response('', { status: 504 }))),
  )
})

// Allow the page to ask the SW to skip-waiting on demand (post-update flow).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
