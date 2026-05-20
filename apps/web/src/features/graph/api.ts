/**
 * Wiki link graph API client (Tier 2C).
 *
 * Mirrors `GET /api/v1/links/graph?root=<slug>&depth=<N>`. The BE returns
 * `{ data: { nodes, edges } }`. Missing target documents come back with
 * `status: "missing"` so the UI can colour them red.
 *
 * v0.3: also supports domain-based subgraph queries.
 *   fetchGraph({ domain: 'mobile', include_tags: true })
 *   fetchGraph({ root: 'android', depth: 2 })         // legacy form still works
 *   fetchGraph('android', 2)                           // positional form still works
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

export interface GraphOptions {
  root?: string | null
  depth?: number
  domain?: string
  include_tags?: boolean
}

/**
 * Fetch the wiki link graph. Accepts either:
 *  - positional `(root?, depth?)` for backward compat with existing callers
 *  - options object `{ root?, depth?, domain?, include_tags? }` for domain queries
 */
export async function fetchGraph(
  rootOrOptions?: string | null | GraphOptions,
  depth = 2,
): Promise<GraphPayload> {
  const params: Record<string, string | number | boolean> = {}

  if (rootOrOptions !== null && rootOrOptions !== undefined && typeof rootOrOptions === 'object') {
    const opts = rootOrOptions
    if (opts.root) params.root = opts.root
    params.depth = opts.depth ?? 2
    if (opts.domain) params.domain = opts.domain
    if (opts.include_tags) params.include_tags = true
  } else {
    params.depth = depth
    if (rootOrOptions) params.root = rootOrOptions as string
  }

  const res = await apiClient.get<ApiEnvelope<GraphPayload>>('/links/graph', {
    params,
  })
  return unwrap<GraphPayload>(res)
}
