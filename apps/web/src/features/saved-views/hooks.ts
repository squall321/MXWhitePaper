/**
 * React Query hooks for saved views (Cycle 0030).
 *
 * Query keys:
 *   ['saved-views', 'list']
 *   ['saved-views', 'results', id, limit, offset]
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  createSavedView,
  deleteSavedView,
  getSavedViewResults,
  listSavedViews,
  patchSavedView,
  type CreateSavedViewBody,
  type PatchSavedViewBody,
  type SavedView,
  type SavedViewResultsResponse,
} from './api'

export const savedViewsListKey = () => ['saved-views', 'list'] as const
export const savedViewResultsKey = (id: string, limit: number, offset: number) =>
  ['saved-views', 'results', id, limit, offset] as const

/** Live list of the current user's saved views. */
export function useSavedViews(): UseQueryResult<SavedView[]> {
  return useQuery<SavedView[]>({
    queryKey: savedViewsListKey(),
    queryFn: () => listSavedViews(),
    staleTime: 30_000,
  })
}

export function useCreateSavedView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateSavedViewBody) => createSavedView(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-views'] })
    },
  })
}

export function usePatchSavedView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: PatchSavedViewBody }) =>
      patchSavedView(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-views'] })
    },
  })
}

export function useDeleteSavedView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSavedView(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['saved-views'] })
    },
  })
}

/** Apply a saved view's filters and return matching docs (paginated). */
export function useSavedViewResults(
  id: string,
  opts: { limit?: number; offset?: number } = {},
): UseQueryResult<SavedViewResultsResponse> {
  const limit = opts.limit ?? 20
  const offset = opts.offset ?? 0
  return useQuery<SavedViewResultsResponse>({
    queryKey: savedViewResultsKey(id, limit, offset),
    queryFn: () => getSavedViewResults(id, { limit, offset }),
    enabled: !!id,
    // Throttle live count badge in the rail to ≤ once a minute (mandate §4).
    staleTime: 60_000,
  })
}
