/**
 * React Query hooks for version tags (Cycle 16).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  branchFromTag,
  createVersionTag,
  deleteVersionTag,
  listVersionTags,
  versionTagsKey,
  type BranchFromTagResponse,
  type CreateVersionTagBody,
  type VersionTag,
} from './api'

export function useVersionTags(slug: string): UseQueryResult<VersionTag[]> {
  return useQuery<VersionTag[]>({
    queryKey: versionTagsKey(slug),
    queryFn: () => listVersionTags(slug),
    enabled: !!slug,
    staleTime: 30_000,
  })
}

export function useCreateVersionTag(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      version,
      body,
    }: {
      version: number
      body: CreateVersionTagBody
    }) => createVersionTag(slug, version, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionTagsKey(slug) })
    },
  })
}

export function useDeleteVersionTag(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tagName: string) => deleteVersionTag(slug, tagName),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: versionTagsKey(slug) })
    },
  })
}

export function useBranchFromTag(slug: string) {
  return useMutation<
    BranchFromTagResponse,
    Error,
    { tag_name: string; target_slug: string }
  >({
    mutationFn: (body) => branchFromTag(slug, body),
  })
}
