import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Hand-rolled mock — no jsdom needed. We swap `apiClient` for a stub whose
 * `post`/`get` return whatever the test sets up, then verify the auth
 * helpers wire requests/responses to the auth store correctly.
 */
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}))

import { apiClient } from '@/lib/api/client'
import { useAuthStore } from '../store'
import { login, refresh, logout, me } from '../api'

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>
const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

const adminUser = { id: 'u1', email: 'admin@mx.local', role: 'admin' as const }

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.getState().clear()
  if (typeof globalThis !== 'undefined' && typeof globalThis.window !== 'undefined') {
    globalThis.window.localStorage?.clear?.()
  }
})

describe('auth/api · login()', () => {
  it('stores user + access token on success', async () => {
    post.mockResolvedValueOnce({
      data: {
        data: { access_token: 'tok-1', expires_in: 3600, user: adminUser },
      },
    })
    const u = await login('admin@mx.local', 'pw')
    expect(u.email).toBe('admin@mx.local')
    const s = useAuthStore.getState()
    expect(s.user?.email).toBe('admin@mx.local')
    expect(s.accessToken).toBe('tok-1')
    expect(post).toHaveBeenCalledWith('/auth/login', {
      email: 'admin@mx.local',
      password: 'pw',
    })
  })

  it('writes the lastLoginAt debug timestamp when window exists', async () => {
    post.mockResolvedValueOnce({
      data: { data: { access_token: 't', expires_in: 60, user: adminUser } },
    })
    await login('admin@mx.local', 'pw')
    if (typeof window !== 'undefined' && window.localStorage) {
      expect(window.localStorage.getItem('mxwp.last_login_at')).toBeTruthy()
    } else {
      // node runtime — login still resolved without throwing.
      expect(useAuthStore.getState().accessToken).toBe('t')
    }
  })

  it('propagates the axios error on 401', async () => {
    const err = Object.assign(new Error('401'), {
      response: { status: 401 },
    })
    post.mockRejectedValueOnce(err)
    await expect(login('a@b', 'bad')).rejects.toBeDefined()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('auth/api · refresh()', () => {
  it('returns the user when refresh + /me succeed', async () => {
    // refresh response with no user — falls through to /me
    post.mockResolvedValueOnce({
      data: { data: { access_token: 't2', expires_in: 1800 } },
    })
    get.mockResolvedValueOnce({ data: { data: adminUser } })
    const u = await refresh()
    expect(u?.email).toBe('admin@mx.local')
    expect(useAuthStore.getState().accessToken).toBe('t2')
  })

  it('returns the echoed user when /refresh includes one', async () => {
    post.mockResolvedValueOnce({
      data: { data: { access_token: 't3', expires_in: 900, user: adminUser } },
    })
    const u = await refresh()
    expect(u?.email).toBe('admin@mx.local')
    expect(get).not.toHaveBeenCalled()
  })

  it('returns null on network failure (never throws)', async () => {
    post.mockRejectedValueOnce(new Error('Network Error'))
    const u = await refresh()
    expect(u).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('returns null when /refresh responds with no access_token', async () => {
    post.mockResolvedValueOnce({ data: { data: {} } })
    const u = await refresh()
    expect(u).toBeNull()
    // No half-set state — token must remain null.
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})

describe('auth/api · logout()', () => {
  it('clears local state even when the server call fails', async () => {
    useAuthStore.getState().setSession({
      user: adminUser,
      accessToken: 'live',
      expiresAt: null,
    })
    post.mockRejectedValueOnce(new Error('boom'))
    await logout()
    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.accessToken).toBeNull()
  })

  it('calls POST /auth/logout', async () => {
    post.mockResolvedValueOnce({ data: {} })
    await logout()
    expect(post).toHaveBeenCalledWith('/auth/logout', {})
  })
})

describe('auth/api · me()', () => {
  it('returns null on 401 and does NOT half-set the store', async () => {
    useAuthStore.getState().setSession({
      user: adminUser,
      accessToken: 'k',
      expiresAt: null,
    })
    get.mockRejectedValueOnce(
      Object.assign(new Error('401'), { response: { status: 401 } }),
    )
    const u = await me()
    expect(u).toBeNull()
    // Token left untouched — me() doesn't clear on its own.
    expect(useAuthStore.getState().accessToken).toBe('k')
  })

  it('updates the user on success', async () => {
    get.mockResolvedValueOnce({ data: { data: adminUser } })
    const u = await me()
    expect(u?.role).toBe('admin')
    expect(useAuthStore.getState().user?.email).toBe('admin@mx.local')
  })
})
