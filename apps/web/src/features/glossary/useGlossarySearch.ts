import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  listDomains,
  listGlossary,
  type GlossaryDomain,
  type GlossaryListResponse,
  type ListGlossaryParams,
} from './api'

/**
 * Page-level search hook for `/glossary`. Wraps two queries:
 *   - paged term list (`GET /glossary` with q/domain/page/size)
 *   - flat domain master (`GET /domains`)
 *
 * `keepPreviousData` keeps the old page on screen while the next page loads
 * so the cards don't flash empty between keystrokes / page changes.
 */
export function useGlossarySearch(params: ListGlossaryParams = {}) {
  // Normalize params for a stable queryKey — undefined → null so cache keys
  // collapse to one entry per logical filter combo.
  const q = (params.q ?? '').trim() || null
  const domain = params.domain || null
  const page = params.page ?? 1
  const size = params.size ?? 20

  const list = useQuery<GlossaryListResponse>({
    queryKey: ['glossary', 'list', { q, domain, page, size }],
    queryFn: () =>
      listGlossary({ q: q ?? undefined, domain, page, size, status: 'approved' }),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: 1,
  })

  const domains = useQuery<GlossaryDomain[]>({
    queryKey: ['glossary', 'domains'],
    queryFn: () => listDomains(),
    staleTime: 10 * 60_000,
    retry: 1,
  })

  return {
    list,
    domains,
    /** Convenience flag used by the empty-state hint. */
    isEmpty: !list.isPending && (list.data?.items.length ?? 0) === 0,
  }
}
