import { useQuery } from '@tanstack/react-query'
import { checkDocumentExists } from '../api'
import type { Slug } from '@/types/document'

/**
 * Returns `true` when the slug resolves to a live document (i.e. wiki link is
 * "blue"), `false` when the GET 404s. 5-minute stale time so a single article
 * with many references doesn't hammer the API.
 *
 * The backend exposes no HEAD endpoint today; the underlying `checkDocumentExists`
 * call is a plain `GET /documents/:slug` whose result is cached by both
 * TanStack Query and the apiClient layer.
 */
export function useDocumentExists(slug: Slug | undefined) {
  return useQuery<boolean>({
    queryKey: ['document-exists', slug],
    queryFn: () => {
      if (!slug) return Promise.resolve(false)
      return checkDocumentExists(slug)
    },
    enabled: Boolean(slug),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  })
}
