import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

/**
 * The service worker runs in the SW global, not a normal JS engine, so we
 * can't import it as a module here. Instead we:
 *   1. Verify the file ships at /service-worker.js (i.e. inside `public/`).
 *   2. Parse it with Node's `vm` against a stub global, ensuring it's
 *      syntactically valid JS that doesn't blow up at top-level.
 *   3. Assert that the listener wiring (install / activate / fetch /
 *      message) registers as expected.
 */
const SW_PATH = resolve(__dirname, '../../../../public/service-worker.js')

describe('public/service-worker.js', () => {
  it('exists at the expected path', () => {
    expect(existsSync(SW_PATH)).toBe(true)
  })

  it('is non-empty and references the cache namespaces', () => {
    const src = readFileSync(SW_PATH, 'utf8')
    expect(src.length).toBeGreaterThan(500)
    expect(src).toMatch(/mxwp-static-v1/)
    expect(src).toMatch(/mxwp-runtime-v1/)
    expect(src).toMatch(/mxwp-docs-v1/)
  })

  it('parses as valid JS and registers the SW lifecycle listeners', () => {
    const src = readFileSync(SW_PATH, 'utf8')
    const events: string[] = []
    const swGlobal = {
      addEventListener: (evt: string) => events.push(evt),
      skipWaiting: () => {},
      clients: { claim: async () => {} },
      location: { origin: 'http://localhost' },
    }
    const sandbox = {
      self: swGlobal,
      caches: {
        open: async () => ({
          addAll: async () => {},
          match: async () => undefined,
          put: async () => {},
          keys: async () => [],
          delete: async () => true,
        }),
        keys: async () => [],
        delete: async () => true,
        match: async () => undefined,
      },
      fetch: async () => new Response('', { status: 200 }),
      Response,
      Request,
      Headers,
      URL,
      Promise,
      Set,
      console,
    }
    // Throws if the SW source has a parse error — the smoke purpose.
    vm.createContext(sandbox)
    vm.runInContext(src, sandbox)
    expect(events).toContain('install')
    expect(events).toContain('activate')
    expect(events).toContain('fetch')
    expect(events).toContain('message')
  })
})

describe('public/manifest.webmanifest', () => {
  const manifestPath = resolve(
    __dirname,
    '../../../../public/manifest.webmanifest',
  )
  it('exists', () => {
    expect(existsSync(manifestPath)).toBe(true)
  })
  it('is valid JSON with the keys Chrome requires', () => {
    const raw = readFileSync(manifestPath, 'utf8')
    const m = JSON.parse(raw) as {
      name: string
      short_name: string
      start_url: string
      display: string
      icons: Array<{ src: string; sizes: string; type: string }>
    }
    expect(m.name).toBe('MX White Paper')
    expect(m.short_name).toBe('MX WP')
    expect(m.start_url).toBe('/')
    expect(m.display).toBe('standalone')
    expect(m.icons.length).toBeGreaterThanOrEqual(1)
    // At least one entry should be SVG OR a 192px PNG, satisfying the
    // documented icon fallback.
    const hasUsableIcon = m.icons.some(
      (i) => i.type === 'image/svg+xml' || i.sizes === '192x192',
    )
    expect(hasUsableIcon).toBe(true)
  })
})
