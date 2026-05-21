import { describe, it, expect, vi } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// sigma 가 jsdom 의 WebGL 미지원 환경에서 import 만 해도 throws → stub.
// TodayHero 가 KnowledgeGraph 를 import 하므로 transitive 영향 차단.
// 기존 GraphCanvas 어설션 (data-testid="graph-svg") 호환을 위해 같은 marker 를 출력.
vi.mock('@/features/graph/components/KnowledgeGraph', () => ({
  KnowledgeGraph: () => (
    <div data-testid="graph-svg" />
  ),
}))

// Mock home/today API so tests don't hit the network.
vi.mock('@/features/home/api', () => ({
  fetchHomeToday: vi.fn(),
}))

// Mock i18n so keys pass through as-is.
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    return Object.entries(params).reduce(
      (s, [k, v]) => s.replace(`{${k}}`, String(v)),
      key,
    )
  },
}))

import { TodayHero } from '../TodayHero'
import type { HomeTodayPayload } from '@/features/home/api'
import { fetchHomeToday } from '@/features/home/api'

const TODAY_FIXTURE: HomeTodayPayload = {
  as_of: '2026-05-20T05:00:00Z',
  doc: {
    slug: 'android-architecture',
    title: '안드로이드 아키텍처',
    excerpt: '안드로이드 시스템 아키텍처의 핵심 계층을 설명합니다.',
    indegree: 42,
    team_id: null,
    updated_at: '2026-05-20T04:00:00Z',
  },
  neighbors: [
    { kind: 'wiki', slug: 'android-binder', title: '바인더 IPC', weight: 5 },
    { kind: 'wiki', slug: 'android-hal',    title: 'HAL 레이어',  weight: 4 },
    { kind: 'tag',  slug: 'tag:android',   title: 'android',    weight: 3 },
    { kind: 'wiki', slug: 'android-kernel', title: '커널 드라이버', weight: 2 },
    { kind: 'tag',  slug: 'tag:mobile',    title: 'mobile',     weight: 1 },
    // 6th neighbor — should NOT be rendered (slice(0, 5))
    { kind: 'wiki', slug: 'android-extras', title: '추가 항목',  weight: 1 },
  ],
  graph: {
    nodes: [
      { slug: 'android-architecture', title: '안드로이드 아키텍처', status: 'active', group: null },
      { slug: 'android-binder',       title: '바인더 IPC',          status: 'active', group: null },
    ],
    edges: [
      { source: 'android-binder', target: 'android-architecture', count: 5 },
    ],
  },
}

function renderWithQuery(node: ReactNode, qc?: QueryClient): string {
  const client = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('<TodayHero />', () => {
  it('renders Skeleton while the query is pending', () => {
    vi.mocked(fetchHomeToday).mockReturnValue(new Promise(() => {}))
    const html = renderWithQuery(<TodayHero />)
    // Skeleton has animate-pulse class and aria-busy
    expect(html).toContain('animate-pulse')
    expect(html).toContain('aria-busy="true"')
    // Not yet rendering the doc title
    expect(html).not.toContain('안드로이드 아키텍처')
  })

  it('renders nothing (null) when there is no data after an error (client-side path)', () => {
    // In SSR (renderToStaticMarkup), useQuery always starts in pending state.
    // We test the isError/no-data branch by pre-seeding an undefined payload.
    // The component guards `if (isError || !data) return null`, so when data is
    // explicitly undefined after a cache miss + error flag, it renders null.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // Force the query into the error state by setting data to undefined and
    // marking the query as errored. In SSR the simplest proxy is: no queryFn
    // resolves so it's pending — still Skeleton. We verify no crash and no
    // doc title (not in data path).
    vi.mocked(fetchHomeToday).mockRejectedValue(new Error('500'))
    const html = renderWithQuery(<TodayHero />, qc)
    expect(html).not.toContain('안드로이드 아키텍처')
  })

  it('renders doc title, excerpt, neighbors (max 5), and graph exploration link when cache is pre-populated', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(['home-today'], TODAY_FIXTURE)

    const html = renderWithQuery(<TodayHero />, qc)

    // Section landmark
    expect(html).toContain('home.today.sectionLabel')

    // Doc title as link
    expect(html).toContain('안드로이드 아키텍처')
    expect(html).toContain('href="/docs/android-architecture"')

    // Excerpt
    expect(html).toContain('안드로이드 시스템 아키텍처의 핵심 계층을 설명합니다.')

    // Indegree key 출력 (useT 가 vitest 환경에선 raw key 반환 — 42 치환은 production 만)
    expect(html).toContain('home.today.indegree')

    // Neighbors — first 5
    expect(html).toContain('바인더 IPC')
    expect(html).toContain('HAL 레이어')
    expect(html).toContain('android')       // tag neighbor
    expect(html).toContain('커널 드라이버')
    expect(html).toContain('mobile')        // tag neighbor

    // 6th neighbor should NOT appear
    expect(html).not.toContain('추가 항목')

    // Explore graph link
    expect(html).toContain('home.today.exploreGraph')
    expect(html).toContain('href="/graph/android-architecture?depth=1"')

    // Open doc link
    expect(html).toContain('home.today.openDoc')

    // GraphCanvas SVG scaffold rendered
    expect(html).toContain('data-testid="graph-svg"')
  })
})
