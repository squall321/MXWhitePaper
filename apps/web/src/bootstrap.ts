import {
  registerAuthHooks,
  registerConnectionHooks,
  registerRateLimitHooks,
} from '@/lib/api/client'
import { toast } from '@/components/ui/Toast'
import { getAccessToken, useAuthStore } from '@/features/auth/store'
import { refresh } from '@/features/auth/api'
import { useConnectionStore } from '@/features/auth/connectionStore'
import { startConnectionTracking } from '@/features/editor/connectionStore'
import { registerServiceWorker } from '@/features/pwa/swRegistration'
import { useSettingsStore } from '@/features/settings/store'
import { applyDisplayPrefs } from '@/features/settings/applyDisplayPrefs'

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
     
    console.info('[mxwp] boot', {
      apiUrl: (import.meta.env.VITE_API_URL as string) || `${import.meta.env.BASE_URL}api/v1`,
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
      // portal sub-path 안전: BASE_URL 가 '/mx-white-paper/' 라면
      // pathname 도 '/mx-white-paper/login' 형태. base + 'login' 조합으로
      // 비교/이동해야 standalone(BASE_URL='/') 과 portal 양쪽 모두 동작.
      const loginPath = `${import.meta.env.BASE_URL}login`
      if (window.location.pathname === loginPath) return
      const here = window.location.pathname + window.location.search
      window.location.assign(`${loginPath}?return=${encodeURIComponent(here)}`)
    },
    // 401 silent refresh 중 AuthGuard 가 user=null 을 보고 /login 으로
    // 깜박 redirect 하지 않도록 hydrating 시그널을 빌려 씀.
    beginRehydrating: () => useAuthStore.getState().setHydrating(true),
    endRehydrating: () => useAuthStore.getState().setHydrating(false),
  })

  registerConnectionHooks({
    onSuccess: () => useConnectionStore.getState().markSuccess(),
    onFailure: () => useConnectionStore.getState().markFailure(),
  })

  // 429 → user-facing toast. The client interceptor never auto-retries,
  // so this toast is the user's only signal that they're being throttled.
  registerRateLimitHooks({
    onRateLimited: (sec) => {
      toast.warn(`잠시 후 다시 시도하세요 — ${sec}초`)
    },
  })

  // Sprint 5 — editor offline UX. Attach window online/offline listeners +
  // start the 30s healthz heartbeat. Idempotent.
  startConnectionTracking()

  // Cycle 7 — PWA service worker. No-op in dev (HMR) and on browsers
  // that don't expose `serviceWorker`.
  registerServiceWorker()

  // 표시 설정 — apply density / font-scale / line-height / high-contrast
  // before React mounts so the first paint already reflects the user's
  // preference, then keep the singleton <style> tag in sync with the store.
  const initial = useSettingsStore.getState()
  applyDisplayPrefs({
    density: initial.density,
    fontScale: initial.fontScale,
    lineHeight: initial.lineHeight,
    highContrast: initial.highContrast,
  })
  useSettingsStore.subscribe((s) => {
    applyDisplayPrefs({
      density: s.density,
      fontScale: s.fontScale,
      lineHeight: s.lineHeight,
      highContrast: s.highContrast,
    })
  })

  // Kick off rehydrate. Don't await — the AuthGuard renders a "hydrating"
  // shim so the redirect doesn't fire before the cookie has been tried.
  useAuthStore.getState().setHydrating(true)
  void refresh().finally(() => {
    useAuthStore.getState().setHydrating(false)
  })
}
