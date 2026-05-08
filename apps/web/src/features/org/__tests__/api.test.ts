import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import { getOrgTree } from '../api'

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('org/api · getOrgTree() — envelope hardening', () => {
  it('unwraps `{data: {divisions: [...]}}` (the historical mismatch the user hit)', async () => {
    get.mockResolvedValueOnce({
      data: { data: { divisions: [{ id: 'd1', slug: 'mx', name: 'MX', teams: [] }] } },
    })
    await expect(getOrgTree()).resolves.toEqual([
      { id: 'd1', slug: 'mx', name: 'MX', teams: [] },
    ])
  })

  it('returns [] when the BE shipped a bare array (defensive)', async () => {
    get.mockResolvedValueOnce({ data: { data: [] } })
    await expect(getOrgTree()).resolves.toEqual([])
  })

  it('returns [] on 404', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(getOrgTree()).resolves.toEqual([])
  })

  it('returns [] when data is missing entirely', async () => {
    get.mockResolvedValueOnce({ data: {} })
    await expect(getOrgTree()).resolves.toEqual([])
  })

  it('throws an ApiError for 5xx', async () => {
    get.mockRejectedValueOnce({ response: { status: 503 } })
    await expect(getOrgTree()).rejects.toBeInstanceOf(Error)
  })
})
