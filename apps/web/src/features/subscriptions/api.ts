/**
 * Subscriptions API client (Cycle 0018).
 *
 * 미러: `apps/api/app/routers/subscriptions.py`. 일반 envelope `{data, meta}` 를
 * 풀어서 도메인 형으로 노출한다.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type SubscriptionEvent =
  | 'doc_edited'
  | 'comment_added'
  | 'review_decided'
  | 'doc_published'

export type DigestCadence = 'instant' | 'daily' | 'weekly'

export interface MySubscription {
  subscription_id: string
  document_id: string
  slug: string
  title: string
  last_edited_at: string | null
  events: SubscriptionEvent[]
  digest_cadence: DigestCadence
  last_digest_at: string | null
  created_at: string | null
}

export interface SubscriberRow {
  subscription_id: string
  user_id: string
  name: string | null
  email: string | null
  events: SubscriptionEvent[]
  digest_cadence: DigestCadence
  created_at: string | null
}

export interface SubscribeBody {
  events?: SubscriptionEvent[]
  digest_cadence?: DigestCadence
}

export async function subscribeDoc(
  slug: string,
  body: SubscribeBody = {},
): Promise<{ subscription_id: string }> {
  const res = await apiClient.post<ApiEnvelope<{ subscription_id: string }>>(
    `/documents/${encodeURIComponent(slug)}/subscribe`,
    body,
  )
  return unwrap(res)
}

export async function unsubscribeDoc(slug: string): Promise<void> {
  await apiClient.delete(`/documents/${encodeURIComponent(slug)}/subscribe`)
}

export async function listMySubscriptions(): Promise<MySubscription[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: MySubscription[] }>>(
    '/me/subscriptions',
  )
  return unwrap(res).items
}

export async function listSubscribers(slug: string): Promise<SubscriberRow[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: SubscriberRow[] }>>(
    `/documents/${encodeURIComponent(slug)}/subscribers`,
  )
  return unwrap(res).items
}

export async function patchSubscription(
  id: string,
  body: SubscribeBody,
): Promise<{
  id: string
  events: SubscriptionEvent[]
  digest_cadence: DigestCadence
}> {
  const res = await apiClient.patch<
    ApiEnvelope<{
      id: string
      events: SubscriptionEvent[]
      digest_cadence: DigestCadence
    }>
  >(`/subscriptions/${encodeURIComponent(id)}`, body)
  return unwrap(res)
}
