import { apiClient } from '@/lib/api/client'
import { toApiError, unwrap, unwrapListMaybe, type ApiEnvelope } from '@/lib/api/envelope'

export interface GlossaryEntry {
  term: string
  definition: string
  aliases?: string[]
}

/**
 * Full term row returned by `GET /api/v1/glossary` (Sprint AB schema).
 * Optional fields default to null/[] on the BE.
 */
export interface GlossaryTerm {
  id: string
  term: string
  definition: string
  domain: string | null
  subdomain: string | null
  term_en: string | null
  aliases: string[]
  status: 'approved' | 'proposed' | 'rejected' | 'deprecated'
  proposed_by?: string | null
  proposed_at?: string | null
  approved_by?: string | null
  approved_at?: string | null
}

/** Flat domain row from `GET /api/v1/domains` (FR-10). */
export interface GlossaryDomain {
  id: string
  slug: string
  name: string
  parent_id: string | null
}

/** Paged response shape for `GET /api/v1/glossary`. */
export interface GlossaryListResponse {
  items: GlossaryTerm[]
  total: number
  page: number
  size: number
}

/**
 * GET /api/v1/glossary?q=
 * No query → full registry (cached on the BE for cheap reads). Failures
 * degrade silently to "no terms" so a missing index never blocks rendering.
 *
 * Kept for the tooltip path ([[useGlossary]]); list/search/filter on the new
 * /glossary page goes through {@link listGlossary} which preserves paging.
 */
export async function getGlossary(q?: string): Promise<GlossaryEntry[]> {
  return unwrapListMaybe<GlossaryEntry>(
    apiClient.get('/glossary', { params: q ? { q } : undefined }),
  )
}

export interface ListGlossaryParams {
  q?: string
  domain?: string | null
  /** Only 'approved' is accepted publicly (Sprint AB). Reserved for future admin toggle. */
  status?: 'approved'
  page?: number
  size?: number
}

/**
 * GET /api/v1/glossary with the full filter set (FR-02). Returns the paged
 * `{items,total,page,size}` block as-is so the page can render counts.
 */
export async function listGlossary(
  params: ListGlossaryParams = {},
): Promise<GlossaryListResponse> {
  const query: Record<string, string | number> = {}
  if (params.q && params.q.trim()) query.q = params.q.trim()
  if (params.domain) query.domain = params.domain
  if (params.status) query.status = params.status
  query.page = params.page ?? 1
  query.size = params.size ?? 20
  const res = await apiClient.get('/glossary', { params: query })
  return unwrap<GlossaryListResponse>(res)
}

/**
 * GET /api/v1/domains (FR-10). Public flat list — server returns
 * `{ items: GlossaryDomain[] }`.
 */
export async function listDomains(): Promise<GlossaryDomain[]> {
  return unwrapListMaybe<GlossaryDomain>(apiClient.get('/domains'), 'items')
}

// ─────────────────────────────────────────────────────────────────────────
// FR-12 — Term graph (Sprint C-4)
// ─────────────────────────────────────────────────────────────────────────

/** Center term node (always present). */
export interface TermGraphCenter {
  id: string
  label: string
  type: 'term'
  domain: string | null
}

/** Document node related to the term (page_doc_id or related_docs entry). */
export interface TermGraphDocNode {
  id: string
  label: string
  type: 'document'
  slug: string
}

/** Co-occurring term node (shared related_doc). */
export interface TermGraphTermNode {
  id: string
  label: string
  type: 'term'
  domain: string | null
}

export type TermGraphNode = TermGraphDocNode | TermGraphTermNode

/** Edge rel kinds emitted by build_graph_for_term. */
export type TermGraphRel = 'referenced_in' | 'cooccurs_with' | 'has_page'

export interface TermGraphEdge {
  source: string
  target: string
  rel: TermGraphRel
}

export interface TermGraphPayload {
  center: TermGraphCenter
  nodes: TermGraphNode[]
  edges: TermGraphEdge[]
}

/**
 * GET /api/v1/graph/terms/{termId} — D3-friendly center+nodes+edges payload.
 * BE shape: { center: {id,label,type:'term',domain}, nodes: [...], edges: [...] }
 */
export async function getTermGraph(termId: string): Promise<TermGraphPayload> {
  const res = await apiClient.get<ApiEnvelope<TermGraphPayload>>(
    `/graph/terms/${encodeURIComponent(termId)}`,
  )
  return unwrap<TermGraphPayload>(res)
}

// ─────────────────────────────────────────────────────────────────────────
// FR-04/05/06 — Admin moderation queue (Sprint C-3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * One row in the admin "승인 대기" list. Mirrors `TermOut` (apps/api
 * `schemas/glossary.py`) — only the fields the FE renders are typed; extra
 * fields are tolerated.
 */
export interface PendingGlossaryTerm {
  id: string
  term: string
  definition: string
  domain: string | null
  subdomain?: string | null
  term_en?: string | null
  aliases: string[]
  status: string
  proposed_by: string | null
  proposed_at: string | null
}

export interface PendingGlossaryPage {
  items: PendingGlossaryTerm[]
  total: number
  page: number
  size: number
}

/**
 * GET /api/v1/glossary/pending — admin-only paginated moderation queue.
 * BE returns `{items,total,page,size}` inside the standard envelope. Throws
 * `ApiError` on non-2xx so caller toasts can surface a useful message.
 */
export async function listPendingGlossary(params: {
  page?: number
  size?: number
}): Promise<PendingGlossaryPage> {
  const page = params.page ?? 1
  const size = params.size ?? 20
  try {
    const res = await apiClient.get('/glossary/pending', {
      params: { page, size },
    })
    const data = unwrap<{
      items: PendingGlossaryTerm[]
      total: number
      page: number
      size: number
    }>(res)
    return {
      items: Array.isArray(data.items) ? data.items : [],
      total: typeof data.total === 'number' ? data.total : 0,
      page: typeof data.page === 'number' ? data.page : page,
      size: typeof data.size === 'number' ? data.size : size,
    }
  } catch (err) {
    throw toApiError(err)
  }
}

/** POST /api/v1/glossary/{id}/approve — admin only. Returns updated row. */
export async function approveGlossaryTerm(id: string): Promise<unknown> {
  try {
    const res = await apiClient.post(`/glossary/${encodeURIComponent(id)}/approve`)
    return unwrap(res)
  } catch (err) {
    throw toApiError(err)
  }
}

/**
 * POST /api/v1/glossary/{id}/reject — admin only. `reason` is required by
 * the BE (min 1 char); the FE enforces a stricter min of 5 chars for UX.
 */
export async function rejectGlossaryTerm(
  id: string,
  reason: string,
): Promise<unknown> {
  try {
    const res = await apiClient.post(
      `/glossary/${encodeURIComponent(id)}/reject`,
      { reason },
    )
    return unwrap(res)
  } catch (err) {
    throw toApiError(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// FR-01 — Propose modal (Sprint C-2)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Body shape for `POST /api/v1/glossary/propose`. Mirrors `TermProposeIn`
 * (apps/api/app/schemas/glossary.py). `domain` may be null/undefined — the
 * BE then skips the (term, domain) UNIQUE check, which means redlink
 * proposals without an explicit domain can still slip through duplicate
 * guards. The propose modal therefore *requires* a domain selection.
 */
export interface ProposeTermInput {
  term: string
  definition: string
  domain?: string | null
  subdomain?: string | null
  term_en?: string | null
  aliases?: string[]
}

/**
 * POST /api/v1/glossary/propose (FR-01). Returns the inserted row
 * (status='proposed'). Duplicates surface as 409 CONFLICT with
 * `details = { existing_id, existing_status }` — callers should `catch`,
 * coerce via `toApiError`, and surface the existing row.
 */
export async function proposeGlossaryTerm(
  input: ProposeTermInput,
): Promise<GlossaryTerm> {
  const body = {
    term: input.term,
    definition: input.definition,
    domain: input.domain ?? null,
    subdomain: input.subdomain ?? null,
    term_en: input.term_en ?? null,
    aliases: input.aliases ?? [],
  }
  try {
    const res = await apiClient.post<ApiEnvelope<GlossaryTerm>>(
      '/glossary/propose',
      body,
    )
    return unwrap(res)
  } catch (err) {
    throw toApiError(err)
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sprint C-4 — Term graph adapter helper
// ─────────────────────────────────────────────────────────────────────────

/**
 * Convert {@link TermGraphPayload} → KnowledgeGraph-compatible `{nodes, edges}`.
 *
 * BE keys nodes by raw `id`; KnowledgeGraph keys nodes by `slug`. We namespace
 * term ids as `term:<uuid>` so they don't collide with doc slugs, and leave
 * doc nodes keyed by their human slug. The center term is included as a 'term'
 * node so the consumer can render the focus node alongside its neighbours.
 *
 * Edge `rel` → KnowledgeGraph `kind`:
 *   - referenced_in / has_page  → 'term_doc'   (term ↔ document)
 *   - cooccurs_with             → 'term_cooc'  (term ↔ term)
 */
export function termGraphToKnowledge(payload: TermGraphPayload): {
  nodes: Array<
    | { kind: 'doc'; slug: string; title: string; status: 'active'; group: null }
    | { kind: 'term'; slug: string; name: string; domain: string | null }
  >
  edges: Array<{ kind: 'term_doc' | 'term_cooc'; source: string; target: string }>
} {
  const termSlug = (id: string) => `term:${id}`
  const idToSlug = new Map<string, string>()
  idToSlug.set(payload.center.id, termSlug(payload.center.id))

  const nodes: Array<
    | { kind: 'doc'; slug: string; title: string; status: 'active'; group: null }
    | { kind: 'term'; slug: string; name: string; domain: string | null }
  > = [
    {
      kind: 'term',
      slug: termSlug(payload.center.id),
      name: payload.center.label,
      domain: payload.center.domain,
    },
  ]

  for (const n of payload.nodes) {
    if (n.type === 'document') {
      idToSlug.set(n.id, n.slug)
      nodes.push({
        kind: 'doc',
        slug: n.slug,
        title: n.label,
        status: 'active',
        group: null,
      })
    } else {
      const slug = termSlug(n.id)
      idToSlug.set(n.id, slug)
      nodes.push({
        kind: 'term',
        slug,
        name: n.label,
        domain: n.domain,
      })
    }
  }

  const edges: Array<{ kind: 'term_doc' | 'term_cooc'; source: string; target: string }> = []
  for (const e of payload.edges) {
    const src = idToSlug.get(e.source)
    const tgt = idToSlug.get(e.target)
    if (!src || !tgt) continue
    const kind: 'term_doc' | 'term_cooc' =
      e.rel === 'cooccurs_with' ? 'term_cooc' : 'term_doc'
    edges.push({ kind, source: src, target: tgt })
  }
  return { nodes, edges }
}
