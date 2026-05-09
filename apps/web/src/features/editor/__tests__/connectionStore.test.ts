import { describe, it, expect, beforeEach } from 'vitest'
import { useConnectionStore, CONNECTION_THRESHOLDS } from '../connectionStore'

describe('editor/connectionStore', () => {
  beforeEach(() => {
    useConnectionStore.getState().reset()
  })

  it('starts online with no pending mutations and no ping', () => {
    const s = useConnectionStore.getState()
    expect(s.online).toBe(true)
    expect(s.pendingMutations).toBe(0)
    expect(s.lastPing).toBeNull()
  })

  it('setOnline(false) flips offline without touching lastPing', () => {
    useConnectionStore.setState({ lastPing: 12345 })
    useConnectionStore.getState().setOnline(false)
    const s = useConnectionStore.getState()
    expect(s.online).toBe(false)
    expect(s.lastPing).toBe(12345)
  })

  it('setOnline(true) refreshes lastPing on the positive transition', () => {
    const before = Date.now()
    useConnectionStore.getState().setOnline(true)
    const after = Date.now()
    const ping = useConnectionStore.getState().lastPing
    expect(ping).not.toBeNull()
    expect(ping!).toBeGreaterThanOrEqual(before)
    expect(ping!).toBeLessThanOrEqual(after)
  })

  it('bumpPending(+N) accumulates and never goes negative', () => {
    const { bumpPending } = useConnectionStore.getState()
    bumpPending(2)
    bumpPending(3)
    expect(useConnectionStore.getState().pendingMutations).toBe(5)
    bumpPending(-100) // overshoot
    expect(useConnectionStore.getState().pendingMutations).toBe(0)
  })

  it('bumpPending(-N) decrements but clamps at zero', () => {
    const { bumpPending } = useConnectionStore.getState()
    bumpPending(4)
    bumpPending(-1)
    expect(useConnectionStore.getState().pendingMutations).toBe(3)
  })

  it('reset() returns the store to a known online-clean snapshot', () => {
    useConnectionStore.setState({
      online: false,
      lastPing: 999,
      pendingMutations: 7,
    })
    useConnectionStore.getState().reset()
    const s = useConnectionStore.getState()
    expect(s.online).toBe(true)
    expect(s.lastPing).toBeNull()
    expect(s.pendingMutations).toBe(0)
  })

  it('exposes documented heartbeat thresholds', () => {
    expect(CONNECTION_THRESHOLDS.HEARTBEAT_MS).toBe(30_000)
    expect(CONNECTION_THRESHOLDS.STALE_PING_MS).toBe(60_000)
  })
})
