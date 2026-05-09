/**
 * React Query hooks for the server-persisted bookmark feature.
 *
 * Query keys:
 *   ['bookmarks', folder | null]   — list (optional folder filter)
 *   ['bookmarks', 'folders']       — folder summary
 *   ['reads', 'recent', limit]     — recent reads
 *
 * Mutations invalidate these so the BookmarkButton flips state instantly.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  createBookmark,
  deleteBookmark,
  listBookmarks,
  listFolders,
  listRecentReads,
  patchBookmark,
  type Bookmark,
  type BookmarkFolder,
  type CreateBookmarkInput,
  type PatchBookmarkInput,
  type RecentRead,
} from '../api'

export const bookmarksKey = (folder?: string | null) =>
  ['bookmarks', folder ?? null] as const
export const foldersKey = () => ['bookmarks', 'folders'] as const
export const recentReadsKey = (limit: number) =>
  ['reads', 'recent', limit] as const

export function useBookmarks(
  folder?: string | null,
): UseQueryResult<Bookmark[]> {
  return useQuery<Bookmark[]>({
    queryKey: bookmarksKey(folder ?? null),
    queryFn: () => listBookmarks(folder ?? undefined),
    staleTime: 30_000,
  })
}

export function useBookmarkFolders(): UseQueryResult<BookmarkFolder[]> {
  return useQuery<BookmarkFolder[]>({
    queryKey: foldersKey(),
    queryFn: () => listFolders(),
    staleTime: 30_000,
  })
}

export function useRecentReads(limit = 50): UseQueryResult<RecentRead[]> {
  return useQuery<RecentRead[]>({
    queryKey: recentReadsKey(limit),
    queryFn: () => listRecentReads(limit),
    staleTime: 30_000,
  })
}

export function useCreateBookmark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateBookmarkInput) => createBookmark(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })
}

export function useDeleteBookmark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBookmark(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })
}

export function usePatchBookmark() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PatchBookmarkInput }) =>
      patchBookmark(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bookmarks'] })
    },
  })
}

/**
 * 슬러그가 책갈피된 상태인지 + 책갈피 row 객체를 함께 반환.
 * `useBookmarks()` 의 cache 위에서 동작 — 별도 fetch 없음.
 */
export function useBookmarkBySlug(slug: string | undefined) {
  const all = useBookmarks(null)
  const item = (all.data ?? []).find((b) => b.slug === slug)
  return { ...all, bookmark: item, isBookmarked: Boolean(item) }
}
