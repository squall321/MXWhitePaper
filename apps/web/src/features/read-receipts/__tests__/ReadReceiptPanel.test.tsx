/**
 * ReadReceiptPanel — happy path SSR smoke tests.
 *
 * The panel uses tanstack-query; we pre-populate the cache so the SSR snapshot
 * skips the loading branch and renders the row list / "전체 보기" button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReadReceipt } from '../api'

vi.mock('../api', async () => {
  const real = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...real,
    listReadReceipts: vi.fn(async () => [] as ReadReceipt[]),
    remindReader: vi.fn(),
    ackRead: vi.fn(),
  }
})

import { ReadReceiptPanel, readReceiptsKey } from '../ReadReceiptPanel'

function renderWith(items: ReadReceipt[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(readReceiptsKey('alpha'), items)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <ReadReceiptPanel slug="alpha" />
    </QueryClientProvider>,
  )
}

const READER_A: ReadReceipt = {
  user_id: 'u-a',
  name: '김리뷰',
  email: 'a@mx.local',
  last_read_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  read_seconds: 120,
  acknowledged_at: null,
  comment: null,
}
const READER_B: ReadReceipt = {
  user_id: 'u-b',
  name: '박확인',
  email: 'b@mx.local',
  last_read_at: new Date(Date.now() - 30 * 60_000).toISOString(),
  read_seconds: 200,
  acknowledged_at: new Date(Date.now() - 15 * 60_000).toISOString(),
  comment: 'LGTM',
}

describe('<ReadReceiptPanel />', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders empty state when no readers', () => {
    const html = renderWith([])
    expect(html).toContain('data-testid="read-receipt-panel"')
    expect(html).toContain('data-testid="read-receipt-empty"')
    expect(html).toContain('아직 이 문서를 열람한 사람이 없습니다')
  })

  it('renders rows with name + relative time + ack indicator', () => {
    const html = renderWith([READER_A, READER_B])
    expect(html).toContain('data-testid="read-receipt-panel"')
    // Both rows present with their user-id testids.
    expect(html).toContain('data-testid="read-receipt-row-u-a"')
    expect(html).toContain('data-testid="read-receipt-row-u-b"')
    // B is acked → ✅ rendered, A is not.
    expect(html).toContain('data-testid="read-receipt-acked-u-b"')
    expect(html).not.toContain('data-testid="read-receipt-acked-u-a"')
    // data-acked attr matches.
    expect(html).toMatch(/data-testid="read-receipt-row-u-a"[^>]*data-acked="false"/)
    expect(html).toMatch(/data-testid="read-receipt-row-u-b"[^>]*data-acked="true"/)
    // Name present.
    expect(html).toContain('김리뷰')
    expect(html).toContain('박확인')
  })

  it('shows "전체 보기" button when there are readers', () => {
    const html = renderWith([READER_A])
    expect(html).toContain('data-testid="read-receipt-show-all"')
    expect(html).toContain('전체 보기')
  })

  it('does not show "전체 보기" on empty state', () => {
    const html = renderWith([])
    expect(html).not.toContain('data-testid="read-receipt-show-all"')
  })

  it('renders the count badge in the header', () => {
    const html = renderWith([READER_A, READER_B])
    expect(html).toContain('읽은 사람 (2)')
  })
})
