import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  addSeriesItem,
  createSeries,
  deleteSeries,
  getSeries,
  listDocumentSeries,
  listSeries,
  patchSeries,
  removeSeriesItem,
  reorderSeriesItem,
} from '../api'

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockPatch = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

function envelope<T>(data: T) {
  return { data: { data, meta: {}, error: null } }
}

describe('series/api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listSeries unwraps the items array', async () => {
    mockGet.mockResolvedValueOnce(
      envelope({
        items: [
          {
            id: '1',
            slug: 's-1',
            title: 'A',
            description: null,
            cover_image_id: null,
            owner_user_id: 'u',
            created_at: null,
            updated_at: null,
            item_count: 2,
            first_item_title: 'first',
          },
        ],
      }),
    )
    const rows = await listSeries()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.slug).toBe('s-1')
    expect(mockGet).toHaveBeenCalledWith('/series')
  })

  it('getSeries encodes slug and unwraps detail', async () => {
    mockGet.mockResolvedValueOnce(
      envelope({
        id: '1',
        slug: 'a b',
        title: 'AB',
        description: null,
        cover_image_id: null,
        owner_user_id: 'u',
        created_at: null,
        updated_at: null,
        items: [],
      }),
    )
    const detail = await getSeries('a b')
    expect(detail.title).toBe('AB')
    expect(mockGet).toHaveBeenCalledWith('/series/a%20b')
  })

  it('createSeries POSTs the body and returns detail', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({
        id: '1',
        slug: 'new',
        title: 'New',
        description: 'd',
        cover_image_id: null,
        owner_user_id: 'u',
        created_at: null,
        updated_at: null,
        items: [],
      }),
    )
    const r = await createSeries({ slug: 'new', title: 'New', description: 'd' })
    expect(r.slug).toBe('new')
    expect(mockPost).toHaveBeenCalledWith('/series', {
      slug: 'new',
      title: 'New',
      description: 'd',
    })
  })

  it('patchSeries PATCHes', async () => {
    mockPatch.mockResolvedValueOnce(
      envelope({
        id: '1',
        slug: 's',
        title: 'T',
        description: null,
        cover_image_id: null,
        owner_user_id: 'u',
        created_at: null,
        updated_at: null,
        items: [],
      }),
    )
    await patchSeries('s', { title: 'T' })
    expect(mockPatch).toHaveBeenCalledWith('/series/s', { title: 'T' })
  })

  it('deleteSeries DELETEs', async () => {
    mockDelete.mockResolvedValueOnce({
      data: { data: null, meta: {}, error: null },
    })
    await deleteSeries('s')
    expect(mockDelete).toHaveBeenCalledWith('/series/s')
  })

  it('addSeriesItem omits position when undefined', async () => {
    mockPost.mockResolvedValueOnce(envelope({ items: [] }))
    await addSeriesItem('s', 'doc-uuid')
    expect(mockPost).toHaveBeenCalledWith('/series/s/items', {
      document_id: 'doc-uuid',
    })
  })

  it('addSeriesItem includes position when provided', async () => {
    mockPost.mockResolvedValueOnce(envelope({ items: [] }))
    await addSeriesItem('s', 'doc-uuid', 3)
    expect(mockPost).toHaveBeenCalledWith('/series/s/items', {
      document_id: 'doc-uuid',
      position: 3,
    })
  })

  it('removeSeriesItem hits DELETE with both ids encoded', async () => {
    mockDelete.mockResolvedValueOnce({
      data: { data: null, meta: {}, error: null },
    })
    await removeSeriesItem('s/x', 'd')
    expect(mockDelete).toHaveBeenCalledWith('/series/s%2Fx/items/d')
  })

  it('reorderSeriesItem PATCHes the position', async () => {
    mockPatch.mockResolvedValueOnce(envelope({ items: [] }))
    await reorderSeriesItem('s', 'd', 7)
    expect(mockPatch).toHaveBeenCalledWith('/series/s/items/d', { position: 7 })
  })

  it('listDocumentSeries calls /documents/:slug/series', async () => {
    mockGet.mockResolvedValueOnce(
      envelope({
        items: [
          {
            id: '1',
            slug: 'manual',
            title: 'Manual',
            description: null,
            cover_image_id: null,
            position: 1,
            total: 3,
            prev: { slug: 'a', title: 'A' },
            next: { slug: 'c', title: 'C' },
          },
        ],
      }),
    )
    const rows = await listDocumentSeries('doc-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.next?.slug).toBe('c')
    expect(mockGet).toHaveBeenCalledWith('/documents/doc-1/series')
  })
})
