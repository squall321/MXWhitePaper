import { useQuery } from '@tanstack/react-query'
import { getBacklinks, type BacklinksResult } from '../api'
import type { Slug } from '@/types/document'

/**
 * Backlinks query. The endpoint is best-effort: 404/500 fall back to an
 * empty list so a missing or partially-built BE never blocks the render.
 *
 * Returns the full envelope-flavoured result `{ items, targetExists }`; the
 * `targetExists` flag drives the "this doc isn't written yet — write it now"
 * CTA in the right rail.
 */
export function useBacklinks(slug: Slug | undefined) {
  return useQuery<BacklinksResult>({
    queryKey: ['backlinks', slug],
    queryFn: () => {
      if (!slug) return Promise.resolve({ items: [], targetExists: true })
      return getBacklinks(slug)
    },
    enabled: Boolean(slug),
    staleTime: 60_000,
  })
}
