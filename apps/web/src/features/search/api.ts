import { apiClient } from '@/lib/api/client'
import { unwrapListMaybe } from '@/lib/api/envelope'
import type { Slug } from '@/types/document'

export interface DocSearchHit {
  slug: Slug
  title: string
  summary?: string
  /** Highlighted snippet from MeiliSearch / equivalent. May contain `<em>` tags. */
  _formatted?: {
    title?: string
    summary?: string
    text?: string
    tags?: string[]
  }
  /** Free-form snippet excerpted from body. */
  snippet?: string
  score?: number
  /** Optional facet fields surfaced by the BE (best-effort filtering). */
  team?: string
  category?: string
  confidentiality?: 'public' | 'internal' | 'restricted'
  tags?: string[]
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
