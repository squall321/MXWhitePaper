/**
 * Comments API client (Tier 2C → Threaded).
 *
 * Mirrors `apps/api/app/routers/comments.py`. The BE returns the standard
 * `{ data, meta }` envelope; this module unwraps it and exposes typed
 * domain shapes so feature code never deals with raw axios responses.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type CommentAnchorKind = 'document' | 'section' | 'block'
export type CommentStatus = 'visible' | 'hidden' | 'deleted' | 'resolved'

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
  mention_user_ids: string[]
  author_name: string | null
  author_email: string | null
}

/** Tree node — reply 하위 가지가 평탄화된 채로 BE 가 내려준다 (depth ≤ 3). */
export interface CommentNode extends Comment {
  replies: CommentNode[]
}

export interface CommentListResponse {
  /** flat list (created_at ASC) — 클라이언트가 직접 트리를 다시 만들 때 사용. */
  items: Comment[]
  /** server-built tree (depth cap 3) — 가급적 이걸 그대로 그린다. */
  tree?: CommentNode[]
  /** anchor key("kind:id") → root 노드 배열. */
  by_anchor: Record<string, CommentNode[]>
}

export interface CreateCommentInput {
  anchor_kind: CommentAnchorKind
  anchor_id?: string | null
  body_md: string
  parent_id?: string | null
  mention_user_ids?: string[]
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

export async function resolveThread(id: string, resolved = true): Promise<Comment> {
  const res = await apiClient.post<ApiEnvelope<Comment>>(
    `/comments/${encodeURIComponent(id)}/resolve`,
    { resolved },
  )
  return unwrap<Comment>(res)
}

// ── @-mention autocomplete ─────────────────────────────────────────────────

export interface MentionUser {
  id: string
  name: string | null
  email: string
  role: string
}

export async function searchMentionUsers(q: string, limit = 10): Promise<MentionUser[]> {
  if (!q.trim()) return []
  const res = await apiClient.get<ApiEnvelope<MentionUser[]>>('/users/search', {
    params: { q, limit },
  })
  return unwrap<MentionUser[]>(res)
}
