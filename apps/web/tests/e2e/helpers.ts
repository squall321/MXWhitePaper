import { type APIRequestContext, type Page, expect, request } from '@playwright/test'

// API CORS only whitelists `http://localhost:5173`; use the same origin
// for both the web and API so the SPA's fetch + cookie flow works.
export const API_BASE = 'http://localhost:8800/api/v1'
export const WEB_BASE = 'http://localhost:5173'

export const ADMIN_EMAIL = 'admin@mx.local'
export const ADMIN_PASSWORD = 'admin1234!'

export interface LoginResult {
  accessToken: string
  refreshToken?: string | null
  user: { id: string; email: string; role: string; name?: string }
}

/**
 * Log in via the UI. Fills the form on /login and waits for redirect to /.
 * Reuse for tests that exercise the login flow itself.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('이메일').fill(ADMIN_EMAIL)
  await page.getByLabel('비밀번호').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
}

interface LoginRaw extends LoginResult {
  refreshCookie: string | null
}

/**
 * Programmatic login — calls the API directly. Returns access token and the
 * raw `mxwp_refresh` httpOnly cookie value (the SPA's `bootstrap()` reads
 * the cookie via `/auth/refresh` to hydrate the user).
 */
export async function loginViaApi(): Promise<LoginRaw> {
  const ctx = await request.newContext()
  const res = await ctx.post(`${API_BASE}/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: { 'content-type': 'application/json' },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  // Extract the refresh cookie from set-cookie. Browser context will need
  // it so bootstrap()'s /auth/refresh call succeeds.
  const setCookie = res.headers()['set-cookie'] ?? ''
  const m = /mxwp_refresh=([^;]+)/.exec(setCookie)
  await ctx.dispose()
  return {
    accessToken: body.data.access_token as string,
    refreshToken: (body.data.refresh_token as string) ?? null,
    refreshCookie: m ? m[1]! : null,
    user: body.data.user,
  }
}

/**
 * Authenticate the page so AuthGuard lets it through. We submit the login
 * form via the UI — this is the only path that reliably populates the
 * Zustand `user` state (TopBar gates `+ 새 문서` on `user.role`). After
 * landing on `/` we're free to navigate elsewhere.
 *
 * NB: Faster API-only auth was tried but the SPA's bootstrap() relies on
 * the httpOnly refresh cookie, which a Playwright `addCookies` call could
 * not satisfy reliably across origins.
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('이메일').fill(ADMIN_EMAIL)
  await page.getByLabel('비밀번호').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
}

export interface ApiClient {
  ctx: APIRequestContext
  token: string
  dispose: () => Promise<void>
}

/** Build an authenticated APIRequestContext. */
export async function apiClient(token?: string): Promise<ApiClient> {
  const session = token ? { accessToken: token } : await loginViaApi()
  // APIRequestContext joins paths via WHATWG URL; if the path starts with
  // `/` the URL's path is replaced, dropping `/api/v1`. We add a trailing
  // slash to the baseURL so that `/documents` becomes `…/api/v1/documents`.
  const ctx = await request.newContext({
    baseURL: API_BASE + '/',
    extraHTTPHeaders: {
      authorization: `Bearer ${session.accessToken}`,
      'content-type': 'application/json',
    },
  })
  return {
    ctx,
    token: session.accessToken,
    dispose: () => ctx.dispose(),
  }
}

/**
 * Crockford base32 ULID generator — matches the same alphabet the BE
 * validates. We don't need monotonic uniqueness here, just a 26-char id.
 */
export function ulid(): string {
  const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const time = Date.now()
  const bytes: number[] = []
  let t = time
  for (let i = 0; i < 10; i++) {
    bytes.unshift(t % 32)
    t = Math.floor(t / 32)
  }
  for (let i = 0; i < 16; i++) bytes.push(Math.floor(Math.random() * 32))
  return bytes.map((b) => ALPH[b]!).join('')
}

export interface CreateDocPayload {
  slug: string
  title: string
  summary?: string
  bodyText?: string
}

/**
 * Create a minimal document via the API. Returns the slug for later
 * cleanup. The body, if provided, becomes a single paragraph block in
 * the first section so wikilinks ([[slug]]) get parsed by the BE.
 */
export async function createDoc(client: ApiClient, payload: CreateDocPayload): Promise<string> {
  const docId = ulid()
  const sectionId = ulid()
  const blocks = payload.bodyText
    ? [{ id: ulid(), type: 'paragraph' as const, text: payload.bodyText, meta: null }]
    : []
  const doc = {
    schema_version: '1.0',
    id: docId,
    slug: payload.slug,
    title: payload.title,
    summary: payload.summary ?? '',
    metadata: {
      division: 'MX',
      owners: ['admin'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: sectionId,
        level: 1,
        number: '1',
        title: '개요',
        blocks,
        subsections: [],
      },
    ],
  }
  const res = await client.ctx.post('documents', { data: doc })
  if (!res.ok()) {
    const body = await res.text().catch(() => '<no-body>')
    throw new Error(`createDoc failed (${res.status()}): ${body}`)
  }
  return payload.slug
}

/** Soft-delete a document (DELETE returns 204). Idempotent, swallows 404. */
export async function deleteDoc(client: ApiClient, slug: string): Promise<void> {
  const res = await client.ctx.delete(`documents/${encodeURIComponent(slug)}`)
  if (!res.ok() && res.status() !== 404) {
    // Don't throw — cleanup must not break the next test.
     
    console.warn(`[deleteDoc] ${slug} -> ${res.status()}`)
  }
}

/** Wait for the API healthz endpoint to return 200. Used by globalSetup. */
export async function waitForApi(timeoutMs = 30_000): Promise<void> {
  const ctx = await request.newContext()
  const start = Date.now()
  let lastStatus = -1
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await ctx.get(`${API_BASE}/healthz`, { timeout: 3_000 })
      lastStatus = res.status()
      if (lastStatus === 200) {
        await ctx.dispose()
        return
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  await ctx.dispose()
  throw new Error(`API healthz not 200 after ${timeoutMs}ms (last=${lastStatus})`)
}

/** Suffix helper to build collision-free slugs across parallel runs. */
export function uniqSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}
