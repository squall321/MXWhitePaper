import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn() },
}))

import { apiClient } from '@/lib/api/client'
import {
  getBacklinks,
  getDocument,
  listDocuments,
  checkDocumentExists,
} from '../api'

const get = apiClient.get as unknown as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('document/api · listDocuments()', () => {
  it('returns the bare data array', async () => {
    get.mockResolvedValueOnce({
      data: { data: [{ id: '1', slug: 'a', title: 'A' }] },
    })
    const list = await listDocuments({ limit: 5 })
    expect(list).toEqual([{ id: '1', slug: 'a', title: 'A' }])
  })

  it('returns [] when BE returns a missing data envelope', async () => {
    get.mockResolvedValueOnce({ data: {} })
    await expect(listDocuments()).resolves.toEqual([])
  })

  it('returns [] on 404', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(listDocuments()).resolves.toEqual([])
  })
})

describe('document/api · getDocument()', () => {
  it('pulls content out of the row + carries meta', async () => {
    const content = { id: '01HX', title: 'Doc' }
    get.mockResolvedValueOnce({
      data: {
        data: { id: 'doc1', slug: 's', title: 'Doc', content },
        meta: { etag: 'W/"abc-1"', version: 1 },
      },
    })
    const r = await getDocument('s')
    expect(r.document).toEqual(content)
    expect(r.row.id).toBe('doc1')
    expect(r.meta.etag).toBe('W/"abc-1"')
  })

  it('throws when the envelope reports an error', async () => {
    get.mockResolvedValueOnce({
      data: {
        data: undefined,
        error: { code: 'NOT_FOUND', message: '문서 없음' },
      },
    })
    await expect(getDocument('missing')).rejects.toThrow(/NOT_FOUND/)
  })
})

describe('document/api · getBacklinks()', () => {
  it('returns items + targetExists from meta', async () => {
    get.mockResolvedValueOnce({
      data: {
        data: [{ slug: 'a', title: 'A', sections_referenced: 1 }],
        meta: { total: 1, target_exists: true },
      },
    })
    const r = await getBacklinks('s')
    expect(r.items).toHaveLength(1)
    expect(r.targetExists).toBe(true)
  })

  it('treats 404 as a missing target (no items)', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
    const r = await getBacklinks('missing')
    expect(r.items).toEqual([])
    expect(r.targetExists).toBe(false)
  })

  it('treats 5xx as transient — items empty but target assumed alive', async () => {
    get.mockRejectedValueOnce({ response: { status: 500 } })
    const r = await getBacklinks('s')
    expect(r.items).toEqual([])
    expect(r.targetExists).toBe(true)
  })
})

describe('document/api · checkDocumentExists()', () => {
  it('returns true when the doc resolves', async () => {
    get.mockResolvedValueOnce({
      data: { data: { id: 'd1', slug: 'a', title: 'A', content: { id: 'x' } } },
    })
    await expect(checkDocumentExists('a')).resolves.toBe(true)
  })

  it('returns false on 404', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(checkDocumentExists('missing')).resolves.toBe(false)
  })

  it('returns true on network/5xx (don\'t paint everything red)', async () => {
    get.mockRejectedValueOnce({ response: { status: 502 } })
    await expect(checkDocumentExists('flaky')).resolves.toBe(true)
  })
})
