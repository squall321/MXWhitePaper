import { useQuery } from '@tanstack/react-query'
import { getGlossary, type GlossaryEntry } from './api'

/**
 * Page-level glossary fetcher. Tooltip detection scans rendered text for
 * any term in this list and pops a definition card on hover. Cached for
 * 10 minutes; failures degrade silently to "no terms".
 */
export function useGlossary() {
  const query = useQuery({
    queryKey: ['glossary'],
    queryFn: () => getGlossary(),
    staleTime: 10 * 60_000,
  })
  const terms = query.data ?? []
  const map = new Map<string, GlossaryEntry>()
  for (const t of terms) {
    map.set(t.term.toLowerCase(), t)
    for (const a of t.aliases ?? []) map.set(a.toLowerCase(), t)
  }
  return {
    terms,
    lookup: (term: string) => map.get(term.toLowerCase())?.definition,
    findEntry: (term: string) => map.get(term.toLowerCase()),
  }
}
