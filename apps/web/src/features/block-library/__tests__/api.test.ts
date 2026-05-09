import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createSnippet,
  deleteSnippet,
  getSnippet,
  listSnippets,
  patchSnippet,
  useSnippet,
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

describe('block-library/api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listSnippets passes params through and unwraps items', async () => {
    mockGet.mockResolvedValueOnce(
      envelope({ items: [{ id: 'a', name: 'A', use_count: 0 }] }),
    )
    const items = await listSnippets({ scope: 'team', q: 'foo', limit: 10, offset: 5 })
    expect(items).toEqual([{ id: 'a', name: 'A', use_count: 0 }])
    expect(mockGet).toHaveBeenCalledWith('/snippets', {
      params: { scope: 'team', q: 'foo', limit: 10, offset: 5 },
    })
  })

  it('listSnippets omits empty options', async () => {
    mockGet.mockResolvedValueOnce(envelope({ items: [] }))
    await listSnippets()
    expect(mockGet).toHaveBeenCalledWith('/snippets', { params: {} })
  })

  it('getSnippet encodes id', async () => {
    mockGet.mockResolvedValueOnce(
      envelope({
        id: 'abc',
        owner_user_id: 'u',
        scope: 'private',
        name: 'A',
        description: null,
        blocks: [{ type: 'paragraph', id: 'b', text: 'x' }],
        tags: [],
        use_count: 1,
        created_at: null,
        updated_at: null,
      }),
    )
    const got = await getSnippet('abc')
    expect(got.use_count).toBe(1)
    expect(mockGet).toHaveBeenCalledWith('/snippets/abc')
  })

  it('createSnippet returns snippet_id', async () => {
    mockPost.mockResolvedValueOnce(envelope({ snippet_id: 'new-id' }))
    const r = await createSnippet({
      name: 'X',
      blocks: [{ type: 'paragraph', id: 'b', text: 'hello' }],
      scope: 'private',
    })
    expect(r.snippet_id).toBe('new-id')
    expect(mockPost).toHaveBeenCalledWith('/snippets', {
      name: 'X',
      blocks: [{ type: 'paragraph', id: 'b', text: 'hello' }],
      scope: 'private',
    })
  })

  it('patchSnippet sends PATCH and returns full snippet', async () => {
    mockPatch.mockResolvedValueOnce(
      envelope({
        id: 'abc',
        owner_user_id: 'u',
        scope: 'org',
        name: 'after',
        description: null,
        blocks: [],
        tags: [],
        use_count: 2,
        created_at: null,
        updated_at: null,
      }),
    )
    const r = await patchSnippet('abc', { scope: 'org' })
    expect(r.scope).toBe('org')
    expect(mockPatch).toHaveBeenCalledWith('/snippets/abc', { scope: 'org' })
  })

  it('deleteSnippet hits DELETE', async () => {
    mockDelete.mockResolvedValueOnce({ data: { data: null, meta: {}, error: null } })
    await deleteSnippet('abc')
    expect(mockDelete).toHaveBeenCalledWith('/snippets/abc')
  })

  it('useSnippet bumps use_count via /use', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({ snippet_id: 'abc', use_count: 7 }),
    )
    const r = await useSnippet('abc')
    expect(r.use_count).toBe(7)
    expect(mockPost).toHaveBeenCalledWith('/snippets/abc/use')
  })
})
