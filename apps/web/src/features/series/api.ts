/**
 * Series API client — talks to the FastAPI series router
 * (`/series`, `/series/:slug`, `/series/:slug/items`,
 *  `/documents/:slug/series`).
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { Slug } from '@/types/document'

export interface SeriesSummary {
  id: string
  slug: string
  title: string
  description: string | null
  cover_image_id: string | null
  owner_user_id: string
  created_at: string | null
  updated_at: string | null
  item_count: number
  first_item_title: string | null
}

export interface SeriesItem {
  document_id: string
  slug: string
  title: string
  position: number
  added_at: string | null
}

export interface SeriesDetail {
  id: string
  slug: string
  title: string
  description: string | null
  cover_image_id: string | null
  owner_user_id: string
  created_at: string | null
  updated_at: string | null
  items: SeriesItem[]
}

export interface DocumentSeriesNeighbor {
  slug: string
  title: string
}

export interface DocumentSeriesEntry {
  id: string
  slug: string
  title: string
  description: string | null
  cover_image_id: string | null
  position: number
  total: number
  prev: DocumentSeriesNeighbor | null
  next: DocumentSeriesNeighbor | null
}

export interface CreateSeriesIn {
  slug: string
  title: string
  description?: string | null
  cover_image_id?: string | null
}

export interface PatchSeriesIn {
  title?: string
  description?: string | null
  cover_image_id?: string | null
}

export async function listSeries(): Promise<SeriesSummary[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: SeriesSummary[] }>>(
    '/series',
  )
  return unwrap(res).items ?? []
}

export async function getSeries(slug: string): Promise<SeriesDetail> {
  const res = await apiClient.get<ApiEnvelope<SeriesDetail>>(
    `/series/${encodeURIComponent(slug)}`,
  )
  return unwrap(res)
}

export async function createSeries(body: CreateSeriesIn): Promise<SeriesDetail> {
  const res = await apiClient.post<ApiEnvelope<SeriesDetail>>('/series', body)
  return unwrap(res)
}

export async function patchSeries(
  slug: string,
  body: PatchSeriesIn,
): Promise<SeriesDetail> {
  const res = await apiClient.patch<ApiEnvelope<SeriesDetail>>(
    `/series/${encodeURIComponent(slug)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteSeries(slug: string): Promise<void> {
  await apiClient.delete(`/series/${encodeURIComponent(slug)}`)
}

export async function addSeriesItem(
  slug: string,
  documentId: string,
  position?: number,
): Promise<{ items: SeriesItem[] }> {
  const body: { document_id: string; position?: number } = {
    document_id: documentId,
  }
  if (position != null) body.position = position
  const res = await apiClient.post<ApiEnvelope<{ items: SeriesItem[] }>>(
    `/series/${encodeURIComponent(slug)}/items`,
    body,
  )
  return unwrap(res)
}

export async function removeSeriesItem(
  slug: string,
  documentId: string,
): Promise<void> {
  await apiClient.delete(
    `/series/${encodeURIComponent(slug)}/items/${encodeURIComponent(documentId)}`,
  )
}

export async function reorderSeriesItem(
  slug: string,
  documentId: string,
  position: number,
): Promise<{ items: SeriesItem[] }> {
  const res = await apiClient.patch<ApiEnvelope<{ items: SeriesItem[] }>>(
    `/series/${encodeURIComponent(slug)}/items/${encodeURIComponent(documentId)}`,
    { position },
  )
  return unwrap(res)
}

export async function listDocumentSeries(
  docSlug: Slug,
): Promise<DocumentSeriesEntry[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: DocumentSeriesEntry[] }>>(
    `/documents/${encodeURIComponent(docSlug)}/series`,
  )
  return unwrap(res).items ?? []
}
