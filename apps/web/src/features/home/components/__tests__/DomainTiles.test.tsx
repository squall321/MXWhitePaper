import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Mock the home API so tests don't hit the network.
vi.mock('@/features/home/api', () => ({
  fetchHomeHero: vi.fn(),
}))

// Mock the graph API (used for prefetch — SSR won't invoke it).
vi.mock('@/features/graph/api', () => ({
  fetchGraph: vi.fn(),
}))

// Mock i18n so keys pass through as-is (avoids setting up SettingsStore).
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    return Object.entries(params).reduce(
      (s, [k, v]) => s.replace(`{${k}}`, String(v)),
      key,
    )
  },
}))

// Mock @mx/shared/super-domains — returns the real fixture inline.
vi.mock('@mx/shared/super-domains', () => ({
  SUPER_DOMAINS: [
    { id: 'mobile',   label: 'Mobile',   emoji: '📱', tags: ['mobile'],   paletteVar: '--graph-domain-mobile' },
    { id: 'software', label: 'Software', emoji: '💻', tags: ['software'], paletteVar: '--graph-domain-software' },
    { id: 'hardware', label: 'Hardware', emoji: '🔧', tags: ['semiconductor'], paletteVar: '--graph-domain-hardware' },
    { id: 'telecom',  label: 'Telecom',  emoji: '📡', tags: ['telecom'],  paletteVar: '--graph-domain-telecom' },
  ],
}))

import { DomainTiles } from '../DomainTiles'
import type { HomeHeroPayload } from '@/features/home/api'
import { fetchHomeHero } from '@/features/home/api'

const HERO_FIXTURE: HomeHeroPayload = {
  as_of: '2026-05-20T05:00:00Z',
  domains: [
    {
      id: 'mobile',
      doc_count: 72,
      doc_count_7d_ago: 60,
      trend_7d: [60, 63, 65, 67, 69, 71, 72],
      top_docs: [
        { slug: 'android', title: '안드로이드', indegree: 28 },
        { slug: 'galaxy',  title: '갤럭시',   indegree: 21 },
        { slug: 'ios',     title: 'iOS',      indegree: 17 },
      ],
    },
  ],
}

function renderWithQuery(node: ReactNode, qc?: QueryClient): string {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<DomainTiles />', () => {
  it('returns nothing (null) when the query is still pending (SSR / no data)', () => {
    // fetchHomeHero is mocked but never resolves during SSR — useQuery stays
    // in the pending state and DomainTiles renders null.
    vi.mocked(fetchHomeHero).mockReturnValue(new Promise(() => {}))
    const html = renderWithQuery(<DomainTiles />)
    expect(html).toBe('')
  })

  it('renders domain tiles when cache is pre-populated', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Pre-seed the query cache so useQuery resolves immediately on first render.
    qc.setQueryData(['home-hero'], HERO_FIXTURE)

    const html = renderWithQuery(<DomainTiles />, qc)

    // Section landmark
    expect(html).toContain('home.domain.sectionLabel')
    // Domain tile link → /graph?domain=mobile
    expect(html).toContain('href="/graph?domain=mobile"')
    // h3 label key
    expect(html).toContain('home.domain.mobile')
    // doc count
    expect(html).toContain('72 docs')
    // Sparkline rendered
    expect(html).toContain('<svg')
    // Delta rendered (72-60=12 > 0)
    expect(html).toContain('+12')
    // top_docs links
    expect(html).toContain('href="/docs/android"')
    expect(html).toContain('안드로이드')
    // scope hint
    expect(html).toContain('home.hero.scopeHint')
  })

  it('compact variant: renders chip row, hides top_docs, shows small sparkline', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['home-hero'], HERO_FIXTURE)

    const html = renderWithQuery(<DomainTiles variant="compact" />, qc)

    // Section landmark still present
    expect(html).toContain('home.domain.sectionLabel')
    // Link still navigates to graph
    expect(html).toContain('href="/graph?domain=mobile"')
    // Domain label key present
    expect(html).toContain('home.domain.mobile')
    // Doc count present
    expect(html).toContain('72')
    // Sparkline rendered (compact size 40x16)
    expect(html).toContain('<svg')
    // Delta present (72-60=12)
    expect(html).toContain('+12')
    // top_docs must NOT appear in compact mode
    expect(html).not.toContain('href="/docs/android"')
    expect(html).not.toContain('안드로이드')
    // scopeHint not shown in compact mode
    expect(html).not.toContain('home.hero.scopeHint')
  })
})
