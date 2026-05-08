import { create } from 'zustand'

/**
 * The authenticated user shape returned by `GET /api/v1/me`.
 * Role drives editor + admin gating (write routes are gated to editor+).
 */
export interface AuthUser {
  id: string
  email: string
  name?: string
  role: 'admin' | 'editor' | 'viewer' | string
  avatar_url?: string | null
}

export interface AuthSnapshot {
  user: AuthUser | null
  /** Access token kept in memory only. SessionStorage holds a fallback copy. */
  accessToken: string | null
  /** Epoch ms after which the token is considered expired. */
  expiresAt: number | null
  /** True between the first call to `refresh()` and its resolution. */
  hydrating: boolean
}

export interface AuthActions {
  setSession(args: {
    user: AuthUser | null
    accessToken: string | null
    expiresAt: number | null
  }): void
  setUser(user: AuthUser | null): void
  setHydrating(on: boolean): void
  clear(): void
}

const STORAGE_KEY = 'mxwp.access_token'

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredToken(token: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (token) window.sessionStorage.setItem(STORAGE_KEY, token)
    else window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* swallow — private mode etc. */
  }
}

const initial: AuthSnapshot = {
  user: null,
  accessToken: readStoredToken(),
  expiresAt: null,
  hydrating: false,
}

export const useAuthStore = create<AuthSnapshot & AuthActions>((set) => ({
  ...initial,
  setSession: ({ user, accessToken, expiresAt }) => {
    writeStoredToken(accessToken)
    set({ user, accessToken, expiresAt, hydrating: false })
  },
  setUser: (user) => set({ user }),
  setHydrating: (on) => set({ hydrating: on }),
  clear: () => {
    writeStoredToken(null)
    set({ user: null, accessToken: null, expiresAt: null, hydrating: false })
  },
}))

/** Imperative read for axios interceptors that can't subscribe. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken
}
