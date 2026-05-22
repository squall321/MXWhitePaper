import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  createTriple,
  deleteTriple,
  extractBulk,
  fetchTriples,
} from '../triplesApi'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

function envelope<T>(data: T) {
  return { data: { data, meta: {}, error: null } }
}

const sampleTriple = {
  id: 't1',
  subject_slug: 'a',
  predicate: '에서_사용된다',
  object_slug: 'b',
  source: 'manual' as const,
  confidence: null,
  created_by: 'u1',
  created_at: null,
}

describe('graph/triplesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetchTriples GETs /triples with no params by default', async () => {
    mockGet.mockResolvedValueOnce(envelope([sampleTriple]))
    const rows = await fetchTriples()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.predicate).toBe('에서_사용된다')
    expect(mockGet).toHaveBeenCalledWith('/triples', { params: {} })
  })

  it('fetchTriples forwards filter params', async () => {
    mockGet.mockResolvedValueOnce(envelope([]))
    await fetchTriples({ subject: 'a', source: 'llm' })
    expect(mockGet).toHaveBeenCalledWith('/triples', {
      params: { subject: 'a', source: 'llm' },
    })
  })

  it('createTriple POSTs the body and unwraps the triple', async () => {
    mockPost.mockResolvedValueOnce(envelope(sampleTriple))
    const r = await createTriple({
      subject_slug: 'a',
      predicate: '에서_사용된다',
      object_slug: 'b',
    })
    expect(r.id).toBe('t1')
    expect(mockPost).toHaveBeenCalledWith('/triples', {
      subject_slug: 'a',
      predicate: '에서_사용된다',
      object_slug: 'b',
    })
  })

  it('deleteTriple DELETEs with the id encoded', async () => {
    mockDelete.mockResolvedValueOnce(
      envelope({ id: 't/x', deleted: true }),
    )
    await deleteTriple('t/x')
    expect(mockDelete).toHaveBeenCalledWith('/triples/t%2Fx')
  })

  it('extractBulk POSTs to /triples/extract/bulk and unwraps the result', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({
        documents: 3,
        stored: 7,
        replaced: 2,
        results: [],
        source: 'llm',
      }),
    )
    const r = await extractBulk({})
    expect(r.documents).toBe(3)
    expect(r.stored).toBe(7)
    expect(r.replaced).toBe(2)
    expect(mockPost).toHaveBeenCalledWith('/triples/extract/bulk', {})
  })

  it('extractBulk forwards an optional slugs/domain body', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({
        documents: 1,
        stored: 1,
        replaced: 0,
        results: [],
        source: 'llm',
      }),
    )
    await extractBulk({ domain: 'physics', slugs: ['a'] })
    expect(mockPost).toHaveBeenCalledWith('/triples/extract/bulk', {
      domain: 'physics',
      slugs: ['a'],
    })
  })
})
