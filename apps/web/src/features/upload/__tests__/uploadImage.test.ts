import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Mock the API surface so the orchestration logic can be tested in
 * isolation. We don't pull in jsdom; instead we hand-roll the mocks against
 * the same module names the orchestrator imports.
 */
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}))

import { apiClient } from '@/lib/api/client'
import { uploadImage } from '../uploadImage'
import * as api from '../api'

// Stub out the presigned PUT — XHR isn't available in node.
vi.spyOn(api, 'putToPresigned').mockImplementation(
  async (_url, _headers, _file, onProgress) => {
    onProgress?.(50)
    onProgress?.(100)
  },
)

const file = (() => {
  const data = new Uint8Array([1, 2, 3, 4, 5])
  // `File` is available in node >= 20 under `globalThis.File`. Fall back to
  // a Blob with the minimum surface uploadImage needs.
  const f = new File([data], 'test.png', { type: 'image/png' })
  return f
})()

describe('uploadImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('short-circuits when /init returns a deduped record', async () => {
    const post = apiClient.post as ReturnType<typeof vi.fn>
    // BE contract (Sprint 5/6): dedupe path returns deduped:true with the
    // image fields at the top level.
    post.mockResolvedValueOnce({
      data: {
        data: {
          deduped: true,
          image_id: 'img-existing',
          image_uuid: 'uuid-existing',
          urls: { thumb: '/t', view: '/v', orig: '/o' },
        },
      },
    })

    const stages: string[] = []
    const result = await uploadImage(file, {
      onProgress: (s) => stages.push(s),
    })

    expect(result.image_id).toBe('img-existing')
    expect(post).toHaveBeenCalledOnce() // only /init, no /finalize
    expect(post.mock.calls[0]?.[0]).toBe('/uploads/image/init')
    expect(api.putToPresigned).not.toHaveBeenCalled()
    // Hashing always runs; dedupe path then jumps straight to finalizing.
    expect(stages).toContain('hashing')
    expect(stages).toContain('finalizing')
  })

  it('accepts a raw Blob (re-encoded crop variant)', async () => {
    const post = apiClient.post as ReturnType<typeof vi.fn>
    post
      .mockResolvedValueOnce({
        data: {
          data: {
            deduped: false,
            uploadId: 'u-blob',
            method: 'PUT',
            url: 'https://example/put',
            headers: {},
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            image_id: 'img-from-blob',
            urls: { thumb: '/t', view: '/v', orig: '/o' },
            deduped: false,
          },
        },
      })

    const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'image/png' })
    const result = await uploadImage(blob, { filename: 'crop-1.png' })

    expect(result.image_id).toBe('img-from-blob')
    // Filename was synthesized from opts.filename and forwarded to /init.
    const initBody = post.mock.calls[0]?.[1] as { filename?: string; mime_type?: string }
    expect(initBody?.filename).toBe('crop-1.png')
    expect(initBody?.mime_type).toBe('image/png')
  })

  it('runs init → PUT → finalize on a normal upload', async () => {
    const post = apiClient.post as ReturnType<typeof vi.fn>
    post
      .mockResolvedValueOnce({
        data: {
          data: {
            deduped: false,
            uploadId: 'u2',
            method: 'PUT',
            url: 'https://example/put',
            headers: { 'Content-Type': 'image/png' },
            expiresIn: 600,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            image_id: 'img-new',
            image_uuid: 'uuid-new',
            urls: { thumb: '/t', view: '/v', orig: '/o' },
            width: 200,
            height: 100,
            dominant_color: '#123456',
            deduped: false,
          },
        },
      })

    const result = await uploadImage(file)

    expect(result.image_id).toBe('img-new')
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]?.[0]).toBe('/uploads/image/init')
    expect(post.mock.calls[1]?.[0]).toBe('/uploads/image/finalize')
    // Finalize must use camelCase per BE contract.
    expect(post.mock.calls[1]?.[1]).toEqual({ uploadId: 'u2' })
    expect(api.putToPresigned).toHaveBeenCalledOnce()
  })
})
