import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: { post: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import { importDocx } from '../api'

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('import/api · importDocx()', () => {
  it('returns document + summary on success', async () => {
    post.mockResolvedValueOnce({
      data: {
        data: {
          document: { schema_version: '1.0', slug: 't', title: 'T' },
          summary: {
            paragraphs: 5, headings: 1, tables: 2, images: 3, equations: 0,
            lists: 0, code_blocks: 0, footnotes: 0, warnings: [],
          },
        },
      },
    })
    const file = new File(['fake'], 'x.docx', { type: 'application/octet-stream' })
    const r = await importDocx(file, { slug: 'test', title: 'Test' })
    expect(r.document.slug).toBe('t')
    expect(r.summary.tables).toBe(2)
    expect(post).toHaveBeenCalledTimes(1)
    const call = post.mock.calls[0]!
    const url = call[0]
    const form = call[1]
    expect(url).toBe('/imports/docx')
    // FormData has the slug we passed
    expect((form as FormData).get('slug')).toBe('test')
    expect((form as FormData).get('title')).toBe('Test')
  })

  it('throws when envelope is empty', async () => {
    post.mockResolvedValueOnce({ data: { data: undefined } })
    const file = new File(['fake'], 'x.docx', { type: 'application/octet-stream' })
    await expect(importDocx(file)).rejects.toThrow(/비어/)
  })

  it('propagates 422 from server', async () => {
    post.mockRejectedValueOnce({
      response: { status: 422, data: { error: { code: 'VALIDATION_ERROR' } } },
    })
    const file = new File(['fake'], 'x.docx', { type: 'application/octet-stream' })
    await expect(importDocx(file)).rejects.toMatchObject({
      response: { status: 422 },
    })
  })

  it('reports progress when given onProgress', async () => {
    post.mockImplementationOnce((_url, _data, opts) => {
      const onUploadProgress = opts?.onUploadProgress as
        | ((e: { loaded: number; total?: number }) => void)
        | undefined
      onUploadProgress?.({ loaded: 5, total: 10 })
      onUploadProgress?.({ loaded: 10, total: 10 })
      return Promise.resolve({
        data: {
          data: {
            document: { schema_version: '1.0', slug: 'x', title: 'X' },
            summary: {
              paragraphs: 0, headings: 0, tables: 0, images: 0, equations: 0,
              lists: 0, code_blocks: 0, footnotes: 0, warnings: [],
            },
          },
        },
      })
    })
    const seen: number[] = []
    const file = new File(['fake'], 'x.docx', { type: 'application/octet-stream' })
    await importDocx(file, { onProgress: (p) => seen.push(p) })
    expect(seen).toEqual([0.5, 1])
  })
})
