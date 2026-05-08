import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { searchDocuments, listWidgets } from '../api'

/**
 * 200ms debounce for the document search field.
 */
export function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function useDocumentSearch(q: string) {
  const debounced = useDebounced(q, 200)
  return useQuery({
    queryKey: ['search', 'documents', debounced],
    queryFn: () => searchDocuments(debounced),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
  })
}

export function useWidgetRegistry() {
  return useQuery({
    queryKey: ['widgets', 'registry'],
    queryFn: () => listWidgets(),
    staleTime: 5 * 60_000,
  })
}

const RECENT_KEY = 'mxwp.recent_search'
const RECENT_MAX = 5

export function useRecentSearches() {
  const [items, setItems] = useState<string[]>(() => readRecent())
  const push = (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    const next = [trimmed, ...items.filter((x) => x !== trimmed)].slice(0, RECENT_MAX)
    setItems(next)
    writeRecent(next)
  }
  const clear = () => {
    setItems([])
    writeRecent([])
  }
  return useMemo(() => ({ items, push, clear }), [items])
}

function readRecent(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

function writeRecent(items: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items))
  } catch {
    /* ignore */
  }
}
