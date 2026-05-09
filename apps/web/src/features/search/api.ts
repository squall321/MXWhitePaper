import { apiClient } from '@/lib/api/client'
import { unwrapListMaybe } from '@/lib/api/envelope'
import type { Slug } from '@/types/document'

export interface DocSearchHighlights {
  title?: string
  summary?: string
  body?: string
}

export interface DocSearchHit {
  slug: Slug
  title: string
  summary?: string
  /** Highlighted snippet from MeiliSearch / equivalent. May contain `<em>`/`<mark>` tags. */
  _formatted?: {
    title?: string
    summary?: string
    text?: string
    body_text?: string
    tags?: string[]
  }
  /** First matched body fragment with `<mark>` tags. Up to 200 chars. */
  snippet?: string
  /** Per-field highlighted strings (cycle 5 J3). */
  highlights?: DocSearchHighlights
  score?: number
  /** Optional facet fields surfaced by the BE (best-effort filtering). */
  team?: string
  team_slug?: string
  part?: string
  part_slug?: string
  category?: string
  confidentiality?: 'public' | 'internal' | 'restricted'
  tags?: string[]
  author?: string
  updated_at?: string
}

/**
 * Filter parameters accepted by GET /search.
 * `from`/`to` are ISO date strings (YYYY-MM-DD).
 */
export interface SearchFilters {
  part?: string | null
  tag?: string | null
  author?: string | null
  team?: string | null
  from?: string | null
  to?: string | null
  limit?: number
  offset?: number
}

/**
 * GET /api/v1/search?q=
 * Returns the top matching documents. The BE may return MeiliSearch-style
 * `_formatted.<field>` highlights — we render them as HTML inside a
 * dompurify-style allowlist (only `<em>`).
 */
export async function searchDocuments(
  q: string,
  limit = 10,
): Promise<DocSearchHit[]> {
  if (!q.trim()) return []
  return unwrapListMaybe<DocSearchHit>(
    apiClient.get('/search', { params: { q, limit } }),
  )
}

/**
 * GET /api/v1/search with the full filter set. Returns the same hit shape
 * plus the BE meta block (`total`, `query_time_ms`).
 */
export interface SearchResponse {
  items: DocSearchHit[]
  total: number
  query_time_ms: number
}

export async function searchWithFilters(
  q: string,
  filters: SearchFilters = {},
): Promise<SearchResponse> {
  const params: Record<string, string | number> = { q }
  if (filters.part) params.part = filters.part
  if (filters.tag) params.tag = filters.tag
  if (filters.author) params.author = filters.author
  if (filters.team) params.team = filters.team
  if (filters.from) params.from = filters.from
  if (filters.to) params.to = filters.to
  if (typeof filters.limit === 'number') params.limit = filters.limit
  if (typeof filters.offset === 'number') params.offset = filters.offset
  try {
    const res = await apiClient.get('/search', { params })
    const env = (res.data ?? {}) as {
      data?: DocSearchHit[]
      meta?: { total?: number; query_time_ms?: number; took_ms?: number }
    }
    return {
      items: Array.isArray(env.data) ? env.data : [],
      total: env.meta?.total ?? 0,
      query_time_ms: env.meta?.query_time_ms ?? env.meta?.took_ms ?? 0,
    }
  } catch {
    return { items: [], total: 0, query_time_ms: 0 }
  }
}

/**
 * GET /api/v1/search/suggest — omnibox autocomplete.
 */
export interface SearchSuggestResponse {
  tags: { tag: string; count: number }[]
  authors: { id: string; label: string; email?: string }[]
  parts: { slug: string; name?: string }[]
  documents: { slug: string; title: string; highlight?: string }[]
}

export async function searchSuggest(
  q: string,
  limit = 8,
): Promise<SearchSuggestResponse> {
  const empty: SearchSuggestResponse = {
    tags: [],
    authors: [],
    parts: [],
    documents: [],
  }
  if (!q.trim()) return empty
  try {
    const res = await apiClient.get('/search/suggest', { params: { q, limit } })
    const data = (res.data?.data ?? {}) as Partial<SearchSuggestResponse>
    return {
      tags: Array.isArray(data.tags) ? data.tags : [],
      authors: Array.isArray(data.authors) ? data.authors : [],
      parts: Array.isArray(data.parts) ? data.parts : [],
      documents: Array.isArray(data.documents) ? data.documents : [],
    }
  } catch {
    return empty
  }
}

export interface WidgetRegistryEntry {
  type: string
  name: string
  description?: string
  category?: string
  icon?: string
}

/** GET /api/v1/widgets/registry */
export async function listWidgets(): Promise<WidgetRegistryEntry[]> {
  return unwrapListMaybe<WidgetRegistryEntry>(
    apiClient.get('/widgets/registry'),
  )
}
