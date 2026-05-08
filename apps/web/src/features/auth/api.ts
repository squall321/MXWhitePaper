import { apiClient } from '@/lib/api/client'
import { type ApiEnvelope } from '@/lib/api/envelope'
import { useAuthStore, type AuthUser } from './store'

interface LoginResponse {
  access_token: string
  token_type?: string
  expires_in?: number
  user: AuthUser
}

interface RefreshResponse {
  access_token: string
  expires_in?: number
  user?: AuthUser
}

const LAST_LOGIN_KEY = 'mxwp.last_login_at'

function applyTokenResponse(
  payload: LoginResponse | RefreshResponse | undefined,
  fallbackUser?: AuthUser | null,
): boolean {
  if (!payload || !payload.access_token) {
    // Defensive: never crash if the server returns an unexpected shape.
    if (typeof console !== 'undefined') {
      console.warn('[auth] applyTokenResponse called with invalid payload', payload)
    }
    return false
  }
  const expiresAt =
    payload.expires_in != null ? Date.now() + payload.expires_in * 1000 : null
  const user =
    'user' in payload && payload.user
      ? payload.user
      : (fallbackUser ?? useAuthStore.getState().user)
  useAuthStore.getState().setSession({
    user,
    accessToken: payload.access_token,
    expiresAt,
  })
  return true
}

/**
 * POST /api/v1/auth/login → { access_token, expires_in, user }.
 * The refresh cookie is set httpOnly by the server.
 */
export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await apiClient.post<ApiEnvelope<LoginResponse>>('/auth/login', {
    email,
    password,
  })
  applyTokenResponse(res.data?.data)
  // Stash a debug timestamp so testers can confirm a successful round-trip
  // without opening DevTools.
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_LOGIN_KEY, new Date().toISOString())
    }
  } catch {
    /* private mode */
  }
  const user = res.data?.data?.user
  if (!user) {
    throw new Error('로그인 응답에 사용자 정보가 없습니다.')
  }
  return user
}

/**
 * POST /api/v1/auth/refresh.
 * Used both at app start (silent rehydrate) and reactively from the
 * 401 axios interceptor. Returns the user when the cookie is valid.
 * Never throws — network/CORS failures resolve to `null`.
 */
export async function refresh(): Promise<AuthUser | null> {
  try {
    const res = await apiClient.post<ApiEnvelope<RefreshResponse>>(
      '/auth/refresh',
      {},
    )
    const ok = applyTokenResponse(res.data?.data)
    if (!ok) return null
    const user = res.data?.data?.user
    if (user) return user
    // Server didn't echo user; pull from /me.
    return await me()
  } catch {
    return null
  }
}

/** POST /api/v1/auth/logout — clears refresh cookie + local state. */
export async function logout(): Promise<void> {
  try {
    await apiClient.post('/auth/logout', {})
  } catch {
    /* ignore */
  }
  useAuthStore.getState().clear()
}

export async function me(): Promise<AuthUser | null> {
  try {
    const res = await apiClient.get<ApiEnvelope<AuthUser>>('/me')
    const user = res.data?.data ?? null
    useAuthStore.getState().setUser(user)
    return user
  } catch {
    return null
  }
}

export interface UserSearchHit {
  id: string
  name?: string
  email: string
}

/**
 * GET /api/v1/users/search?q= — used by the mention `@` autocomplete in the
 * editor. Returns an empty array on any failure so the UI never crashes.
 */
export async function searchUsers(q: string, limit = 10): Promise<UserSearchHit[]> {
  if (!q.trim()) return []
  try {
    const res = await apiClient.get<ApiEnvelope<UserSearchHit[]>>('/users/search', {
      params: { q, limit },
    })
    const data = res.data?.data
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
