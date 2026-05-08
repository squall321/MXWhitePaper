import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

import type { DocumentJSONV10 } from '@/types/document'

/**
 * PresenterView relies on:
 *   - react-router params  → MemoryRouter
 *   - useDocument          → mocked (no real fetch)
 *   - BroadcastChannel     → mocked global
 *
 * We SSR-render and assert structural / textual presence; the BroadcastChannel
 * happy path (post + receive) is exercised against the mock.
 */

// Mock useDocument so we don't reach the network. The mock returns the doc set
// in `docHolder.current` (or pending if null).
type DocResult = {
  data:
    | undefined
    | { document: DocumentJSONV10; row?: unknown; meta?: unknown }
  isPending: boolean
  isError: boolean
}
const docHolder: { current: DocResult | null } = { current: null }
vi.mock('@/features/document/hooks/useDocument', () => ({
  useDocument: () =>
    docHolder.current ?? { data: undefined, isPending: true, isError: false },
}))

// Capture every BroadcastChannel instance so the test can drive .postMessage
// and assert its history.
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  name: string
  posted: unknown[] = []
  listeners: Array<(ev: { data: unknown }) => void> = []
  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.instances.push(this)
  }
  postMessage(msg: unknown) {
    this.posted.push(msg)
    // Fan out to all instances of the SAME channel (tabs broadcast model).
    for (const inst of FakeBroadcastChannel.instances) {
      if (inst.name === this.name && inst !== this) {
        for (const l of inst.listeners) l({ data: msg })
      }
    }
  }
  addEventListener(_evt: string, cb: (ev: { data: unknown }) => void) {
    this.listeners.push(cb)
  }
  removeEventListener(_evt: string, cb: (ev: { data: unknown }) => void) {
    this.listeners = this.listeners.filter((l) => l !== cb)
  }
  close() {
    /* noop */
  }
}

const realBroadcastChannel = (globalThis as unknown as { BroadcastChannel?: unknown })
  .BroadcastChannel
beforeEach(() => {
  FakeBroadcastChannel.instances = []
  ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
    FakeBroadcastChannel
})
afterEach(() => {
  ;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel =
    realBroadcastChannel
})

// Import after the mock is registered.
import { PresenterViewPage } from '../PresenterView'
import { openPresenterChannel } from '../presenterChannel'

function makeDoc(): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01TESTDOC0000000000000000Z',
    slug: 'fixture',
    title: '발표자 뷰 테스트',
    summary: '요약',
    metadata: {
      division: 'MX',
      owners: ['x@example.com'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: '01SEC00000000000000000000A',
        number: '1',
        level: 1,
        title: '섹션 1',
        blocks: [
          { type: 'paragraph', id: '01P000000000000000000000A1', text: '본문 1' },
          {
            type: 'paragraph',
            id: '01P000000000000000000000A2',
            text: '발표 메모입니다',
            meta: { note: 'speaker:1' },
          },
        ],
        subsections: [],
      },
      {
        id: '01SEC00000000000000000000B',
        number: '2',
        level: 1,
        title: '섹션 2',
        blocks: [],
        subsections: [],
      },
    ],
  } as unknown as DocumentJSONV10
}

function render(node: ReactNode, initial = '/present/fixture/notes'): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/present/:slug/notes" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<PresenterViewPage />', () => {
  it('renders pending state when document is loading', () => {
    docHolder.current = null
    const html = render(<PresenterViewPage />)
    expect(html).toContain('불러오는 중')
  })

  it('renders current slide title and notes after load', () => {
    docHolder.current = {
      data: { document: makeDoc() },
      isPending: false,
      isError: false,
    }
    const html = render(<PresenterViewPage />)
    // Title slide is shown first.
    expect(html).toContain('발표자 뷰 테스트')
    expect(html).toContain('다음 슬라이드 미리보기')
    expect(html).toContain('발표자 메모')
  })

  it('shows "메모 없음" when current slide has no speaker notes', () => {
    docHolder.current = {
      data: { document: makeDoc() },
      isPending: false,
      isError: false,
    }
    const html = render(<PresenterViewPage />)
    // Title slide has no notes.
    expect(html).toContain('메모 없음')
  })
})

describe('presenterChannel BroadcastChannel happy path', () => {
  it('posts and receives messages between two channel handles', () => {
    const a = openPresenterChannel()
    const b = openPresenterChannel()
    const received: unknown[] = []
    const unsub = b.subscribe((msg) => received.push(msg))

    a.post({ index: 3, total: 7, ts: 12345 })
    expect(received).toEqual([{ index: 3, total: 7, ts: 12345 }])

    unsub()
    a.post({ index: 4, total: 7, ts: 22222 })
    // Unsubscribed: no further deliveries.
    expect(received).toHaveLength(1)

    a.close()
    b.close()
  })

  it('rejects malformed messages without crashing', () => {
    const a = openPresenterChannel()
    const b = openPresenterChannel()
    const received: unknown[] = []
    const unsub = b.subscribe((msg) => received.push(msg))

    // Drive a malformed payload through the underlying fake channel.
    const sender = FakeBroadcastChannel.instances[0]!
    sender.postMessage({ bogus: true })
    expect(received).toHaveLength(0)

    unsub()
    a.close()
    b.close()
  })
})
