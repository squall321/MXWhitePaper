/**
 * React Query hooks for comments. The list query key is scoped per-slug so
 * mutations only invalidate the affected document's thread.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createComment,
  deleteComment,
  listComments,
  patchComment,
  resolveThread,
  type Comment,
  type CommentListResponse,
  type CreateCommentInput,
  type PatchCommentInput,
} from '../api'

export const commentsKey = (slug: string) => ['comments', slug] as const

export function useComments(slug: string | undefined) {
  return useQuery<CommentListResponse>({
    queryKey: commentsKey(slug ?? ''),
    queryFn: () => listComments(slug as string),
    enabled: Boolean(slug),
    staleTime: 10_000,
  })
}

export function useCreateComment(slug: string) {
  const qc = useQueryClient()
  return useMutation<Comment, Error, CreateCommentInput>({
    mutationFn: (input) => createComment(slug, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(slug) }),
  })
}

export function usePatchComment(slug: string) {
  const qc = useQueryClient()
  return useMutation<Comment, Error, { id: string; body: PatchCommentInput }>({
    mutationFn: ({ id, body }) => patchComment(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(slug) }),
  })
}

export function useDeleteComment(slug: string) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteComment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(slug) }),
  })
}

export function useResolveThread(slug: string) {
  const qc = useQueryClient()
  return useMutation<Comment, Error, { id: string; resolved?: boolean }>({
    mutationFn: ({ id, resolved }) => resolveThread(id, resolved),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey(slug) }),
  })
}
