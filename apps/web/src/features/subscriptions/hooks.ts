/**
 * React Query hooks for subscriptions (Cycle 0018).
 *
 * Query keys:
 *   ['subscriptions', 'me']            — current user's subscriptions
 *   ['subscriptions', 'doc', slug]     — slugs current user follows (derived)
 *
 * `useIsFollowing` reuses the 'me' cache so toggling state is instant — no
 * extra fetch per BookmarkButton/FollowButton.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  listMySubscriptions,
  patchSubscription,
  subscribeDoc,
  unsubscribeDoc,
  type MySubscription,
  type SubscribeBody,
} from './api'

export const mySubscriptionsKey = () => ['subscriptions', 'me'] as const

export function useMySubscriptions(): UseQueryResult<MySubscription[]> {
  return useQuery<MySubscription[]>({
    queryKey: mySubscriptionsKey(),
    queryFn: () => listMySubscriptions(),
    staleTime: 30_000,
  })
}

/**
 * Returns the followed-state for `slug` plus the subscription row if any.
 * Reads from `useMySubscriptions`'s cache so no extra request fires.
 */
export function useIsFollowing(slug: string | undefined) {
  const all = useMySubscriptions()
  const sub = (all.data ?? []).find((s) => s.slug === slug)
  return { ...all, subscription: sub, isFollowing: Boolean(sub) }
}

export function useSubscribeDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ slug, body }: { slug: string; body?: SubscribeBody }) =>
      subscribeDoc(slug, body ?? {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subscriptions'] })
    },
  })
}

export function useUnsubscribeDoc() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (slug: string) => unsubscribeDoc(slug),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subscriptions'] })
    },
  })
}

export function usePatchSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: SubscribeBody }) =>
      patchSubscription(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['subscriptions'] })
    },
  })
}
