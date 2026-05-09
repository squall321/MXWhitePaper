/**
 * Bookmarks + reads API client.
 *
 * 미러: `apps/api/app/routers/bookmarks.py`. 표준 envelope `{data, meta}` 를
 * unwrap 해서 도메인 형 그대로 노출한다.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface Bookmark {
  id: string
  document_id: string
  slug: string
  title: string
  folder: string | null
  notes: string | null
  created_at: string | null
}

export interface BookmarkFolder {
  folder: string | null
  count: number
}

export interface RecentRead {
  document_id: string
  slug: string
  title: string
  summary: string | null
  read_at: string | null
  read_seconds: number
  bookmarked: boolean
}

export interface CreateBookmarkInput {
  /** 슬러그 또는 UUID 둘 다 받음 (BE 가 알아서 해석). */
  document_id: string
  folder?: string | null
  notes?: string | null
}

export interface PatchBookmarkInput {
  folder?: string | null
  notes?: string | null
}

export async function listBookmarks(folder?: string | null): Promise<Bookmark[]> {
  const params: Record<string, string> = {}
  if (folder !== undefined && folder !== null) params.folder = folder
  const res = await apiClient.get<ApiEnvelope<{ items: Bookmark[] }>>(
    '/bookmarks',
    { params },
  )
  return unwrap(res).items
}

export async function listFolders(): Promise<BookmarkFolder[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: BookmarkFolder[] }>>(
    '/bookmarks/folders',
  )
  return unwrap(res).items
}

export async function createBookmark(
  body: CreateBookmarkInput,
): Promise<{ bookmark_id: string }> {
  const res = await apiClient.post<ApiEnvelope<{ bookmark_id: string }>>(
    '/bookmarks',
    body,
  )
  return unwrap(res)
}

export async function deleteBookmark(id: string): Promise<void> {
  await apiClient.delete(`/bookmarks/${encodeURIComponent(id)}`)
}

export async function patchBookmark(
  id: string,
  body: PatchBookmarkInput,
): Promise<Bookmark> {
  const res = await apiClient.patch<ApiEnvelope<Bookmark>>(
    `/bookmarks/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}

export async function postRead(
  document_id: string,
  read_seconds: number,
): Promise<{ document_id: string; read_seconds: number; read_at: string | null }> {
  const res = await apiClient.post<
    ApiEnvelope<{ document_id: string; read_seconds: number; read_at: string | null }>
  >('/reads', { document_id, read_seconds })
  return unwrap(res)
}

export async function listRecentReads(limit = 50): Promise<RecentRead[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: RecentRead[] }>>(
    '/reads/recent',
    { params: { limit } },
  )
  return unwrap(res).items
}
