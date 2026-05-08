import { apiClient } from '@/lib/api/client'
import { unwrap, unwrapListMaybe, type ApiEnvelope } from '@/lib/api/envelope'

export interface TagSuggestion {
  name: string
  count: number
}

export interface TagDocCard {
  slug: string
  title: string
  summary?: string | null
  updated_at?: string | null
}

/** GET /api/v1/tags?q&limit — autocomplete + count, never throws on 404. */
export async function listTags(params?: { q?: string; limit?: number }): Promise<TagSuggestion[]> {
  return unwrapListMaybe<TagSuggestion>(
    apiClient.get('/tags', { params }),
  )
}

/** GET /api/v1/tags/:tag/documents */
export async function listDocumentsForTag(
  tag: string,
  params?: { limit?: number; offset?: number },
): Promise<TagDocCard[]> {
  return unwrapListMaybe<TagDocCard>(
    apiClient.get(`/tags/${encodeURIComponent(tag)}/documents`, { params }),
  )
}

/** POST /api/v1/tags/rename */
export async function renameTag(from: string, to: string): Promise<number> {
  const res = await apiClient.post<ApiEnvelope<{ affected: number }>>(
    '/tags/rename',
    { from, to },
  )
  const body = unwrap<{ affected: number }>(res)
  return body.affected ?? 0
}

/** POST /api/v1/tags/delete (admin only). */
export async function deleteTag(tag: string): Promise<number> {
  const res = await apiClient.post<ApiEnvelope<{ affected: number }>>(
    '/tags/delete',
    { tag },
  )
  const body = unwrap<{ affected: number }>(res)
  return body.affected ?? 0
}
