import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { getGlossary, type GlossaryEntry } from './api'

/**
 * Page-level glossary fetcher. Tooltip detection scans rendered text for
 * any term in this list and pops a definition card on hover. Cached for
 * 10 minutes; failures degrade silently to "no terms".
 */
export function useGlossary() {
  const query = useQuery<GlossaryEntry[]>({
    queryKey: ['glossary'],
    queryFn: () => getGlossary(),
    staleTime: 10 * 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
    select: (rows) => (Array.isArray(rows) ? rows : []),
  })
  const terms = query.data ?? []
  const map = useMemo(() => {
    const m = new Map<string, GlossaryEntry>()
    for (const t of terms) {
      if (!t?.term) continue
      m.set(t.term.toLowerCase(), t)
      for (const a of t.aliases ?? []) {
        if (a) m.set(a.toLowerCase(), t)
      }
    }
    return m
  }, [terms])
  return {
    terms,
    lookup: (term: string) => map.get(term.toLowerCase())?.definition,
    findEntry: (term: string) => map.get(term.toLowerCase()),
  }
}
