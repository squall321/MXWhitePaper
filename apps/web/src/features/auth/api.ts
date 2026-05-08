import { apiClient } from '@/lib/api/client'
import { useAuthStore, type AuthUser } from './store'

interface ApiEnvelope<T> {
  data: T
  meta?: Record<string, unknown>
  error?: { code: string; message: string } | null
}

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

function applyTokenResponse(payload: LoginResponse | RefreshResponse, fallbackUser?: AuthUser | null) {
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
  applyTokenResponse(res.data.data)
  return res.data.data.user
}

/**
 * POST /api/v1/auth/refresh.
 * Used both at app start (silent rehydrate) and reactively from the
 * 401 axios interceptor. Returns the user when the cookie is valid.
 */
export async function refresh(): Promise<AuthUser | null> {
  try {
    const res = await apiClient.post<ApiEnvelope<RefreshResponse>>(
      '/auth/refresh',
      {},
    )
    applyTokenResponse(res.data.data)
    if (res.data.data.user) return res.data.data.user
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
    useAuthStore.getState().setUser(res.data.data)
    return res.data.data
  } catch {
    return null
  }
}
