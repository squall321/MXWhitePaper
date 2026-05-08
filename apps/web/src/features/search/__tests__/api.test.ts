import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import { searchDocuments, listWidgets } from '../api'

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('search/api · searchDocuments()', () => {
  it('returns [] for an empty / whitespace query without hitting the API', async () => {
    await expect(searchDocuments(' ')).resolves.toEqual([])
    expect(get).not.toHaveBeenCalled()
  })

  it('returns hits when the BE returns an array envelope', async () => {
    get.mockResolvedValueOnce({
      data: { data: [{ slug: 'a', title: 'A' }], meta: { total: 1, took_ms: 4 } },
    })
    const r = await searchDocuments('a')
    expect(r).toEqual([{ slug: 'a', title: 'A' }])
  })

  it('returns [] on 404 (failed index)', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(searchDocuments('q')).resolves.toEqual([])
  })

  it('returns [] when envelope.data is missing', async () => {
    get.mockResolvedValueOnce({ data: {} })
    await expect(searchDocuments('q')).resolves.toEqual([])
  })
})

describe('search/api · listWidgets()', () => {
  it('returns the registry list', async () => {
    get.mockResolvedValueOnce({
      data: { data: [{ type: 'kpi-cards', name: 'KPI' }] },
    })
    await expect(listWidgets()).resolves.toEqual([
      { type: 'kpi-cards', name: 'KPI' },
    ])
  })

  it('returns [] on 404 (registry not yet seeded)', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(listWidgets()).resolves.toEqual([])
  })
})
