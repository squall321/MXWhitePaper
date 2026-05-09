import { describe, it, expect, vi } from 'vitest'
import { registerServiceWorker } from '../swRegistration'

/**
 * Helper: build the smallest pair of stubs the helper needs. The helper
 * only reads `navigator.serviceWorker.register`, so we hand it a recording
 * spy and assert on its calls.
 */
function makeStubs() {
  const register = vi.fn().mockResolvedValue({})
  const navigator = {
    serviceWorker: { register } as unknown as ServiceWorkerContainer,
  }
  // The helper hangs the register call off of `load`. We capture the
  // listener so the test can fire it synchronously.
  let loadHandler: (() => void) | null = null
  const win = {
    addEventListener: ((evt: string, cb: () => void) => {
      if (evt === 'load') loadHandler = cb
    }) as Window['addEventListener'],
  }
  return { register, navigator, win, fireLoad: () => loadHandler?.() }
}

describe('registerServiceWorker()', () => {
  it('skips registration in dev mode', () => {
    const { register, navigator, win } = makeStubs()
    const ok = registerServiceWorker({ isDev: true, navigator, win })
    expect(ok).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('skips when navigator.serviceWorker is missing', () => {
    const { register } = makeStubs()
    const ok = registerServiceWorker({
      isDev: false,
      navigator: { serviceWorker: undefined },
      win: { addEventListener: () => {} } as unknown as { addEventListener: Window['addEventListener'] },
    })
    expect(ok).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('skips when window is missing (SSR)', () => {
    const { register, navigator } = makeStubs()
    const ok = registerServiceWorker({
      isDev: false,
      navigator,
      win: undefined,
    })
    expect(ok).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('registers /service-worker.js after the load event fires', () => {
    const { register, navigator, win, fireLoad } = makeStubs()
    const ok = registerServiceWorker({ isDev: false, navigator, win })
    expect(ok).toBe(true)
    // Defers until `load` — should not have been called yet.
    expect(register).not.toHaveBeenCalled()
    fireLoad()
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/service-worker.js')
  })

  it('respects a custom scriptUrl override', () => {
    const { register, navigator, win, fireLoad } = makeStubs()
    registerServiceWorker({
      isDev: false,
      navigator,
      win,
      scriptUrl: '/sw-test.js',
    })
    fireLoad()
    expect(register).toHaveBeenCalledWith('/sw-test.js')
  })

  it('does not throw when register() rejects', async () => {
    const register = vi.fn().mockRejectedValue(new Error('boom'))
    const navigator = {
      serviceWorker: { register } as unknown as ServiceWorkerContainer,
    }
    let loadHandler: (() => void) | null = null
    const win = {
      addEventListener: ((evt: string, cb: () => void) => {
        if (evt === 'load') loadHandler = cb
      }) as Window['addEventListener'],
    }
    registerServiceWorker({ isDev: false, navigator, win })
    expect(() => loadHandler?.()).not.toThrow()
    // Let the rejection settle so the catch handler runs without blowing
    // up the test runner.
    await Promise.resolve()
  })
})
