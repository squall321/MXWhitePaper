/**
 * Home hero API client.
 *
 * Mirrors `GET /api/v1/home/hero`. Returns domain-level stats used by
 * `<DomainTiles>` — doc counts, 7-day trend sparkline, and top docs by indegree.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface TopDoc {
  slug: string
  title: string
  indegree: number
}

export interface DomainStat {
  id: string
  doc_count: number
  doc_count_7d_ago: number
  trend_7d: number[]
  top_docs: TopDoc[]
}

export interface HomeHeroPayload {
  as_of: string
  domains: DomainStat[]
}

export async function fetchHomeHero(): Promise<HomeHeroPayload> {
  const res = await apiClient.get<ApiEnvelope<HomeHeroPayload>>('/home/hero')
  return unwrap<HomeHeroPayload>(res)
}
