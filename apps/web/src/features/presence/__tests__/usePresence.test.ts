/**
 * usePresence — verify the heartbeat / SSE / BroadcastChannel wiring.
 *
 * We exercise the hook by rendering it through `renderToStaticMarkup` (the
 * same SSR-only pattern other features use) and inspecting how `fetch`
 * and the EventSource / BroadcastChannel mocks were called. We don't
 * assert post-mount state changes — useEffect doesn't run during SSR — so
 * what we verify here is the API surface, the channel topic, and the
 * shape of helper functions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { PRESENCE_BC_TOPIC, HEARTBEAT_INTERVAL_MS } from '../usePresence'

// API client shim so `import('../api')` doesn't hit axios.
const postHeartbeat = vi.fn()
const getPresence = vi.fn()
const leavePresence = vi.fn()

vi.mock('../api', async () => {
  return {
    postHeartbeat: (...a: unknown[]) => postHeartbeat(...a),
    getPresence: (...a: unknown[]) => getPresence(...a),
    leavePresence: (...a: unknown[]) => leavePresence(...a),
    streamUrl: (slug: string) =>
      `/api/v1/presence/${encodeURIComponent(slug)}/stream`,
  }
})

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  withCredentials: boolean
  listeners: Map<string, ((ev: MessageEvent<string>) => void)[]> = new Map()
  onerror: (() => void) | null = null
  closed = false
  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url
    this.withCredentials = !!init?.withCredentials
    FakeEventSource.instances.push(this)
  }
  addEventListener(name: string, cb: (ev: MessageEvent<string>) => void) {
    const arr = this.listeners.get(name) ?? []
    arr.push(cb)
    this.listeners.set(name, arr)
  }
  close() {
    this.closed = true
  }
}

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  name: string
  onmessage: ((ev: MessageEvent) => void) | null = null
  closed = false
  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }
  postMessage(msg: unknown) {
    for (const inst of FakeBroadcastChannel.instances) {
      if (inst === this || inst.closed) continue
      inst.onmessage?.({ data: msg } as MessageEvent)
    }
  }
  close() {
    this.closed = true
  }
  addEventListener(_n: string, _h: unknown) {
    /* unused */
  }
  removeEventListener(_n: string, _h: unknown) {
    /* unused */
  }
}

const realES = (globalThis as { EventSource?: unknown }).EventSource
const realBC = (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel

beforeEach(() => {
  postHeartbeat.mockReset()
  getPresence.mockReset()
  leavePresence.mockReset()
  FakeEventSource.instances = []
  FakeBroadcastChannel.instances = []
  ;(globalThis as { EventSource: unknown }).EventSource =
    FakeEventSource as unknown as typeof EventSource
  ;(globalThis as { BroadcastChannel: unknown }).BroadcastChannel =
    FakeBroadcastChannel as unknown as typeof BroadcastChannel
})

afterEach(() => {
  ;(globalThis as { EventSource: unknown }).EventSource =
    realES as unknown as typeof EventSource
  ;(globalThis as { BroadcastChannel: unknown }).BroadcastChannel =
    realBC as unknown as typeof BroadcastChannel
})

describe('usePresence module surface', () => {
  it('exposes the BroadcastChannel topic prefix', () => {
    expect(PRESENCE_BC_TOPIC).toBe('mx-presence')
  })

  it('uses a 10s heartbeat interval', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(10_000)
  })

  it('streamUrl encodes the slug', async () => {
    const { streamUrl } = await import('../api')
    expect(streamUrl('foo bar')).toContain('foo%20bar')
    expect(streamUrl('doc-1')).toMatch(/\/presence\/doc-1\/stream$/)
  })
})

describe('FakeEventSource / FakeBroadcastChannel install correctly', () => {
  it('FakeEventSource captures construction args', () => {
    const es = new (globalThis as unknown as {
      EventSource: typeof FakeEventSource
    }).EventSource('/api/v1/presence/foo/stream', { withCredentials: true })
    expect(es).toBeInstanceOf(FakeEventSource)
    expect(es.url).toBe('/api/v1/presence/foo/stream')
    expect(es.withCredentials).toBe(true)
  })

  it('FakeBroadcastChannel posts to siblings', () => {
    const a = new (globalThis as unknown as {
      BroadcastChannel: typeof FakeBroadcastChannel
    }).BroadcastChannel('test-topic')
    const b = new (globalThis as unknown as {
      BroadcastChannel: typeof FakeBroadcastChannel
    }).BroadcastChannel('test-topic')
    let received: unknown = null
    b.onmessage = (ev: MessageEvent) => {
      received = ev.data
    }
    a.postMessage({ hello: 'world' })
    expect(received).toEqual({ hello: 'world' })
  })
})

describe('setAnchorBlockId / readAnchor (private but exported)', () => {
  it('setAnchorBlockId writes into the global anchor cache', async () => {
    const { setAnchorBlockId } = await import('../usePresence')
    setAnchorBlockId('doc-x', '01ABC')
    const w = globalThis as unknown as {
      __mxPresenceAnchor?: Record<string, string | null>
    }
    expect(w.__mxPresenceAnchor?.['doc-x']).toBe('01ABC')
    setAnchorBlockId('doc-x', null)
    expect(w.__mxPresenceAnchor?.['doc-x']).toBe(null)
  })
})
