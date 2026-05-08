import { apiClient } from '@/lib/api/client'

interface ApiEnvelope<T> {
  data: T
  meta?: Record<string, unknown>
  error?: { code: string; message: string } | null
}

export interface GlossaryEntry {
  term: string
  definition: string
  aliases?: string[]
}

/**
 * GET /api/v1/glossary?q=
 * No query → full registry (cached on the BE for cheap reads).
 */
export async function getGlossary(q?: string): Promise<GlossaryEntry[]> {
  try {
    const res = await apiClient.get<ApiEnvelope<GlossaryEntry[]>>('/glossary', {
      params: q ? { q } : undefined,
    })
    return res.data.data ?? []
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return []
    throw err
  }
}
