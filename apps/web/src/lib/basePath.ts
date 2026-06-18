/**
 * Prefix an app-internal absolute path with the deployment base path so links
 * resolve both standalone (base `/`) AND behind the HWAX portal sub-path
 * (`/mx-white-paper/`). `import.meta.env.BASE_URL` always ends with `/`.
 *
 *   withBase('/docs/foo')  → '/docs/foo'                (standalone, base `/`)
 *                          → '/mx-white-paper/docs/foo'  (portal)
 *
 * USE FOR: raw `<a href>`, `window.location.*`, `window.open(...)`, form
 * `action` — anything that bypasses React Router. `<Link>`/`navigate()` are
 * already basename-aware (BrowserRouter basename = BASE_URL), so do NOT wrap
 * those. Fragment-only links (`#anchor`) must NOT be wrapped either.
 */
export function withBase(path: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  return base + (path.startsWith('/') ? path : '/' + path)
}
