/**
 * Notifications API client.
 *
 * Mirrors `apps/api/app/routers/notifications.py` — BE 가 push 한 알림
 * (멘션 / 리뷰 요청 / 리뷰 결정 / 반응 / 읽음 확인 요청 / 리마인더 등) 을
 * polling 으로 가져와서 FE store 로 흘려보낸다.
 *
 * Envelope `{data, meta}` 를 풀고, 서버 row 의 raw 모양을
 * `NotificationServerItem` 으로 노출.
 */
import { apiClient } from '@/lib/api/client'
import type { ApiEnvelope } from '@/lib/api/envelope'

/** Stable list of kinds that the BE may INSERT into `notifications.kind`. */
export type NotificationKind =
  | 'comment_mention'
  | 'comment_reply'
  | 'review_request'
  | 'review_decision'
  | 'reaction_added'
  | 'read_ack_reminder'
  | 'reminder'
  | 'subscription_event'
  | 'subscription_digest'
  | 'retention_warning'
  | 'automation_blast'
  | string

/** Raw row shape returned by `GET /api/v1/notifications`. */
export interface NotificationServerItem {
  id: string
  user_id: string
  kind: NotificationKind
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string | null
}

export interface ListNotificationsParams {
  unread?: boolean
  limit?: number
}

/**
 * Fetch the caller's notifications. Returns `[]` on any non-2xx so polling
 * never throws a toast — the auth interceptor handles 401 separately.
 */
export async function listNotifications(
  params: ListNotificationsParams = {},
): Promise<NotificationServerItem[]> {
  const search = new URLSearchParams()
  if (params.unread) search.set('unread', 'true')
  if (params.limit != null) search.set('limit', String(params.limit))
  const qs = search.toString()
  const url = qs ? `/notifications?${qs}` : '/notifications'
  const res = await apiClient.get<ApiEnvelope<NotificationServerItem[]>>(url)
  const data = res?.data?.data
  return Array.isArray(data) ? data : []
}

/**
 * Mark a single server-side notification read.
 * The BE returns 204; we resolve void.
 */
export async function markNotificationRead(id: string): Promise<void> {
  await apiClient.post(`/notifications/${encodeURIComponent(id)}/read`)
}
