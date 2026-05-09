import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the activity API so tests don't need axios. The page imports both
// `listActivity` and `listMyActivity`; we mock both with deterministic data.
vi.mock('@/features/activity/api', async () => {
  const actual = await vi.importActual<typeof import('@/features/activity/api')>(
    '@/features/activity/api',
  )
  return {
    ...actual,
    listActivity: vi.fn().mockResolvedValue([
      {
        id: 'comment:1',
        kind: 'comment_added',
        actor: { user_id: 'u1', name: '홍길동' },
        target: { document_id: 'd1', slug: 'foo', title: 'Foo' },
        timestamp: new Date().toISOString(),
        summary: '홍길동이 Foo 에 댓글을 남겼습니다',
        metadata: {},
      },
    ]),
    listMyActivity: vi.fn().mockResolvedValue([]),
  }
})

import { ActivityFeedPage } from '../ActivityFeed'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<ActivityFeedPage />', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the page header + filter chips', () => {
    const html = render(<ActivityFeedPage />)
    expect(html).toContain('활동 피드')
    // SSR markup doesn't include the post-fetch list, but the chip row is
    // synchronous so we can check it.
    expect(html).toContain('전체')
    expect(html).toContain('내 활동')
    expect(html).toContain('댓글')
    expect(html).toContain('편집')
    expect(html).toContain('승인')
  })

  it('exposes the chip role=tab buttons with matching test ids', () => {
    const html = render(<ActivityFeedPage />)
    expect(html).toContain('data-testid="activity-chip-all"')
    expect(html).toContain('data-testid="activity-chip-mine"')
    expect(html).toContain('data-testid="activity-chip-comments"')
    expect(html).toContain('data-testid="activity-chip-edits"')
    expect(html).toContain('data-testid="activity-chip-approvals"')
  })

  it('shows the loading state on the first SSR render', () => {
    // Tanstack Query is pending on first render in SSR, so we expect the
    // spinner copy rather than the list / empty state.
    const html = render(<ActivityFeedPage />)
    expect(html).toContain('불러오는 중')
  })
})
