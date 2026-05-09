import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listDeliveries,
  listWebhooks,
  patchWebhook,
  testWebhook,
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

const SAMPLE = {
  id: 'a1',
  owner_user_id: 'u1',
  scope: 'user' as const,
  url: 'https://hooks.example.com',
  secret: '••••abcd',
  events: ['doc_edited'] as const,
  filter_part_ids: [],
  enabled: true,
  last_status: 'ok',
  last_attempted_at: null,
  created_at: null,
}

describe('webhooks/api', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listWebhooks unwraps items array', async () => {
    mockGet.mockResolvedValueOnce(envelope({ items: [SAMPLE] }))
    const rows = await listWebhooks()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('a1')
    expect(mockGet).toHaveBeenCalledWith('/webhooks')
  })

  it('getWebhook encodes id', async () => {
    mockGet.mockResolvedValueOnce(envelope(SAMPLE))
    const r = await getWebhook('a/b')
    expect(r.id).toBe('a1')
    expect(mockGet).toHaveBeenCalledWith('/webhooks/a%2Fb')
  })

  it('createWebhook POSTs the body and returns the row', async () => {
    mockPost.mockResolvedValueOnce(envelope({ ...SAMPLE, secret: 'plain' }))
    const r = await createWebhook({
      url: 'https://x',
      scope: 'user',
      events: ['doc_edited'],
    })
    expect(r.secret).toBe('plain')
    expect(mockPost).toHaveBeenCalledWith('/webhooks', {
      url: 'https://x',
      scope: 'user',
      events: ['doc_edited'],
    })
  })

  it('patchWebhook PATCHes', async () => {
    mockPatch.mockResolvedValueOnce(envelope({ ...SAMPLE, enabled: false }))
    const r = await patchWebhook('a1', { enabled: false })
    expect(r.enabled).toBe(false)
    expect(mockPatch).toHaveBeenCalledWith('/webhooks/a1', { enabled: false })
  })

  it('deleteWebhook DELETEs by id', async () => {
    mockDelete.mockResolvedValueOnce({
      data: { data: null, meta: {}, error: null },
    })
    await deleteWebhook('a1')
    expect(mockDelete).toHaveBeenCalledWith('/webhooks/a1')
  })

  it('testWebhook POSTs without event_kind when omitted', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({
        webhook_id: 'a1',
        http_status: 200,
        last_status: 'ok',
        response_body: '',
      }),
    )
    const r = await testWebhook('a1')
    expect(r.last_status).toBe('ok')
    expect(mockPost).toHaveBeenCalledWith('/webhooks/a1/test', {})
  })

  it('testWebhook POSTs event_kind when provided', async () => {
    mockPost.mockResolvedValueOnce(
      envelope({
        webhook_id: 'a1',
        http_status: 200,
        last_status: 'ok',
        response_body: '',
      }),
    )
    await testWebhook('a1', 'comment_added')
    expect(mockPost).toHaveBeenCalledWith('/webhooks/a1/test', {
      event_kind: 'comment_added',
    })
  })

  it('listDeliveries adds limit query', async () => {
    mockGet.mockResolvedValueOnce(envelope({ items: [] }))
    await listDeliveries('a1', 5)
    expect(mockGet).toHaveBeenCalledWith('/webhooks/a1/deliveries?limit=5')
  })

  it('listDeliveries returns []  on missing items', async () => {
    mockGet.mockResolvedValueOnce(envelope({}))
    const r = await listDeliveries('a1')
    expect(r).toEqual([])
  })
})
