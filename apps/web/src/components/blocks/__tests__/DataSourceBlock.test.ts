import { describe, it, expect } from 'vitest'
import { derivePollingConfig } from '../DataSourceBlock'

/**
 * M1 — verify `block.refreshInterval` (seconds) actually drives the
 * react-query polling cadence. The pure helper isolates the math from
 * the component so we don't need to mount + spy on useQuery.
 */
describe('derivePollingConfig — refreshInterval drives polling', () => {
  it('refreshInterval=300 → refetchInterval 300_000ms, staleTime 299_000ms', () => {
    const c = derivePollingConfig(300, true)
    expect(c.intervalMs).toBe(300_000)
    expect(c.refetchInterval).toBe(300_000)
    expect(c.staleTime).toBe(299_000)
  })

  it('refreshInterval unset → default 60_000ms', () => {
    const c = derivePollingConfig(undefined, true)
    expect(c.refetchInterval).toBe(60_000)
    expect(c.staleTime).toBe(59_000)
  })

  it('enabled=false (no endpoint) disables polling', () => {
    const c = derivePollingConfig(300, false)
    expect(c.refetchInterval).toBe(false)
  })
})
