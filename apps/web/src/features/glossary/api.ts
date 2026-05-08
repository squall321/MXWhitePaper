import { apiClient } from '@/lib/api/client'
import { unwrapListMaybe } from '@/lib/api/envelope'

export interface GlossaryEntry {
  term: string
  definition: string
  aliases?: string[]
}

/**
 * GET /api/v1/glossary?q=
 * No query → full registry (cached on the BE for cheap reads). Failures
 * degrade silently to "no terms" so a missing index never blocks rendering.
 */
export async function getGlossary(q?: string): Promise<GlossaryEntry[]> {
  return unwrapListMaybe<GlossaryEntry>(
    apiClient.get('/glossary', { params: q ? { q } : undefined }),
  )
}
