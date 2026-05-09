import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MySubscription } from '../api'

const state = {
  rows: [] as MySubscription[],
}

vi.mock('@/features/subscriptions/api', () => ({
  listMySubscriptions: vi.fn(async () => state.rows),
  subscribeDoc: vi.fn(async () => ({ subscription_id: 'sub-1' })),
  unsubscribeDoc: vi.fn(async () => undefined),
  patchSubscription: vi.fn(async () => ({
    id: 'sub-1',
    events: ['doc_edited'],
    digest_cadence: 'daily',
  })),
}))

import { FollowButton } from '../FollowButton'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['subscriptions', 'me'], state.rows)
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

describe('<FollowButton />', () => {
  beforeEach(() => {
    state.rows = []
  })

  it('renders the not-following button by default', () => {
    const html = render(<FollowButton slug="alpha" />)
    expect(html).toContain('data-testid="follow-button"')
    expect(html).toContain('data-following="false"')
    expect(html).toContain('팔로우')
  })

  it('flips to "following" state when the cache shows a row for the slug', () => {
    state.rows = [
      {
        subscription_id: 'sub-1',
        document_id: 'doc-uuid',
        slug: 'alpha',
        title: 'Alpha',
        last_edited_at: null,
        events: ['doc_edited'],
        digest_cadence: 'instant',
        last_digest_at: null,
        created_at: null,
      },
    ]
    const html = render(<FollowButton slug="alpha" />)
    expect(html).toContain('data-following="true"')
    expect(html).toContain('팔로잉')
    expect(html).toContain('aria-pressed="true"')
  })

  it('renders the options trigger button (⋯)', () => {
    const html = render(<FollowButton slug="alpha" />)
    expect(html).toContain('data-testid="follow-options"')
  })
})
