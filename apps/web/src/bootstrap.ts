import { registerAuthHooks, registerConnectionHooks } from '@/lib/api/client'
import { getAccessToken, useAuthStore } from '@/features/auth/store'
import { refresh } from '@/features/auth/api'
import { useConnectionStore } from '@/features/auth/connectionStore'

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

  // Kick off rehydrate. Don't await — the AuthGuard renders a "hydrating"
  // shim so the redirect doesn't fire before the cookie has been tried.
  useAuthStore.getState().setHydrating(true)
  void refresh().finally(() => {
    useAuthStore.getState().setHydrating(false)
  })
}
