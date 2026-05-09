/**
 * Sharing API client. Talks to the FastAPI sharing router (`/share/...`,
 * `/documents/:slug/share`).
 *
 * The public read endpoint is used both by the share modal preview and by
 * the standalone `/share/:token` page; both go through the same axios
 * client, but the public path doesn't *need* an Authorization header — the
 * request interceptor will add one if a token is in storage, and the BE
 * ignores it for that route.
 */
import axios, { type AxiosInstance } from 'axios'
import { apiClient } from '@/lib/api/client'
import {
  readMeta,
  toApiError,
  unwrap,
  type ApiEnvelope,
} from '@/lib/api/envelope'
import type { DocumentJSONV10, Slug } from '@/types/document'
import type { DocumentRow } from '@/features/document/api'

export interface ShareLink {
  id: string
  token: string
  document_id: string
  created_by: string
  expires_at: string | null
  has_password: boolean
  view_count: number
  revoked_at: string | null
  created_at: string | null
  url: string
}

export interface CreateShareInput {
  expires_at?: string | null
  password?: string | null
}

export interface CreateShareResult {
  token: string
  url: string
  expires_at: string | null
  has_password: boolean
}

export interface SharedDocumentResult {
  document: DocumentJSONV10
  row: DocumentRow
  share_meta: {
    token: string
    url: string
    expires_at: string | null
    has_password: boolean
    view_count: number
  }
  meta: { etag?: string }
}

/**
 * POST /api/v1/documents/:slug/share — editor+ creates a token.
 */
export async function createShareLink(
  slug: Slug,
  input: CreateShareInput,
): Promise<CreateShareResult> {
  const body: Record<string, unknown> = {}
  if (input.expires_at) body.expires_at = input.expires_at
  if (input.password) body.password = input.password
  const res = await apiClient.post<ApiEnvelope<CreateShareResult>>(
    `/documents/${encodeURIComponent(slug)}/share`,
    body,
  )
  return unwrap(res)
}

/**
 * GET /api/v1/documents/:slug/share — editor+ lists active links.
 */
export async function listShareLinks(slug: Slug): Promise<ShareLink[]> {
  const res = await apiClient.get<
    ApiEnvelope<{ items: ShareLink[] }>
  >(`/documents/${encodeURIComponent(slug)}/share`)
  return unwrap(res).items ?? []
}

/**
 * DELETE /api/v1/share/:token — creator (or admin) revokes a link.
 */
export async function revokeShareLink(token: string): Promise<void> {
  await apiClient.delete(`/share/${encodeURIComponent(token)}`)
}

/**
 * Standalone axios instance for the public share read. We deliberately omit
 * the auth interceptors and credentials so that:
 *   - browser doesn't ship cookies/tokens for the public route,
 *   - 401 from the password gate isn't intercepted into a refresh loop.
 */
function publicClient(): AxiosInstance {
  const baseURL = (import.meta.env.VITE_API_URL as string) || '/api/v1'
  return axios.create({ baseURL, timeout: 15_000, withCredentials: false })
}

/**
 * GET /api/v1/share/:token — public document read. Throws an `ApiError` with
 * `code === 'UNAUTHORIZED'` when the link requires a password, `'GONE'` when
 * expired/revoked, `'NOT_FOUND'` when the token doesn't exist.
 */
export async function readSharedDocument(
  token: string,
  password?: string,
): Promise<SharedDocumentResult> {
  const cli = publicClient()
  const headers: Record<string, string> = {}
  if (password) headers['X-Share-Password'] = password
  try {
    const res = await cli.get<
      ApiEnvelope<{
        document: DocumentJSONV10
        row: DocumentRow
        share_meta: SharedDocumentResult['share_meta']
      }>
    >(`/share/${encodeURIComponent(token)}`, { headers })
    const data = unwrap(res)
    return {
      document: data.document,
      row: data.row,
      share_meta: data.share_meta,
      meta: readMeta<{ etag?: string }>(res),
    }
  } catch (err) {
    throw toApiError(err)
  }
}
