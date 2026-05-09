import { registerAuthHooks, registerConnectionHooks } from '@/lib/api/client'
import { getAccessToken, useAuthStore } from '@/features/auth/store'
import { refresh } from '@/features/auth/api'
import { useConnectionStore } from '@/features/auth/connectionStore'
import { startConnectionTracking } from '@/features/editor/connectionStore'

const ACCESS_TOKEN_KEY = 'mxwp.access_token'

/**
 * Strip obviously-broken access tokens (empty string, "undefined", or
 * non-JWT junk) from sessionStorage at boot. A leftover bad value would be
 * pulled into the auth store's `accessToken` slot and injected into the
 * Authorization header, making every request fail with 401 → silent loop.
 */
function sanitizeStoredAccessToken(): { hasAccessToken: boolean } {
  if (typeof window === 'undefined') return { hasAccessToken: false }
  try {
    const raw = window.sessionStorage.getItem(ACCESS_TOKEN_KEY)
    if (raw == null) return { hasAccessToken: false }
    const trimmed = raw.trim()
    // JWT shape: 3 base64url segments separated by `.`. We don't validate
    // the signature, just the *shape*, because anything else is poison.
    const looksLikeJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
      trimmed,
    )
    if (!trimmed || trimmed === 'undefined' || trimmed === 'null' || !looksLikeJwt) {
      window.sessionStorage.removeItem(ACCESS_TOKEN_KEY)
      // eslint-disable-next-line no-console
      console.warn('[mxwp] cleared invalid access_token in sessionStorage')
      return { hasAccessToken: false }
    }
    return { hasAccessToken: true }
  } catch {
    return { hasAccessToken: false }
  }
}

/**
 * One-time wiring between the axios client and the auth store. Called from
 * `main.tsx` before the React tree mounts. After registration, schedules a
 * silent `refresh()` so the access token is rehydrated from the httpOnly
 * cookie on app start.
 *
 * Order matters: `setHydrating(true)` must run BEFORE the React tree
 * renders so AuthGuard shows its "세션 확인 중…" shim instead of immediately
 * redirecting to /login. main.tsx invokes us synchronously before
 * createRoot, satisfying that ordering.
 */
export function bootstrapAuth() {
  const { hasAccessToken } = sanitizeStoredAccessToken()

  // Boot-time diagnostic line: visible in DevTools so the user can paste it
  // when reporting a "흰 화면" issue. Includes the resolved API URL so we can
  // distinguish "wrong baseURL" from "wrong network".
  try {
    // eslint-disable-next-line no-console
    console.info('[mxwp] boot', {
      apiUrl: (import.meta.env.VITE_API_URL as string) || '/api/v1',
      hasAccessToken,
      navigatorOnline:
        typeof navigator !== 'undefined' ? navigator.onLine : 'n/a',
      time: new Date().toISOString(),
    })
  } catch {
    /* noop — older browsers w/ console disabled */
  }

  registerAuthHooks({
    getAccessToken: () => getAccessToken(),
    refresh: async () => Boolean(await refresh()),
    onUnauthenticated: () => {
      if (typeof window === 'undefined') return
      if (window.location.pathname === '/login') return
      const here = window.location.pathname + window.location.search
      window.location.assign(`/login?return=${encodeURIComponent(here)}`)
    },
  })

  registerConnectionHooks({
    onSuccess: () => useConnectionStore.getState().markSuccess(),
    onFailure: () => useConnectionStore.getState().markFailure(),
  })

  // Sprint 5 — editor offline UX. Attach window online/offline listeners +
  // start the 30s healthz heartbeat. Idempotent.
  startConnectionTracking()

  // Kick off rehydrate. Don't await — the AuthGuard renders a "hydrating"
  // shim so the redirect doesn't fire before the cookie has been tried.
  useAuthStore.getState().setHydrating(true)
  void refresh().finally(() => {
    useAuthStore.getState().setHydrating(false)
  })
}
