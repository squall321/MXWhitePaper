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
}

let authHooks: AuthHooks | null = null

export function registerAuthHooks(hooks: AuthHooks) {
  authHooks = hooks
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

// ── Response: on 401, refresh once then retry. ────────────────────────────
let refreshInFlight: Promise<boolean> | null = null

interface RetryConfig extends AxiosRequestConfig {
  _retry?: boolean
}

apiClient.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as RetryConfig | undefined
    const status = err.response?.status
    const url = original?.url ?? ''
    const isAuthCall = url.startsWith('/auth/') || url === '/me'

    if (status !== 401 || !original || original._retry || isAuthCall || !authHooks) {
      return Promise.reject(err)
    }
    original._retry = true

    if (!refreshInFlight) {
      const hooks = authHooks
      refreshInFlight = hooks.refresh().catch(() => false)
      refreshInFlight.finally(() => {
        refreshInFlight = null
      })
    }

    const ok = await refreshInFlight
    if (!ok) {
      authHooks.onUnauthenticated()
      return Promise.reject(err)
    }
    return apiClient.request(original)
  },
)
