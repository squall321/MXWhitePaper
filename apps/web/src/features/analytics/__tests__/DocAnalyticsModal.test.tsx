import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/features/analytics/api', () => ({
  getDocAnalytics: () =>
    Promise.resolve({
      slug: 'cae',
      title: 'CAE Intro',
      total_views: 42,
      unique_readers: 7,
      avg_read_seconds: 90,
      median_read_seconds: 60,
      last_30_days: Array.from({ length: 30 }, (_, i) => ({
        date: `2026-04-${String(i + 1).padStart(2, '0')}`,
        views: i,
      })),
      top_referrers: [
        { kind: 'wiki-link', count: 12 },
        { kind: 'search', count: 4 },
      ],
      section_attention: [
        {
          section_id: '01H...A',
          section_title: '1 개요',
          est_seconds_per_visitor: 45,
        },
      ],
    }),
}))

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rcr-stub">{children}</div>
    ),
  }
})

import { DocAnalyticsModal } from '../DocAnalyticsModal'

function render(node: React.ReactNode): string {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>{node}</QueryClientProvider>,
  )
}

describe('<DocAnalyticsModal />', () => {
  it('renders the heading when open', () => {
    const html = render(
      <DocAnalyticsModal slug="cae" open={true} onClose={() => {}} />,
    )
    expect(html).toContain('문서 통계')
    expect(html).toContain('doc-analytics-modal')
  })

  it('does not render content when closed (drawer collapsed)', () => {
    const html = render(
      <DocAnalyticsModal slug="cae" open={false} onClose={() => {}} />,
    )
    // Drawer renders a hidden shell — section labels should not appear.
    expect(html).not.toContain('섹션별 체류 시간')
  })
})
