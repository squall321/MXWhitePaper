import { apiClient } from '@/lib/api/client'
import type { Slug } from '@/types/document'

interface ApiEnvelope<T> {
  data: T
  meta?: Record<string, unknown>
  error?: { code: string; message: string } | null
}

export interface DocSearchHit {
  slug: Slug
  title: string
  summary?: string
  /** Highlighted snippet from MeiliSearch / equivalent. May contain `<em>` tags. */
  _formatted?: {
    title?: string
    summary?: string
    text?: string
  }
  /** Free-form snippet excerpted from body. */
  snippet?: string
  score?: number
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
  try {
    const res = await apiClient.get<ApiEnvelope<DocSearchHit[]>>(`/search`, {
      params: { q, limit },
    })
    return res.data.data ?? []
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return []
    throw err
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
  try {
    const res = await apiClient.get<ApiEnvelope<WidgetRegistryEntry[]>>(
      '/widgets/registry',
    )
    return res.data.data ?? []
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return []
    throw err
  }
}
