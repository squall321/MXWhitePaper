import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import { listNotifications, markNotificationRead } from '../api'

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>
const post = apiClient.post as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

const sampleRow = {
  id: '11111111-1111-1111-1111-111111111111',
  user_id: '22222222-2222-2222-2222-222222222222',
  kind: 'comment_mention',
  payload: { slug: 'alpha', from_user_id: 'u-1' },
  read_at: null,
  created_at: '2026-05-25T10:00:00Z',
}

describe('notifications/api · listNotifications()', () => {
  it('returns the data array from the envelope', async () => {
    get.mockResolvedValueOnce({
      data: { data: [sampleRow], meta: { count: 1, unread: 1 } },
    })
    const r = await listNotifications({ limit: 10 })
    expect(r).toEqual([sampleRow])
    expect(get).toHaveBeenCalledWith('/notifications?limit=10')
  })

  it('passes unread=true when requested', async () => {
    get.mockResolvedValueOnce({ data: { data: [] } })
    await listNotifications({ unread: true, limit: 20 })
    expect(get).toHaveBeenCalledWith('/notifications?unread=true&limit=20')
  })

  it('hits /notifications with no query string when no params', async () => {
    get.mockResolvedValueOnce({ data: { data: [] } })
    await listNotifications()
    expect(get).toHaveBeenCalledWith('/notifications')
  })

  it('returns [] when data is missing', async () => {
    get.mockResolvedValueOnce({ data: {} })
    await expect(listNotifications()).resolves.toEqual([])
  })

  it('returns [] when data is not an array', async () => {
    get.mockResolvedValueOnce({ data: { data: null } })
    await expect(listNotifications()).resolves.toEqual([])
  })
})

describe('notifications/api · markNotificationRead()', () => {
  it('POSTs to /notifications/:id/read with the encoded id', async () => {
    post.mockResolvedValueOnce({ status: 204, data: undefined })
    await markNotificationRead('abc/def')
    expect(post).toHaveBeenCalledWith('/notifications/abc%2Fdef/read')
  })
})
