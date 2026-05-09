import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import { listActivity, listMyActivity } from '../api'

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

const sampleEvent = {
  id: 'comment:abc',
  kind: 'comment_added',
  actor: { user_id: 'u1', name: '홍길동' },
  target: { document_id: 'd1', slug: 'foo', title: 'Foo' },
  timestamp: '2026-05-09T12:00:00Z',
  summary: '홍길동이 Foo 에 댓글을 남겼습니다',
  metadata: { anchor_kind: 'document', anchor_id: null },
}

describe('activity/api · listActivity()', () => {
  it('returns the items array from a healthy envelope', async () => {
    get.mockResolvedValueOnce({
      data: { data: { items: [sampleEvent] }, meta: { count: 1 } },
    })
    const r = await listActivity({ limit: 10 })
    expect(r).toEqual([sampleEvent])
    expect(get).toHaveBeenCalledWith('/activity', {
      params: { since: undefined, limit: 10, kind: undefined },
    })
  })

  it('joins kind array into a CSV query param', async () => {
    get.mockResolvedValueOnce({ data: { data: { items: [] } } })
    await listActivity({ kind: ['doc_edited', 'comment_added'] })
    expect(get).toHaveBeenCalledWith(
      '/activity',
      expect.objectContaining({
        params: expect.objectContaining({ kind: 'doc_edited,comment_added' }),
      }),
    )
  })

  it('returns [] when the BE 404s (e.g. cold start)', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(listActivity()).resolves.toEqual([])
  })

  it('returns [] when envelope.data is missing', async () => {
    get.mockResolvedValueOnce({ data: {} })
    await expect(listActivity()).resolves.toEqual([])
  })

  it('returns [] when items is not an array', async () => {
    get.mockResolvedValueOnce({ data: { data: { items: null } } })
    await expect(listActivity()).resolves.toEqual([])
  })

  it('forwards `since` and `limit` to the request', async () => {
    get.mockResolvedValueOnce({ data: { data: { items: [] } } })
    await listActivity({ since: '2026-05-01T00:00:00Z', limit: 25 })
    expect(get).toHaveBeenCalledWith(
      '/activity',
      expect.objectContaining({
        params: expect.objectContaining({
          since: '2026-05-01T00:00:00Z',
          limit: 25,
        }),
      }),
    )
  })
})

describe('activity/api · listMyActivity()', () => {
  it('hits the /activity/me endpoint', async () => {
    get.mockResolvedValueOnce({ data: { data: { items: [sampleEvent] } } })
    const r = await listMyActivity()
    expect(r).toEqual([sampleEvent])
    expect(get).toHaveBeenCalledWith('/activity/me', expect.any(Object))
  })

  it('returns [] on network failure', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(listMyActivity()).resolves.toEqual([])
  })
})
