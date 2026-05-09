/**
 * React Query hooks for reactions (Cycle 0021).
 *
 * Query keys:
 *   ['reactions', 'agg', slug]    — public aggregate counts (per-doc + per-block)
 *   ['reactions', 'me',  slug]    — emojis the current user has on this doc
 *
 * The toggle mutation invalidates both caches on success so the bar updates
 * counts and "highlighted" state in one go.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  getMyReactions,
  getReactionAggregate,
  toggleReaction,
  type MyReactions,
  type ReactionAggregate,
  type ToggleReactionInput,
  type ToggleReactionResult,
} from './api'

export const reactionAggKey = (slug: string) =>
  ['reactions', 'agg', slug] as const
export const reactionMeKey = (slug: string) =>
  ['reactions', 'me', slug] as const

export function useReactionAggregate(
  slug: string | undefined,
): UseQueryResult<ReactionAggregate> {
  return useQuery<ReactionAggregate>({
    queryKey: reactionAggKey(slug ?? ''),
    queryFn: () => getReactionAggregate(slug as string),
    enabled: Boolean(slug),
    staleTime: 30_000,
  })
}

export function useMyReactions(
  slug: string | undefined,
): UseQueryResult<MyReactions> {
  return useQuery<MyReactions>({
    queryKey: reactionMeKey(slug ?? ''),
    queryFn: () => getMyReactions(slug as string),
    enabled: Boolean(slug),
    staleTime: 30_000,
  })
}

export function useToggleReaction(slug: string) {
  const qc = useQueryClient()
  return useMutation<ToggleReactionResult, Error, ToggleReactionInput>({
    mutationFn: (body) => toggleReaction(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: reactionAggKey(slug) })
      void qc.invalidateQueries({ queryKey: reactionMeKey(slug) })
    },
  })
}
