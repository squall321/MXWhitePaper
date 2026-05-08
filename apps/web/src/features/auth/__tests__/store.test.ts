import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore, getAccessToken } from '../store'

describe('auth/store', () => {
  beforeEach(() => {
    useAuthStore.getState().clear()
    if (typeof window !== 'undefined') {
      window.sessionStorage?.clear?.()
    }
  })

  it('starts logged out', () => {
    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.expiresAt).toBeNull()
  })

  it('setSession() persists user + token', () => {
    useAuthStore.getState().setSession({
      user: {
        id: 'u1',
        email: 'admin@mx.local',
        role: 'admin',
      },
      accessToken: 'tok-abc',
      expiresAt: 1000,
    })
    const s = useAuthStore.getState()
    expect(s.user?.email).toBe('admin@mx.local')
    expect(s.accessToken).toBe('tok-abc')
    expect(getAccessToken()).toBe('tok-abc')
  })

  it('setSession() clears the hydrating flag', () => {
    useAuthStore.getState().setHydrating(true)
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b', role: 'admin' },
      accessToken: 'tok',
      expiresAt: null,
    })
    expect(useAuthStore.getState().hydrating).toBe(false)
  })

  it('clear() drops user and token', () => {
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b', role: 'editor' },
      accessToken: 'tok',
      expiresAt: null,
    })
    useAuthStore.getState().clear()
    const s = useAuthStore.getState()
    expect(s.user).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('hydrating flag toggles independently', () => {
    useAuthStore.getState().setHydrating(true)
    expect(useAuthStore.getState().hydrating).toBe(true)
    useAuthStore.getState().setHydrating(false)
    expect(useAuthStore.getState().hydrating).toBe(false)
  })

  it('setUser() updates the user without touching the access token', () => {
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b', role: 'editor' },
      accessToken: 'tok-1',
      expiresAt: null,
    })
    useAuthStore.getState().setUser({ id: 'u1', email: 'a@b', role: 'admin' })
    const s = useAuthStore.getState()
    expect(s.user?.role).toBe('admin')
    expect(s.accessToken).toBe('tok-1')
  })

  it('setSession() with null token persists the cleared state', () => {
    useAuthStore.getState().setSession({ user: null, accessToken: null, expiresAt: null })
    expect(getAccessToken()).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('hydrating round-trip: true then session set flips to false', () => {
    useAuthStore.getState().setHydrating(true)
    expect(useAuthStore.getState().hydrating).toBe(true)
    useAuthStore.getState().setSession({
      user: { id: 'u1', email: 'a@b', role: 'admin' },
      accessToken: 'tok-2',
      expiresAt: null,
    })
    expect(useAuthStore.getState().hydrating).toBe(false)
    expect(useAuthStore.getState().user?.email).toBe('a@b')
  })
})
