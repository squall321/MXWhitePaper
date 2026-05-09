/**
 * Doc dependency graph API client (Cycle 7).
 *
 * Mirrors `GET /api/v1/dep-graph?root_slug=<slug>&depth=<N>`. The BE walks
 * `content_json` server-side to extract `[[slug]]` wiki links, BFS-expands
 * from `root_slug` up to `depth` hops (max 4), and returns nodes/edges.
 * `count_in` / `count_out` are *global* degrees (not subgraph-restricted)
 * so the visualisation can size influential nodes consistently across views.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface DepGraphNode {
  slug: string
  title: string
  count_in: number
  count_out: number
}

export interface DepGraphEdge {
  from: string
  to: string
  count: number
}

export interface DepGraphPayload {
  nodes: DepGraphNode[]
  edges: DepGraphEdge[]
}

export async function fetchDepGraph(
  rootSlug: string,
  depth = 2,
): Promise<DepGraphPayload> {
  const res = await apiClient.get<ApiEnvelope<DepGraphPayload>>('/dep-graph', {
    params: { root_slug: rootSlug, depth },
  })
  return unwrap<DepGraphPayload>(res)
}

export interface OrphanRow {
  slug: string
  title: string
}

export async function fetchOrphans(): Promise<OrphanRow[]> {
  const res = await apiClient.get<ApiEnvelope<{ orphans: OrphanRow[] }>>(
    '/dep-graph/orphans',
  )
  return unwrap<{ orphans: OrphanRow[] }>(res).orphans
}
