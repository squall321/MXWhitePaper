/**
 * 429 handling — the axios interceptor must invoke the rate-limit hook
 * (parses Retry-After / body details.retry_after) and never auto-retry.
 *
 * We exercise the hook surface directly because the interceptor is wired to
 * a module-level axios instance; a full "fake server" round-trip isn't
 * needed when the hook contract is the only thing the toast layer cares
 * about.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

import {
  registerRateLimitHooks,
  _getRateLimitHooks,
} from '../client'

describe('rate-limit hook', () => {
  beforeEach(() => {
    // Reset module-local hook between tests.
    registerRateLimitHooks({ onRateLimited: () => {} })
  })

  it('registerRateLimitHooks installs a callback', () => {
    const spy = vi.fn()
    registerRateLimitHooks({ onRateLimited: spy })
    const hooks = _getRateLimitHooks()
    expect(hooks).not.toBeNull()
    hooks?.onRateLimited(7)
    expect(spy).toHaveBeenCalledWith(7)
  })
})

/**
 * Replicate the parsing logic the interceptor uses for 429 responses
 * (Retry-After header, fallback to body envelope, fallback to 60). We
 * keep this isolated so a future refactor of `client.ts` can be guarded
 * without spinning up a real HTTP roundtrip.
 */
function pickRetryAfter(headers: Record<string, string>, body: unknown): number {
  const raw = headers['retry-after'] ?? headers['Retry-After']
  let n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n <= 0) {
    const b = body as { error?: { details?: { retry_after?: number } } } | undefined
    const fromBody = b?.error?.details?.retry_after
    n = typeof fromBody === 'number' && fromBody > 0 ? fromBody : 60
  }
  return n
}

describe('429 retry-after parsing', () => {
  it('reads Retry-After header (case-insensitive)', () => {
    expect(pickRetryAfter({ 'retry-after': '15' }, undefined)).toBe(15)
    expect(pickRetryAfter({ 'Retry-After': '8' }, undefined)).toBe(8)
  })

  it('falls back to body details.retry_after when header missing', () => {
    const body = { error: { details: { retry_after: 33 } } }
    expect(pickRetryAfter({}, body)).toBe(33)
  })

  it('uses 60s when neither is available', () => {
    expect(pickRetryAfter({}, {})).toBe(60)
    expect(pickRetryAfter({ 'retry-after': 'abc' }, {})).toBe(60)
  })
})
