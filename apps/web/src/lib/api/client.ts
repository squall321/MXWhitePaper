import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from 'axios'

const baseURL = (import.meta.env.VITE_API_URL as string) || '/api/v1'

export const apiClient = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 15_000,
})

/**
 * Auth hook injection. Defined as a registration callback to avoid the
 * `lib/api/client → features/auth/api → lib/api/client` circular import.
 * Wire-up happens once in `bootstrap.ts`.
 */
export interface AuthHooks {
  getAccessToken(): string | null
  /** Returns true on success, false when refresh failed. */
  refresh(): Promise<boolean>
  /** Called when refresh failed and we should redirect to /login. */
  onUnauthenticated(): void
  /** Called right before a silent refresh starts. Optional — sets a "hydrating"
   *  signal so route guards (AuthGuard) don't bounce to /login mid-refresh. */
  beginRehydrating?(): void
  /** Pair with `beginRehydrating` — called once the refresh promise settles. */
  endRehydrating?(): void
}

let authHooks: AuthHooks | null = null

export function registerAuthHooks(hooks: AuthHooks) {
  authHooks = hooks
}

// ── Connection status hooks ───────────────────────────────────────────────
// `bootstrap.ts` wires these so a Zustand store reflects axios traffic for
// the TopBar status pill. Decoupled the same way as auth hooks to avoid
// circular imports.
export interface ConnectionHooks {
  onSuccess(): void
  onFailure(): void
}

let connectionHooks: ConnectionHooks | null = null

export function registerConnectionHooks(hooks: ConnectionHooks) {
  connectionHooks = hooks
}

// ── Rate-limit hook ───────────────────────────────────────────────────────
// 429 responses surface a toast via this hook (registered by bootstrap.ts).
// Decoupled from the toast module so the client stays test-friendly.
export interface RateLimitHooks {
  onRateLimited(retryAfterSec: number): void
}

let rateLimitHooks: RateLimitHooks | null = null

export function registerRateLimitHooks(hooks: RateLimitHooks) {
  rateLimitHooks = hooks
}

/** Internal — exposed for tests. */
export function _getRateLimitHooks(): RateLimitHooks | null {
  return rateLimitHooks
}

// ── Retry budget ──────────────────────────────────────────────────────────
function readRetryLimit(): number {
  const raw = (import.meta.env.VITE_API_RETRY_LIMIT as string | undefined) ?? '1'
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return 1
  return Math.min(n, 3)
}

const RETRY_LIMIT = readRetryLimit()

interface RetryConfig extends AxiosRequestConfig {
  _retry?: boolean
  _retryCount?: number
}

function isIdempotentGet(cfg: AxiosRequestConfig | undefined): boolean {
  if (!cfg) return false
  return (cfg.method ?? 'get').toLowerCase() === 'get'
}

function isNetworkOr5xx(err: AxiosError): boolean {
  if (!err.response) return true // network / DNS / CORS
  const s = err.response.status
  return s >= 500 && s <= 599
}

function delayMs(attempt: number): number {
  // exponential backoff capped at 1.5s
  return Math.min(150 * 2 ** attempt, 1500)
}

// ── Request: inject Bearer access token. ──────────────────────────────────
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = authHooks?.getAccessToken() ?? null
  if (token) {
    config.headers = config.headers ?? {}
    ;(config.headers as Record<string, string>)['Authorization'] =
      `Bearer ${token}`
  }
  return config
})

// ── Response: connection status + 401 refresh + idempotent retry ──────────
let refreshInFlight: Promise<boolean> | null = null

apiClient.interceptors.response.use(
  (r) => {
    connectionHooks?.onSuccess()
    return r
  },
  async (err: AxiosError) => {
    const original = err.config as RetryConfig | undefined
    const status = err.response?.status
    const url = original?.url ?? ''
    const isAuthCall = url.startsWith('/auth/') || url === '/me'

    // Treat any non-401, non-422, non-409 outcome as a connection blip so the
    // TopBar pill flips amber. (Validation/business errors are still a fine
    // healthy connection.)
    if (status == null || (status >= 500 || status === 0)) {
      connectionHooks?.onFailure()
    } else if (status === 401 || status === 403) {
      // Auth issues count as healthy network — leave the pill green.
      connectionHooks?.onSuccess()
    } else {
      connectionHooks?.onSuccess()
    }

    // ── 429 → surface toast, never auto-retry ────────────────────────
    if (status === 429) {
      const headers = err.response?.headers ?? {}
      const headerVal =
        (headers as Record<string, unknown>)['retry-after'] ??
        (headers as Record<string, unknown>)['Retry-After']
      let retryAfter = Number.parseInt(String(headerVal ?? ''), 10)
      if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
        // Fall back to the body envelope's details.retry_after.
        const bodyData = err.response?.data as
          | { error?: { details?: { retry_after?: number } } }
          | undefined
        const fromBody = bodyData?.error?.details?.retry_after
        retryAfter = typeof fromBody === 'number' && fromBody > 0 ? fromBody : 60
      }
      rateLimitHooks?.onRateLimited(retryAfter)
      // No retry — propagate so call sites can react.
      return Promise.reject(err)
    }

    // ── 401 → single-flight refresh + retry ──────────────────────────
    if (status === 401 && original && !original._retry && !isAuthCall && authHooks) {
      original._retry = true

      if (!refreshInFlight) {
        const hooks = authHooks
        // refresh 도는 동안 AuthGuard 가 user=null 을 *유효한 unauth* 로 오인해
        // /login 으로 깜박 redirect 하는 걸 막기 위해 hydrating=true 시그널.
        hooks.beginRehydrating?.()
        const p = hooks.refresh().catch(() => false)
        refreshInFlight = p
        // Reset the slot only once the in-flight promise resolves.
        void p.finally(() => {
          if (refreshInFlight === p) refreshInFlight = null
          hooks.endRehydrating?.()
        })
      }

      const ok = await refreshInFlight
      if (!ok) {
        authHooks.onUnauthenticated()
        return Promise.reject(err)
      }
      // The request interceptor will re-inject a fresh Authorization header.
      return apiClient.request(original)
    }

    // ── Idempotent GET retry on network / 5xx ────────────────────────
    if (
      RETRY_LIMIT > 0 &&
      original &&
      isIdempotentGet(original) &&
      !isAuthCall &&
      isNetworkOr5xx(err)
    ) {
      const used = original._retryCount ?? 0
      if (used < RETRY_LIMIT) {
        original._retryCount = used + 1
        await new Promise((r) => setTimeout(r, delayMs(used)))
        return apiClient.request(original)
      }
    }

    return Promise.reject(err)
  },
)
