/**
 * Presence API client — talks to the FastAPI presence router.
 *   POST   /presence/:slug/heartbeat
 *   GET    /presence/:slug
 *   DELETE /presence/:slug
 *   GET    /presence/:slug/stream  (SSE — opened directly via EventSource)
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface PresenceUser {
  user_id: string
  name: string
  /** Block ULID the user is currently viewing (topmost visible). */
  anchor_block_id: string | null
  /** Server-side last-seen epoch seconds (float). */
  last_seen: number
}

export interface PresenceList {
  slug: string
  items: PresenceUser[]
}

export async function postHeartbeat(
  slug: string,
  anchor_block_id: string | null,
): Promise<PresenceList> {
  const res = await apiClient.post<ApiEnvelope<PresenceList>>(
    `/presence/${encodeURIComponent(slug)}/heartbeat`,
    { anchor_block_id },
  )
  return unwrap(res)
}

export async function getPresence(slug: string): Promise<PresenceList> {
  const res = await apiClient.get<ApiEnvelope<PresenceList>>(
    `/presence/${encodeURIComponent(slug)}`,
  )
  return unwrap(res)
}

export async function leavePresence(slug: string): Promise<void> {
  await apiClient.delete(`/presence/${encodeURIComponent(slug)}`)
}

/**
 * Build the SSE stream URL. EventSource doesn't accept custom headers, so
 * auth must rely on the cookie that the rest of the app already shares
 * (`withCredentials: true`). The baseURL prefix mirrors `apiClient` so
 * Vite's dev proxy still works.
 */
export function streamUrl(slug: string): string {
  const base =
    (import.meta.env.VITE_API_URL as string | undefined) || `${import.meta.env.BASE_URL}api/v1`
  return `${base}/presence/${encodeURIComponent(slug)}/stream`
}
