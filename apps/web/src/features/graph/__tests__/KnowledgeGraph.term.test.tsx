/**
 * Sprint C-4 — KnowledgeGraph accepts term nodes + term_doc/term_cooc edges.
 *
 * sigma.js touches `WebGL2RenderingContext` at module load — undefined under
 * jsdom. We mock the sigma + @sigma/node-border modules so the import chain
 * resolves without WebGL. The useEffect that builds sigma never runs under
 * SSR so the mocks are never actually called.
 *
 * What we verify:
 *   1. component renders without crashing when given term-kind nodes/edges
 *   2. height + style props reach the outer container
 *   3. exported `KnowledgeGraphEdgeKind` includes the C-4 additions
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Stub sigma so its WebGL-touching module load is a no-op.
vi.mock('sigma', () => ({
  Sigma: class {},
}))
vi.mock('@sigma/node-border', () => ({
  createNodeBorderProgram: () => class {},
}))

import { KnowledgeGraph, type KnowledgeGraphEdgeKind } from '../components/KnowledgeGraph'
import type { GraphEdge, GraphNode } from '../api'

describe('<KnowledgeGraph /> — term node support (Sprint C-4)', () => {
  it('renders the SSR scaffold when given term nodes + term edges', () => {
    const nodes: GraphNode[] = [
      { kind: 'term', slug: 'term:t1', name: '커널', domain: 'software' },
      { kind: 'doc', slug: 'linux-boot', title: '리눅스 부팅', status: 'active', group: null },
      { kind: 'term', slug: 'term:t2', name: '프로세스', domain: 'software' },
    ]
    const edges: GraphEdge[] = [
      { kind: 'term_doc', source: 'term:t1', target: 'linux-boot' },
      { kind: 'term_cooc', source: 'term:t1', target: 'term:t2' },
    ]
    const html = renderToStaticMarkup(
      <KnowledgeGraph
        nodes={nodes}
        edges={edges}
        edgeKinds={new Set<KnowledgeGraphEdgeKind>(['term_doc', 'term_cooc'])}
      />,
    )
    // Outer div with default height + dark background style.
    expect(html).toContain('height:640px')
    expect(html).toContain('background:#0f172a')
  })

  it('accepts onPickTerm prop without crashing (callback shape contract)', () => {
    const html = renderToStaticMarkup(
      <KnowledgeGraph
        nodes={[{ kind: 'term', slug: 'term:x', name: '용어', domain: null }]}
        edges={[]}
        onPickTerm={() => {
          /* sigma click handler — never fires in SSR */
        }}
      />,
    )
    expect(html).toContain('rounded')
  })

  it('exported KnowledgeGraphEdgeKind type accepts the C-4 additions', () => {
    // Type-level guard — wrong type fails at compile time.
    const ok: KnowledgeGraphEdgeKind[] = [
      'wiki',
      'doc_tag',
      'tag_cooc',
      'term_doc',
      'term_cooc',
    ]
    expect(ok).toHaveLength(5)
  })

  it('honours custom height + edgeKinds props', () => {
    const html = renderToStaticMarkup(
      <KnowledgeGraph
        nodes={[]}
        edges={[]}
        height={420}
        edgeKinds={new Set<KnowledgeGraphEdgeKind>(['term_doc'])}
      />,
    )
    expect(html).toContain('height:420px')
  })
})
