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

/** Doc node (default kind when missing — backward compat). */
export interface GraphNodeDoc {
  kind?: 'doc'
  slug: string
  title: string
  status: 'active' | 'archived' | 'missing' | string
  group: string | null
}

/** Tag node — kind='tag', slug='tag:<name>'. */
export interface GraphNodeTag {
  kind: 'tag'
  slug: string          // "tag:<name>"
  name: string          // raw tag name without prefix
  doc_count: number
  super_domain: string  // 'mobile' | 'software' | 'hardware' | 'telecom'
}

/**
 * Term node (Sprint C-4 / FR-12) — slug='term:<id>'.
 *
 * Only emitted when the graph payload was built from a glossary term
 * focus (see [[features/glossary/api.ts#getTermGraph]] + GraphPage's
 * `?term=<id>` mode). Rendered with a distinct purple-tinted palette so
 * users can tell terms apart from docs/tags at a glance.
 */
export interface GraphNodeTerm {
  kind: 'term'
  slug: string          // "term:<uuid>"
  name: string          // raw term text (label)
  domain: string | null // 분야별 색상 매핑 — null 이면 폴백 색
}

export type GraphNode = GraphNodeDoc | GraphNodeTag | GraphNodeTerm

export interface GraphEdge {
  /**
   * Edge kind — default 'wiki' when missing (backward compat).
   *
   * Sprint C-4 added the term-graph kinds:
   *   - 'term_doc'   : term ↔ document  (referenced_in / has_page)
   *   - 'term_cooc'  : term ↔ term      (cooccurs_with)
   */
  kind?: 'wiki' | 'doc_tag' | 'tag_cooc' | 'triple' | 'term_doc' | 'term_cooc'
  source: string
  target: string
  /** count for wiki / weight for tag_cooc. doc_tag has neither. */
  count?: number
  weight?: number
  /** triple 엣지 전용 — 술어 라벨. */
  predicate?: string
  /** triple 엣지 전용 — 출처 (llm 자동추출 / manual 사용자입력). */
  triple_source?: 'llm' | 'manual'
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
  include_doc_tag_edges?: boolean
  include_tag_cooc?: boolean
  /** true 일 때만 triple (의미 엣지) 을 그래프에 포함. */
  include_triples?: boolean
  /** 전역 (root/domain 없음) 경로의 노드 cap. 기본 200 — /graph/all 은 5000. */
  limit?: number
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
    if (opts.include_doc_tag_edges) params.include_doc_tag_edges = true
    if (opts.include_tag_cooc) params.include_tag_cooc = true
    if (opts.include_triples) params.include_triples = true
    if (opts.limit) params.limit = opts.limit
  } else {
    params.depth = depth
    if (rootOrOptions) params.root = rootOrOptions as string
  }

  const res = await apiClient.get<ApiEnvelope<GraphPayload>>('/links/graph', {
    params,
  })
  return unwrap<GraphPayload>(res)
}
