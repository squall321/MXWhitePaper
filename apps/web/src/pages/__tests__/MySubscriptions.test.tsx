import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MySubscription } from '@/features/subscriptions/api'

vi.mock('@/features/subscriptions/api', () => ({
  listMySubscriptions: vi.fn(async () => [] as MySubscription[]),
  subscribeDoc: vi.fn(),
  unsubscribeDoc: vi.fn(),
  patchSubscription: vi.fn(),
}))

import { MySubscriptionsPage } from '../MySubscriptions'

function render(seed: MySubscription[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['subscriptions', 'me'], seed)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/subscriptions']}>
        <MySubscriptionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<MySubscriptionsPage />', () => {
  it('renders the empty state when there are no rows', () => {
    const html = render([])
    expect(html).toContain('내 팔로잉')
    expect(html).toContain('data-testid="my-subscriptions-empty"')
  })

  it('renders one row per followed doc with cadence + events', () => {
    const html = render([
      {
        subscription_id: 'sub-1',
        document_id: 'doc-1',
        slug: 'alpha',
        title: 'Alpha doc',
        last_edited_at: '2026-05-08T01:00:00Z',
        events: ['doc_edited', 'comment_added'],
        digest_cadence: 'daily',
        last_digest_at: null,
        created_at: '2026-05-01T00:00:00Z',
      },
      {
        subscription_id: 'sub-2',
        document_id: 'doc-2',
        slug: 'beta',
        title: 'Beta doc',
        last_edited_at: null,
        events: ['doc_published'],
        digest_cadence: 'instant',
        last_digest_at: null,
        created_at: null,
      },
    ])
    expect(html).toContain('Alpha doc')
    expect(html).toContain('Beta doc')
    expect(html).toContain('data-testid="my-subscription-row"')
    expect(html).toContain('data-testid="my-subscription-cadence"')
    expect(html).toContain('data-testid="my-subscription-unfollow"')
    // event badges are rendered
    expect(html).toContain('수정')
    expect(html).toContain('댓글')
    expect(html).toContain('발행')
  })
})
