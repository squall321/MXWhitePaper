import { apiClient } from '@/lib/api/client'
import {
  isNotFound,
  readMeta,
  unwrap,
  unwrapListMaybe,
  unwrapMaybe,
  type ApiEnvelope,
} from '@/lib/api/envelope'
import type { DocumentJSONV10, Slug } from '@/types/document'

export interface DocumentMetaEnvelope {
  version?: number
  etag?: string
  updated_at?: string
  owners?: { id: string; name: string }[]
}

/**
 * Server response row for `GET /documents/:slug`. The DocumentJSON v1.0 body
 * lives under `content` per the BE contract; the surrounding fields are the
 * `documents` table row.
 */
export interface DocumentRow {
  id: string
  slug: Slug
  title: string
  summary?: string | null
  status?: string
  version?: number
  schema_ver?: string
  owner_id?: string
  part_id?: string | null
  created_at?: string
  updated_at?: string
  content: DocumentJSONV10
}

export interface DocumentResult {
  /** DocumentJSON v1.0 — pulled out of `data.content` for ergonomics. */
  document: DocumentJSONV10
  /** The full row (so callers can read `updated_at`, `owner_id`, …). */
  row: DocumentRow
  meta: DocumentMetaEnvelope
}

export interface ListDocumentsParams {
  limit?: number
  offset?: number
  part?: string
  tag?: string
  q?: string
}

/**
 * Light "card" shape for document lists.
 */
export interface DocumentCard {
  id: string
  slug: Slug
  title: string
  summary?: string
  division?: string
  team?: string
  group?: string
  part?: string
  updated_at?: string
}

/**
 * GET /api/v1/documents/:slug
 * Envelope: `{ data: { ...row, content: DocumentJSON }, meta: { etag } }`.
 */
export async function getDocument(slug: Slug): Promise<DocumentResult> {
  const res = await apiClient.get<ApiEnvelope<DocumentRow>>(
    `/documents/${encodeURIComponent(slug)}`,
  )
  const row = unwrap(res)
  return {
    document: row.content,
    row,
    meta: readMeta<DocumentMetaEnvelope>(res),
  }
}

/**
 * GET /api/v1/documents?limit&offset&part&tag&q
 */
export async function listDocuments(
  params: ListDocumentsParams = {},
): Promise<DocumentCard[]> {
  return unwrapListMaybe<DocumentCard>(
    apiClient.get('/documents', { params }),
  )
}

/**
 * Backlink row from `GET /api/v1/documents/:slug/backlinks`.
 */
export interface BacklinkRow {
  slug: Slug
  title: string
  summary?: string | null
  anchor?: string | null
  sections_referenced: number
}

/**
 * Backlinks response — items + a flag indicating whether the *target* doc
 * (i.e., the slug we asked about) actually exists. The BE puts the flag in
 * `meta.target_exists`; we surface it on the FE result so callers can render
 * a "이 문서 작성하기" CTA when the target doesn't exist yet.
 */
export interface BacklinksResult {
  items: BacklinkRow[]
  /** True when the target slug points at a real (non-archived) document. */
  targetExists: boolean
}

export async function getBacklinks(slug: Slug): Promise<BacklinksResult> {
  try {
    const res = await apiClient.get<ApiEnvelope<BacklinkRow[]>>(
      `/documents/${encodeURIComponent(slug)}/backlinks`,
    )
    const meta = readMeta<{ target_exists?: boolean; total?: number }>(res)
    return {
      items: Array.isArray(res.data?.data) ? (res.data.data as BacklinkRow[]) : [],
      // Default to true so a transient error never paints the "missing" CTA.
      targetExists: meta.target_exists !== false,
    }
  } catch (err) {
    // 404 here means the BE could not resolve the target slug — the doc is
    // missing and there are no backlinks. 5xx degrades the same way so a
    // partially-built backend never blocks the article render.
    if (isNotFound(err)) return { items: [], targetExists: false }
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status != null && status >= 500) {
      return { items: [], targetExists: true }
    }
    throw err
  }
}

/**
 * Cheap existence check used by WikiLink. The backend has no HEAD endpoint,
 * so we issue GET and translate 404 → false. TanStack Query will cache
 * the result; the WikiLink hook sets a 5-minute stale time.
 */
export async function checkDocumentExists(slug: Slug): Promise<boolean> {
  try {
    const value = await unwrapMaybe<DocumentRow | null>(
      apiClient.get<ApiEnvelope<DocumentRow | null>>(
        `/documents/${encodeURIComponent(slug)}`,
      ),
      null,
    )
    return value !== null
  } catch {
    // 5xx / network — treat as "exists" so we don't paint everything red.
    return true
  }
}
