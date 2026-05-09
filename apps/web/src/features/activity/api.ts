/**
 * Activity feed typed API wrappers.
 *
 * Mirrors `apps/api/app/routers/activity.py`. The BE returns events from
 * multiple source tables merged by timestamp DESC. We expose two endpoints:
 *
 *   - listActivity()   → /activity            (everyone)
 *   - listMyActivity() → /activity/me         (filtered to current user)
 *
 * The transport returns `{ items }`, so callers receive a plain array via
 * `unwrap`. 404 / network errors fall through `unwrapMaybe` so the UI can
 * keep showing the last successful list while the user retries.
 */
import { apiClient } from '@/lib/api/client'
import {
  unwrapMaybe,
  type ApiEnvelope,
} from '@/lib/api/envelope'

export type ActivityKind =
  | 'doc_edited'
  | 'doc_created'
  | 'comment_added'
  | 'share_link_created'
  | 'bookmark_added'
  | 'review_requested'
  | 'review_decided'
  | 'snippet_created'

/** All known kinds, in the order the FE chip filter renders them. */
export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'doc_edited',
  'doc_created',
  'comment_added',
  'share_link_created',
  'bookmark_added',
  'review_requested',
  'review_decided',
  'snippet_created',
] as const

export interface ActivityActor {
  user_id: string | null
  name: string
}

export interface ActivityTarget {
  document_id?: string | null
  slug?: string | null
  title?: string | null
}

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  actor: ActivityActor
  target: ActivityTarget
  /** ISO 8601 UTC timestamp, or null when the source had no value. */
  timestamp: string | null
  /** Korean one-line summary the FE renders verbatim. */
  summary: string
  metadata: Record<string, unknown>
}

export interface ActivityListPayload {
  items: ActivityEvent[]
}

export interface ActivityListParams {
  /** ISO timestamp — only events after this are returned. */
  since?: string
  /** Maximum events. Server caps at 200. */
  limit?: number
  /** Comma-separated kinds. Falls back to all when empty / invalid. */
  kind?: ActivityKind | ActivityKind[] | string
}

function normalizeKind(
  k: ActivityListParams['kind'],
): string | undefined {
  if (!k) return undefined
  if (Array.isArray(k)) return k.length > 0 ? k.join(',') : undefined
  return String(k)
}

export async function listActivity(
  params: ActivityListParams = {},
): Promise<ActivityEvent[]> {
  const payload = await unwrapMaybe<ActivityListPayload>(
    apiClient.get<ApiEnvelope<ActivityListPayload>>('/activity', {
      params: {
        since: params.since,
        limit: params.limit,
        kind: normalizeKind(params.kind),
      },
    }),
    { items: [] },
  )
  return Array.isArray(payload.items) ? payload.items : []
}

export async function listMyActivity(
  params: ActivityListParams = {},
): Promise<ActivityEvent[]> {
  const payload = await unwrapMaybe<ActivityListPayload>(
    apiClient.get<ApiEnvelope<ActivityListPayload>>('/activity/me', {
      params: {
        since: params.since,
        limit: params.limit,
        kind: normalizeKind(params.kind),
      },
    }),
    { items: [] },
  )
  return Array.isArray(payload.items) ? payload.items : []
}
