/**
 * Home hero API client.
 *
 * Mirrors `GET /api/v1/home/hero`. Returns domain-level stats used by
 * `<DomainTiles>` — doc counts, 7-day trend sparkline, and top docs by indegree.
 *
 * Also mirrors `GET /api/v1/home/today` for `<TodayHero>`.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { GraphNode, GraphEdge } from '@/features/graph/api'

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

// ---------------------------------------------------------------------------
// TodayHero — GET /api/v1/home/today
// ---------------------------------------------------------------------------

export interface TodayNeighbor {
  kind: 'wiki' | 'tag'
  slug: string
  title: string
  weight: number
}

export interface TodayDoc {
  slug: string
  title: string
  excerpt: string
  indegree: number
  team_id?: string | null
  updated_at: string
}

export interface HomeTodayPayload {
  as_of: string
  doc: TodayDoc
  neighbors: TodayNeighbor[]
  graph: {
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
}

export async function fetchHomeToday(): Promise<HomeTodayPayload> {
  const res = await apiClient.get<ApiEnvelope<HomeTodayPayload>>('/home/today')
  return unwrap<HomeTodayPayload>(res)
}
