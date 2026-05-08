import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}))

vi.mock('@/features/notifications/store', () => ({
  pushNotification: vi.fn(),
}))

import { apiClient } from '@/lib/api/client'
import { uploadFile } from '../uploadFile'
import * as api from '../api'

// XHR is not available in node — stub the presigned PUT.
vi.spyOn(api, 'putToPresigned').mockImplementation(
  async (_url, _headers, _file, onProgress) => {
    onProgress?.(50)
    onProgress?.(100)
  },
)

const file = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', {
  type: 'application/pdf',
})

describe('uploadFile (generic)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls /files/presign-put → PUT → /files/finalize and returns the result', async () => {
    const post = apiClient.post as ReturnType<typeof vi.fn>
    post
      .mockResolvedValueOnce({
        data: {
          data: {
            file_id: '01HFILEPRESIGNULID00000000',
            key: '01HFILEPRESIGNULID00000000/doc.pdf',
            presigned_url: 'https://example/put',
            method: 'PUT',
            headers: { 'Content-Type': 'application/pdf' },
            expires_in: 300,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            file_id: '01HFILEPRESIGNULID00000000',
            filename: 'doc.pdf',
            size: 3,
            mime: 'application/pdf',
            download_url: 'https://example/get/doc.pdf',
          },
        },
      })

    const fractions: number[] = []
    const result = await uploadFile(file, {
      onProgress: (f) => fractions.push(f),
    })

    expect(result).toEqual({
      fileId: '01HFILEPRESIGNULID00000000',
      filename: 'doc.pdf',
      size: 3,
      mime: 'application/pdf',
      downloadUrl: 'https://example/get/doc.pdf',
    })
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]?.[0]).toBe('/files/presign-put')
    expect(post.mock.calls[0]?.[1]).toEqual({
      filename: 'doc.pdf',
      mime: 'application/pdf',
      size: 3,
    })
    expect(post.mock.calls[1]?.[0]).toBe('/files/finalize')
    expect(post.mock.calls[1]?.[1]).toEqual({
      file_id: '01HFILEPRESIGNULID00000000',
      filename: 'doc.pdf',
      mime: 'application/pdf',
      size: 3,
    })
    // Progress reported during PUT (0..1).
    expect(fractions[fractions.length - 1]).toBe(1)
    expect(api.putToPresigned).toHaveBeenCalledOnce()
  })

  it('throws a useful message on 422 size-too-big', async () => {
    const post = apiClient.post as ReturnType<typeof vi.fn>
    post.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'size exceeds FILE_MAX_BYTES (26214400)',
          },
        },
      },
      message: 'Request failed',
    })

    await expect(uploadFile(file)).rejects.toThrow(/size exceeds FILE_MAX_BYTES/)
  })

  it('throws on 429 rate-limit', async () => {
    const post = apiClient.post as ReturnType<typeof vi.fn>
    post.mockRejectedValueOnce({
      response: {
        status: 429,
        data: { error: { code: 'RATE_LIMITED', message: 'too many' } },
      },
      message: 'Request failed',
    })

    await expect(uploadFile(file)).rejects.toThrow(/잠시 후 다시 시도/)
  })

  it('rethrows network error from the presigned PUT', async () => {
    const post = apiClient.post as ReturnType<typeof vi.fn>
    post.mockResolvedValueOnce({
      data: {
        data: {
          file_id: '01HFILE2NETWORKFAIL000000A',
          key: '01HFILE2NETWORKFAIL000000A/x.pdf',
          presigned_url: 'https://example/put',
          headers: {},
        },
      },
    })

    const putSpy = api.putToPresigned as unknown as ReturnType<typeof vi.fn>
    putSpy.mockRejectedValueOnce(new Error('network down'))

    await expect(uploadFile(file)).rejects.toThrow(/network down|파일 업로드 실패/)
  })
})
