/**
 * Sprint C-4 — getTermGraph + termGraphToKnowledge adapter unit tests.
 *
 * apiClient is mocked so these tests run without a live BE. The adapter is the
 * load-bearing piece: BE keys nodes by `id`, KnowledgeGraph keys by `slug`, so
 * a buggy mapping silently drops every edge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  getTermGraph,
  termGraphToKnowledge,
  type TermGraphPayload,
} from '../api'

const mockGet = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
}))

function envelope<T>(data: T) {
  return { data: { data, meta: {}, error: null } }
}

const PAYLOAD: TermGraphPayload = {
  center: {
    id: 't-center',
    label: '커널',
    type: 'term',
    domain: 'software',
  },
  nodes: [
    { id: 'd1', label: '리눅스 부팅', type: 'document', slug: 'linux-boot' },
    { id: 'd2', label: '스케줄러',     type: 'document', slug: 'scheduler' },
    { id: 't-co',  label: '프로세스', type: 'term', domain: 'software' },
  ],
  edges: [
    { source: 't-center', target: 'd1',   rel: 'referenced_in' },
    { source: 't-center', target: 'd2',   rel: 'referenced_in' },
    { source: 't-center', target: 't-co', rel: 'cooccurs_with' },
    { source: 't-center', target: 'd1',   rel: 'has_page' },
  ],
}

describe('glossary/api — getTermGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GETs /graph/terms/<id> and unwraps the envelope', async () => {
    mockGet.mockResolvedValueOnce(envelope(PAYLOAD))
    const data = await getTermGraph('t-center')
    expect(mockGet).toHaveBeenCalledWith('/graph/terms/t-center')
    expect(data.center.id).toBe('t-center')
    expect(data.nodes).toHaveLength(3)
    expect(data.edges).toHaveLength(4)
  })

  it('URL-encodes the term id (id contains slash/colon)', async () => {
    mockGet.mockResolvedValueOnce(envelope(PAYLOAD))
    await getTermGraph('weird/id:with')
    expect(mockGet).toHaveBeenCalledWith('/graph/terms/weird%2Fid%3Awith')
  })

  it('propagates ApiError when the envelope has a non-null error', async () => {
    mockGet.mockResolvedValueOnce({
      data: { data: null, error: { code: 'NOT_FOUND', message: 'term not found' } },
      status: 404,
    })
    await expect(getTermGraph('missing')).rejects.toThrow(/NOT_FOUND/)
  })
})

describe('glossary/api — termGraphToKnowledge adapter', () => {
  it('maps center term + doc + cooccur term to KnowledgeGraph node shape', () => {
    const out = termGraphToKnowledge(PAYLOAD)
    // 1 center term + 2 docs + 1 cooccur term = 4 nodes
    expect(out.nodes).toHaveLength(4)
    const kinds = out.nodes.map((n) => n.kind).sort()
    expect(kinds).toEqual(['doc', 'doc', 'term', 'term'])
    // center term keyed by namespaced slug `term:<id>`
    const center = out.nodes.find((n) => n.kind === 'term' && n.slug === 'term:t-center')
    expect(center).toBeTruthy()
    if (center && center.kind === 'term') {
      expect(center.name).toBe('커널')
      expect(center.domain).toBe('software')
    }
    // doc nodes keyed by raw slug (no namespace)
    expect(out.nodes.find((n) => n.kind === 'doc' && n.slug === 'linux-boot')).toBeTruthy()
  })

  it('maps rel → kind: referenced_in/has_page → term_doc, cooccurs_with → term_cooc', () => {
    const out = termGraphToKnowledge(PAYLOAD)
    // 3 term_doc (2 referenced_in + 1 has_page) + 1 term_cooc
    const counts = out.edges.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1
      return acc
    }, {})
    expect(counts.term_doc).toBe(3)
    expect(counts.term_cooc).toBe(1)
    // every edge endpoint resolves to a real node slug
    const slugSet = new Set(out.nodes.map((n) => n.slug))
    for (const e of out.edges) {
      expect(slugSet.has(e.source)).toBe(true)
      expect(slugSet.has(e.target)).toBe(true)
    }
  })

  it('skips edges whose endpoint id has no matching node (defensive)', () => {
    const payload: TermGraphPayload = {
      center: { id: 'c', label: 'C', type: 'term', domain: null },
      nodes: [{ id: 'd1', label: 'D1', type: 'document', slug: 'd1' }],
      edges: [
        { source: 'c', target: 'd1',     rel: 'referenced_in' }, // OK
        { source: 'c', target: 'ghost',  rel: 'referenced_in' }, // unknown id
      ],
    }
    const out = termGraphToKnowledge(payload)
    expect(out.edges).toHaveLength(1)
    expect(out.edges[0]!.target).toBe('d1')
  })

  it('handles an empty payload (no neighbours) — center only', () => {
    const empty: TermGraphPayload = {
      center: { id: 'lonely', label: '고립용어', type: 'term', domain: null },
      nodes: [],
      edges: [],
    }
    const out = termGraphToKnowledge(empty)
    expect(out.nodes).toHaveLength(1)
    expect(out.nodes[0]!.slug).toBe('term:lonely')
    expect(out.edges).toHaveLength(0)
  })
})
