/**
 * Comments API client (Tier 2C).
 *
 * Mirrors `apps/api/app/routers/comments.py`. The BE returns the standard
 * `{ data, meta }` envelope; this module unwraps it and exposes typed
 * domain shapes so feature code never deals with raw axios responses.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type CommentAnchorKind = 'document' | 'section' | 'block'
export type CommentStatus = 'visible' | 'hidden' | 'deleted'

export interface Comment {
  id: string
  document_id: string
  anchor_kind: CommentAnchorKind
  anchor_id: string | null
  body_md: string
  author_id: string
  parent_id: string | null
  status: CommentStatus
  created_at: string | null
  updated_at: string | null
  author_name: string | null
  author_email: string | null
}

export interface CommentListResponse {
  items: Comment[]
  by_anchor: Record<string, Comment[]>
}

export interface CreateCommentInput {
  anchor_kind: CommentAnchorKind
  anchor_id?: string | null
  body_md: string
  parent_id?: string | null
}

export interface PatchCommentInput {
  body_md?: string
  status?: CommentStatus
}

export async function listComments(slug: string): Promise<CommentListResponse> {
  const res = await apiClient.get<ApiEnvelope<CommentListResponse>>(
    `/documents/${encodeURIComponent(slug)}/comments`,
  )
  return unwrap<CommentListResponse>(res)
}

export async function createComment(
  slug: string,
  body: CreateCommentInput,
): Promise<Comment> {
  const res = await apiClient.post<ApiEnvelope<Comment>>(
    `/documents/${encodeURIComponent(slug)}/comments`,
    body,
  )
  return unwrap<Comment>(res)
}

export async function patchComment(
  id: string,
  body: PatchCommentInput,
): Promise<Comment> {
  const res = await apiClient.patch<ApiEnvelope<Comment>>(
    `/comments/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap<Comment>(res)
}

export async function deleteComment(id: string): Promise<void> {
  await apiClient.delete(`/comments/${encodeURIComponent(id)}`)
}
