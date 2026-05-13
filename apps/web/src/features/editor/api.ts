import { apiClient } from '@/lib/api/client'
import { unwrapListMaybe, type ApiEnvelope } from '@/lib/api/envelope'
import type {
  Block,
  DocumentJSONV10,
  InfoboxRich,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
  Slug,
  Ulid,
} from '@/types/document'

export interface EditorResponseMeta {
  version?: number
  etag?: string
  updated_at?: string
}

/**
 * Result of any mutating editor call: the fresh DocumentJSON the server
 * computed (so we can replace local state) plus its new ETag.
 */
export interface EditorMutationResult {
  document: DocumentJSONV10
  etag: string
}

const HEADER_IF_MATCH = 'If-Match'
const HEADER_CHANGE_LOG = 'X-MXWP-Change-Log'

function buildHeaders(etag: string, changeLog?: string): Record<string, string> {
  const headers: Record<string, string> = { [HEADER_IF_MATCH]: etag }
  if (changeLog) headers[HEADER_CHANGE_LOG] = changeLog
  return headers
}

function unwrap(res: {
  data: ApiEnvelope<DocumentJSONV10>
  headers: Record<string, string | undefined>
}): EditorMutationResult {
  const meta = (res.data.meta ?? {}) as EditorResponseMeta
  // ETag header has highest authority but `meta.etag` is the documented contract.
  const headerEtag = (res.headers as Record<string, string | undefined>)['etag']
  const etag = headerEtag ?? meta.etag ?? ''
  const document = res.data.data
  if (!document) {
    throw new Error('서버 응답이 비어 있습니다.')
  }
  return { document, etag }
}

/**
 * BE quirk: several mutation endpoints (POST /blocks, PATCH /blocks/:id,
 * DELETE /blocks/:id, /blocks/:id/move, /sections/:id, /sections/reorder)
 * return a *partial* envelope like `{slug, version, block_id}` instead of
 * a full DocumentJSON. `applyServerSnapshot` rejects partials so it doesn't
 * wipe `draft.metadata` / `sections`, but that means the UI also won't
 * reflect the new block until a full doc arrives.
 *
 * `withFullDocFallback` solves it on the FE side: if the mutation response
 * doesn't smell like a full doc, do a follow-up GET /documents/:slug and
 * return that as the canonical document. Now every mutation behaves as if
 * the BE returned the full doc — no silent UI desync.
 */
function looksLikeFullDoc(doc: unknown): boolean {
  if (!doc || typeof doc !== 'object') return false
  const d = doc as { sections?: unknown; metadata?: unknown }
  return Array.isArray(d.sections) && !!d.metadata && typeof d.metadata === 'object'
}

async function withFullDocFallback(
  slug: Slug,
  result: EditorMutationResult,
): Promise<EditorMutationResult> {
  if (looksLikeFullDoc(result.document)) return result
  // BE quirk: `GET /documents/:slug` returns the database row wrapped as
  // `{data: {id, slug, ...row..., content: DocumentJSON}}` — the actual
  // DocumentJSON we want lives at `data.content`, NOT `data` itself.
  const res = await apiClient.get<ApiEnvelope<{ content?: DocumentJSONV10 }>>(
    `/documents/${encodeURIComponent(slug)}`,
  )
  const row = res.data.data
  const full = row?.content
  if (!full) return result
  const headerEtag = (res.headers as Record<string, string | undefined>)['etag']
  const meta = (res.data.meta ?? {}) as { etag?: string }
  return { document: full, etag: headerEtag ?? meta.etag ?? result.etag }
}

export type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3

/** Patch of an existing section (only mutable fields). */
export interface SectionPatch {
  title?: string
  blocks?: Block[]
  number?: string
}

/** Light tree shape we send back to /sections/reorder. */
export interface SectionOutlineNode {
  id: Ulid
  level: number
  title: string
  children: SectionOutlineNode[]
}

/**
 * PATCH /documents/:slug/title — update doc title (and optionally summary).
 *
 * Body shape:
 *   `{ title: string, summary?: string | null }`
 *
 * If `summary` key is present, it is updated as well; empty/null removes the
 * summary field from the document. Returns the fresh full document.
 */
export async function patchDocumentTitle(
  slug: Slug,
  body: { title: string; summary?: string | null },
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.patch<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/title`,
    body,
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/**
 * PATCH /documents/:slug/sections/:id
 * Updates a single section; the BE replaces blocks if `blocks` is set.
 */
export async function patchSection(
  slug: Slug,
  sectionId: Ulid,
  patch: SectionPatch,
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.patch<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/sections/${sectionId}`,
    patch,
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/** PATCH /documents/:slug/blocks/:id — partial block update. */
export async function patchBlock(
  slug: Slug,
  blockId: Ulid,
  patch: Partial<Block>,
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.patch<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/blocks/${blockId}`,
    patch,
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

export interface InsertBlockBody {
  /** Section to insert into. */
  section_id: Ulid
  /** Insert position; -1 (or omit) = append. */
  index?: number
  block: Block
}

/** POST /documents/:slug/blocks — insert a block. */
export async function insertBlock(
  slug: Slug,
  body: InsertBlockBody,
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.post<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/blocks`,
    body,
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/** DELETE /documents/:slug/blocks/:id */
export async function deleteBlock(
  slug: Slug,
  blockId: Ulid,
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.delete<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/blocks/${blockId}`,
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

export interface MoveBlockBody {
  to_section_id: Ulid
  to_index: number
}

/** POST /documents/:slug/blocks/:id/move */
export async function moveBlock(
  slug: Slug,
  blockId: Ulid,
  body: MoveBlockBody,
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.post<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/blocks/${blockId}/move`,
    body,
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/** POST /documents/:slug/sections/reorder */
export async function reorderSections(
  slug: Slug,
  outline: SectionOutlineNode[],
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.post<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/sections/reorder`,
    { outline },
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/** PUT /documents/:slug — full document replacement (forced overwrite). */
export async function putDocument(
  slug: Slug,
  body: DocumentJSONV10,
  etag: string | null,
  changeLog?: string,
): Promise<EditorMutationResult> {
  // PUT requires a ULID id. The schema already includes it.
  const headers: Record<string, string> = {}
  if (etag) headers[HEADER_IF_MATCH] = etag
  if (changeLog) headers[HEADER_CHANGE_LOG] = changeLog
  const res = await apiClient.put<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}`,
    body,
    { headers },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/** POST /documents — create new doc. The response IS a full doc, so we
 *  never need the fallback here. */
export async function postDocument(
  body: DocumentJSONV10,
): Promise<EditorMutationResult> {
  const res = await apiClient.post<ApiEnvelope<DocumentJSONV10>>(
    `/documents`,
    body,
  )
  return unwrap(res as never)
}

/**
 * Version-row shape returned by `GET /documents/:slug/versions`.
 *
 * BE contract (Sprint 1+):
 *   `{ version, edited_by, edited_by_name, edited_at, change_log }`
 *
 * The legacy `created_at` / `author` aliases are kept optional so existing
 * call sites keep compiling, but the FE should prefer the snake_case fields.
 */
export interface VersionRow {
  version: number
  edited_at: string
  edited_by?: string | null
  edited_by_name?: string | null
  change_log?: string | null
  /** @deprecated — fall back when edited_at is absent (very old fixtures). */
  created_at?: string
  /** @deprecated — fall back when edited_by_name is absent. */
  author?: string | null
}

/** GET /documents/:slug/versions */
export async function listVersions(slug: Slug): Promise<VersionRow[]> {
  return unwrapListMaybe<VersionRow>(
    apiClient.get(`/documents/${encodeURIComponent(slug)}/versions`),
  )
}

export interface VersionDetail extends VersionRow {
  content: DocumentJSONV10
}

export async function getVersion(
  slug: Slug,
  version: number,
): Promise<VersionDetail | null> {
  try {
    const res = await apiClient.get<ApiEnvelope<VersionDetail>>(
      `/documents/${encodeURIComponent(slug)}/versions/${version}`,
    )
    return res.data.data ?? null
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return null
    throw err
  }
}

/** POST /documents/:slug/versions/:n/restore */
export async function restoreVersion(
  slug: Slug,
  version: number,
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.post<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/versions/${version}/restore`,
    {},
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/**
 * Detect HTTP 412 Precondition Failed (ETag mismatch). The auto-save loop
 * uses this to surface the conflict modal.
 */
export function isPreconditionFailed(err: unknown): boolean {
  return (
    (err as { response?: { status?: number } })?.response?.status === 412
  )
}

/**
 * PATCH /documents/:slug/variables — set the document's `variables` map. The
 * payload fully replaces (not merges) the existing map; pass `{}` to clear.
 */
export async function patchVariables(
  slug: Slug,
  variables: Record<string, string>,
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.patch<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/variables`,
    { variables },
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/**
 * PATCH /documents/:slug/infobox — set the document's "주요 정보" map.
 * Values may be string or string[]; the BE strips empty entries before
 * persisting. Same If-Match etag handshake as the other patch endpoints.
 */
export async function patchInfobox(
  slug: Slug,
  // Values can be plain string, string[], or the richer InfoboxRich /
  // InfoboxRich[] forms. `null` clears a row.
  infobox: Record<
    string,
    string | string[] | InfoboxRich | InfoboxRich[] | null
  >,
  etag: string,
  changeLog?: string,
): Promise<EditorMutationResult> {
  const res = await apiClient.patch<ApiEnvelope<DocumentJSONV10>>(
    `/documents/${encodeURIComponent(slug)}/infobox`,
    { infobox },
    { headers: buildHeaders(etag, changeLog) },
  )
  return withFullDocFallback(slug, unwrap(res as never))
}

/**
 * Result of PATCH /documents/:slug/custom-css. We surface ``warnings`` so the
 * editor can show "we removed XYZ from your CSS" hints to the admin.
 */
export interface CustomCssMutationResult {
  slug: string
  version: number
  customCss: string
  warnings: string[]
  etag: string
}

/**
 * PATCH /documents/:slug/custom-css — admin-only. Pass empty string to clear.
 * Server sanitizes the CSS (strips ``<script>``, ``expression()``,
 * ``url(javascript:)``, ``@import``, ``behavior:`` …) and returns the
 * cleaned CSS plus a ``warnings`` list naming each pattern stripped.
 */
export async function patchCustomCss(
  slug: Slug,
  customCss: string,
  etag: string,
  changeLog?: string,
): Promise<CustomCssMutationResult> {
  const res = await apiClient.patch<ApiEnvelope<{ slug: string; version: number; custom_css: string }>>(
    `/documents/${encodeURIComponent(slug)}/custom-css`,
    { custom_css: customCss },
    { headers: buildHeaders(etag, changeLog) },
  )
  const meta = (res.data.meta ?? {}) as { etag?: string; warnings?: string[] }
  const headerEtag = (res.headers as Record<string, string | undefined>)['etag']
  const data = res.data.data
  if (!data) throw new Error('서버 응답이 비어 있습니다.')
  return {
    slug: data.slug,
    version: data.version,
    customCss: data.custom_css ?? '',
    warnings: meta.warnings ?? [],
    etag: headerEtag ?? meta.etag ?? '',
  }
}
