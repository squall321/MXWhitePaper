/**
 * Webhooks API client — talks to the FastAPI webhooks router
 * (`/webhooks`, `/webhooks/:id`, `/webhooks/:id/test`,
 *  `/webhooks/:id/deliveries`).
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type WebhookEventKind =
  | 'doc_created'
  | 'doc_edited'
  | 'doc_published'
  | 'comment_added'
  | 'review_decided'

export const ALL_WEBHOOK_EVENTS: WebhookEventKind[] = [
  'doc_created',
  'doc_edited',
  'doc_published',
  'comment_added',
  'review_decided',
]

export type WebhookScope = 'user' | 'org'

export interface Webhook {
  id: string
  owner_user_id: string
  scope: WebhookScope
  url: string
  /** Masked (e.g. `••••••••abcd`) on every read after creation. */
  secret: string
  events: WebhookEventKind[]
  filter_part_ids: string[]
  enabled: boolean
  last_status: string | null
  last_attempted_at: string | null
  created_at: string | null
}

export interface WebhookDelivery {
  id: string
  event_kind: string
  http_status: number | null
  response_body: string | null
  attempted_at: string | null
  retry_count: number
}

export interface CreateWebhookIn {
  url: string
  scope: WebhookScope
  events: WebhookEventKind[]
  filter_part_ids?: string[]
}

export interface PatchWebhookIn {
  url?: string
  events?: WebhookEventKind[]
  filter_part_ids?: string[]
  enabled?: boolean
}

export interface TestWebhookResult {
  webhook_id: string
  http_status: number | null
  last_status: string
  response_body: string | null
}

export async function listWebhooks(): Promise<Webhook[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: Webhook[] }>>('/webhooks')
  return unwrap(res).items ?? []
}

export async function getWebhook(id: string): Promise<Webhook> {
  const res = await apiClient.get<ApiEnvelope<Webhook>>(
    `/webhooks/${encodeURIComponent(id)}`,
  )
  return unwrap(res)
}

export async function createWebhook(body: CreateWebhookIn): Promise<Webhook> {
  const res = await apiClient.post<ApiEnvelope<Webhook>>('/webhooks', body)
  return unwrap(res)
}

export async function patchWebhook(
  id: string,
  body: PatchWebhookIn,
): Promise<Webhook> {
  const res = await apiClient.patch<ApiEnvelope<Webhook>>(
    `/webhooks/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteWebhook(id: string): Promise<void> {
  await apiClient.delete(`/webhooks/${encodeURIComponent(id)}`)
}

export async function testWebhook(
  id: string,
  eventKind?: WebhookEventKind,
): Promise<TestWebhookResult> {
  const body = eventKind ? { event_kind: eventKind } : {}
  const res = await apiClient.post<ApiEnvelope<TestWebhookResult>>(
    `/webhooks/${encodeURIComponent(id)}/test`,
    body,
  )
  return unwrap(res)
}

export async function listDeliveries(
  id: string,
  limit = 20,
): Promise<WebhookDelivery[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: WebhookDelivery[] }>>(
    `/webhooks/${encodeURIComponent(id)}/deliveries?limit=${limit}`,
  )
  return unwrap(res).items ?? []
}
