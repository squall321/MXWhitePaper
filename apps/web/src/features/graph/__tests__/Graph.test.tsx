import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { GraphCanvas } from '@/pages/Graph'
import type { GraphEdge, GraphNode } from '../api'

/**
 * The pure rendering layer (`GraphCanvas`) is what we test here. It runs the
 * d3-force simulation only inside `useEffect`, which is skipped by SSR — the
 * resulting markup is the static SVG scaffold (`<g class="links" />` +
 * `<g class="nodes" />`), which is what we assert. The simulation logic and
 * pan/zoom handlers are tested by their callers (e2e + manual smoke).
 */
const NODES: GraphNode[] = [
  { slug: 'a', title: 'Alpha', status: 'active', group: null },
  { slug: 'b', title: 'Bravo', status: 'active', group: null },
  { slug: 'c', title: 'Charlie', status: 'active', group: null },
  { slug: 'd', title: 'Delta', status: 'missing', group: null },
  { slug: 'e', title: 'Echo', status: 'active', group: null },
]

const EDGES: GraphEdge[] = [
  { source: 'a', target: 'b', count: 1 },
  { source: 'a', target: 'c', count: 2 },
  { source: 'b', target: 'd', count: 1 },
  { source: 'c', target: 'e', count: 3 },
]

describe('<GraphCanvas />', () => {
  it('renders an SVG scaffold with links + nodes groups for a 5-node fixture', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GraphCanvas nodes={NODES} edges={EDGES} />
      </MemoryRouter>,
    )
    expect(html).toContain('data-testid="graph-svg"')
    expect(html).toContain('class="links"')
    expect(html).toContain('class="nodes"')
    expect(html).toContain('viewBox="0 0 800 600"')
  })

  it('does not crash when given an empty graph', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <GraphCanvas nodes={[]} edges={[]} />
      </MemoryRouter>,
    )
    expect(html).toContain('data-testid="graph-svg"')
  })
})
