import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { searchDocuments, listWidgets, searchSuggest, searchKnowledge } from '../api'

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
    retry: 1,
    placeholderData: keepPreviousData,
    select: (rows) => (Array.isArray(rows) ? rows : []),
  })
}

/**
 * 시스템 지식 (lat/guide/doc/archive) 검색 — debounced 200ms.
 * Empty query → no fetch ({ items: [], total: 0 }).
 */
export function useKnowledgeSearch(q: string) {
  const debounced = useDebounced(q, 200)
  return useQuery({
    queryKey: ['search', 'knowledge', debounced],
    queryFn: () => searchKnowledge(debounced),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
    retry: 1,
    placeholderData: keepPreviousData,
  })
}

/**
 * Omnibox autocomplete — debounced 200ms. Returns 4 grouped buckets
 * (tags, authors, parts, documents). Empty query → all empty arrays.
 */
export function useSearchSuggest(q: string, limit = 8) {
  const debounced = useDebounced(q, 200)
  return useQuery({
    queryKey: ['search', 'suggest', debounced, limit],
    queryFn: () => searchSuggest(debounced, limit),
    enabled: debounced.trim().length > 0,
    staleTime: 30_000,
    retry: 1,
    placeholderData: keepPreviousData,
  })
}

export function useWidgetRegistry() {
  return useQuery({
    queryKey: ['widgets', 'registry'],
    queryFn: () => listWidgets(),
    staleTime: 5 * 60_000,
    retry: 1,
    placeholderData: keepPreviousData,
    select: (rows) => (Array.isArray(rows) ? rows : []),
  })
}

const RECENT_KEY = 'mxwp.recent_search'
const RECENT_MAX = 20

/** One row in the persisted search history. */
export interface RecentSearchItem {
  q: string
  /** Epoch ms when the user last submitted this query. */
  ts: number
}

/**
 * Persistent search history. Keeps the last 20 unique queries with timestamps.
 * Click → re-runs the query; "지우기" supported per row + bulk.
 */
export function useRecentSearches() {
  const [items, setItems] = useState<RecentSearchItem[]>(() => readRecent())

  const push = (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) return
    const next = [
      { q: trimmed, ts: Date.now() },
      ...items.filter((it) => it.q !== trimmed),
    ].slice(0, RECENT_MAX)
    setItems(next)
    writeRecent(next)
  }
  const remove = (q: string) => {
    const next = items.filter((it) => it.q !== q)
    setItems(next)
    writeRecent(next)
  }
  const clear = () => {
    setItems([])
    writeRecent([])
  }
  return useMemo(() => ({ items, push, remove, clear }), [items])
}

function readRecent(): RecentSearchItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Tolerate the legacy shape (`string[]`) by upgrading on the fly so
    // returning users don't lose their list.
    const upgraded: RecentSearchItem[] = []
    for (const row of parsed) {
      if (typeof row === 'string' && row.trim()) {
        upgraded.push({ q: row, ts: 0 })
      } else if (
        row &&
        typeof row === 'object' &&
        typeof (row as { q?: unknown }).q === 'string' &&
        typeof (row as { ts?: unknown }).ts === 'number'
      ) {
        upgraded.push({ q: (row as { q: string }).q, ts: (row as { ts: number }).ts })
      }
    }
    return upgraded.slice(0, RECENT_MAX)
  } catch {
    return []
  }
}

function writeRecent(items: RecentSearchItem[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items))
  } catch {
    /* ignore */
  }
}

export const RECENT_SEARCH_STORAGE_KEY = RECENT_KEY
export const RECENT_SEARCH_MAX = RECENT_MAX
