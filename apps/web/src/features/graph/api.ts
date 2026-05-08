/**
 * Wiki link graph API client (Tier 2C).
 *
 * Mirrors `GET /api/v1/links/graph?root=<slug>&depth=<N>`. The BE returns
 * `{ data: { nodes, edges } }`. Missing target documents come back with
 * `status: "missing"` so the UI can colour them red.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface GraphNode {
  slug: string
  title: string
  status: 'active' | 'archived' | 'missing' | string
  group: string | null
}

export interface GraphEdge {
  source: string
  target: string
  count: number
}

export interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export async function fetchGraph(
  root?: string | null,
  depth = 2,
): Promise<GraphPayload> {
  const params: Record<string, string | number> = { depth }
  if (root) params.root = root
  const res = await apiClient.get<ApiEnvelope<GraphPayload>>('/links/graph', {
    params,
  })
  return unwrap<GraphPayload>(res)
}
