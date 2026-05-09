import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ActivityWidget } from '../ActivityWidget'
import type { ActivityEvent } from '../api'

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

const ev = (overrides: Partial<ActivityEvent>): ActivityEvent => ({
  id: 'evt-1',
  kind: 'comment_added',
  actor: { user_id: 'u1', name: '홍길동' },
  target: { document_id: 'd1', slug: 'foo', title: 'Foo 백서' },
  timestamp: new Date('2026-05-09T11:55:00Z').toISOString(),
  summary: '홍길동이 Foo 백서 에 댓글을 남겼습니다',
  metadata: {},
  ...overrides,
})

describe('<ActivityWidget />', () => {
  it('renders the empty state when no items', () => {
    const html = render(<ActivityWidget items={[]} />)
    expect(html).toContain('최근 활동이 없습니다')
    // Always shows "전체 보기" link to /activity.
    expect(html).toContain('href="/activity"')
  })

  it('renders the supplied items as event cards', () => {
    const items = [
      ev({ id: 'a', summary: '활동 A' }),
      ev({ id: 'b', summary: '활동 B' }),
    ]
    const html = render(<ActivityWidget items={items} />)
    expect(html).toContain('활동 A')
    expect(html).toContain('활동 B')
    // Each event renders inside a card with the data-testid hook.
    expect(html.match(/data-testid="activity-event-card"/g)?.length).toBe(2)
  })

  it('caps the visible list at `limit`', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      ev({ id: `e-${i}`, summary: `활동 ${i}` }),
    )
    const html = render(<ActivityWidget items={items} limit={3} />)
    expect(html).toContain('활동 0')
    expect(html).toContain('활동 1')
    expect(html).toContain('활동 2')
    expect(html).not.toContain('활동 3')
  })

  it('uses the supplied title in the heading', () => {
    const html = render(<ActivityWidget items={[]} title="시스템 활동" />)
    expect(html).toContain('시스템 활동')
  })

  it('links each event with a slug to /docs/<slug>', () => {
    const html = render(
      <ActivityWidget
        items={[ev({ id: 'a', target: { slug: 'month-end-closing', title: 't' } })]}
      />,
    )
    expect(html).toContain('href="/docs/month-end-closing"')
  })
})
