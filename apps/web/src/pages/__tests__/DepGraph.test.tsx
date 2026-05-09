import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// Stub the dep-graph API so the page doesn't hit the network during SSR
// rendering. This mirrors the AdminDashboard test pattern.
vi.mock('@/features/dep-graph/api', () => ({
  fetchDepGraph: () =>
    Promise.resolve({
      nodes: [
        { slug: 'root', title: 'Root', count_in: 1, count_out: 2 },
        { slug: 'leaf', title: 'Leaf', count_in: 1, count_out: 0 },
      ],
      edges: [{ from: 'root', to: 'leaf', count: 1 }],
    }),
  fetchOrphans: () => Promise.resolve([]),
}))

import { DepGraphCanvas, DepGraphPage } from '@/pages/DepGraph'
import type { DepGraphEdge, DepGraphNode } from '@/features/dep-graph/api'

const NODES: DepGraphNode[] = [
  { slug: 'root', title: 'Root', count_in: 0, count_out: 2 },
  { slug: 'a', title: 'Alpha', count_in: 1, count_out: 0 },
  { slug: 'b', title: 'Bravo', count_in: 1, count_out: 0 },
]
const EDGES: DepGraphEdge[] = [
  { from: 'root', to: 'a', count: 1 },
  { from: 'root', to: 'b', count: 2 },
]

function withProviders(node: React.ReactNode, search = '') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[search ? `/dep-graph${search}` : '/dep-graph']}
      >
        {node}
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('<DepGraphCanvas />', () => {
  it('renders an SVG scaffold for a small fixture', () => {
    const html = renderToStaticMarkup(
      withProviders(
        <DepGraphCanvas nodes={NODES} edges={EDGES} rootSlug="root" />,
      ),
    )
    expect(html).toContain('data-testid="dep-graph-svg"')
    expect(html).toContain('class="links"')
    expect(html).toContain('class="nodes"')
    expect(html).toContain('viewBox="0 0 800 600"')
  })

  it('does not crash with an empty graph', () => {
    const html = renderToStaticMarkup(
      withProviders(
        <DepGraphCanvas nodes={[]} edges={[]} rootSlug="x" />,
      ),
    )
    expect(html).toContain('data-testid="dep-graph-svg"')
  })
})

describe('<DepGraphPage />', () => {
  it('renders the search prompt when no root is provided', () => {
    const html = renderToStaticMarkup(withProviders(<DepGraphPage />))
    expect(html).toContain('data-testid="dep-graph-page"')
    expect(html).toContain('data-testid="dep-graph-root-input"')
    // No canvas yet — root not set.
    expect(html).not.toContain('data-testid="dep-graph-svg"')
  })

  it('renders the sidebar with depth slider', () => {
    const html = renderToStaticMarkup(withProviders(<DepGraphPage />))
    expect(html).toContain('data-testid="dep-graph-sidebar"')
    expect(html).toContain('data-testid="dep-graph-depth-slider"')
    expect(html).toContain('data-testid="dep-graph-orphans-toggle"')
  })

  it('shows the root context line when root is set in the URL', () => {
    const html = renderToStaticMarkup(
      withProviders(<DepGraphPage />, '?root=onboarding'),
    )
    expect(html).toContain('루트: onboarding')
  })
})
