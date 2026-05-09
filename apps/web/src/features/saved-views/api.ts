/**
 * Saved views API client (Cycle 0030).
 *
 * 미러: `apps/api/app/routers/saved_views.py`. Envelope `{data, meta}` 를
 * 풀어 도메인 형으로 노출한다.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface SavedViewFilters {
  part?: string
  tag?: string
  author?: string
  from?: string
  to?: string
  q?: string
  status?: 'draft' | 'published' | 'archived'
}

export interface SavedView {
  id: string
  user_id: string
  name: string
  icon: string | null
  filters: SavedViewFilters
  ordering: number
  created_at: string | null
  updated_at: string | null
}

export interface CreateSavedViewBody {
  name: string
  icon?: string | null
  filters?: SavedViewFilters
}

export interface PatchSavedViewBody {
  name?: string
  icon?: string | null
  filters?: SavedViewFilters
  ordering?: number
}

export interface SavedViewResultItem {
  id: string
  slug: string
  title: string
  summary: string | null
  status: string
  updated_at: string | null
  owner_id: string | null
  part_id: string | null
}

export interface SavedViewResultsResponse {
  items: SavedViewResultItem[]
  total: number
  count: number
  limit: number
  offset: number
  name: string
  filters: SavedViewFilters
}

export async function createSavedView(body: CreateSavedViewBody): Promise<SavedView> {
  const res = await apiClient.post<ApiEnvelope<SavedView>>('/me/saved-views', body)
  return unwrap(res)
}

export async function listSavedViews(): Promise<SavedView[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: SavedView[] }>>('/me/saved-views')
  return unwrap(res).items
}

export async function patchSavedView(
  id: string,
  body: PatchSavedViewBody,
): Promise<SavedView> {
  const res = await apiClient.patch<ApiEnvelope<SavedView>>(
    `/me/saved-views/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteSavedView(id: string): Promise<void> {
  await apiClient.delete(`/me/saved-views/${encodeURIComponent(id)}`)
}

export async function getSavedViewResults(
  id: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<SavedViewResultsResponse> {
  const params: Record<string, number> = {}
  if (typeof opts.limit === 'number') params.limit = opts.limit
  if (typeof opts.offset === 'number') params.offset = opts.offset
  const res = await apiClient.get<
    ApiEnvelope<{ items: SavedViewResultItem[] }>
  >(`/me/saved-views/${encodeURIComponent(id)}/results`, { params })
  const data = res.data?.data ?? { items: [] }
  const meta = (res.data?.meta ?? {}) as Partial<{
    total: number
    count: number
    limit: number
    offset: number
    name: string
    filters: SavedViewFilters
  }>
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: meta.total ?? 0,
    count: meta.count ?? (Array.isArray(data.items) ? data.items.length : 0),
    limit: meta.limit ?? opts.limit ?? 20,
    offset: meta.offset ?? opts.offset ?? 0,
    name: meta.name ?? '',
    filters: meta.filters ?? {},
  }
}

/**
 * Returns `true` if at least one filter slot has a non-empty value. Used by
 * SaveViewButton to gate visibility (don't show "save view" with zero filters).
 */
export function hasAnyFilter(f: SavedViewFilters | undefined | null): boolean {
  if (!f) return false
  return Object.values(f).some((v) => v != null && String(v).trim() !== '')
}
