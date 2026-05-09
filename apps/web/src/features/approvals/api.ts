/**
 * Approvals API client — talks to the FastAPI approvals router
 * (`/documents/:slug/reviewers`, `/documents/:slug/transition`, `/me/reviews`).
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { Slug } from '@/types/document'

export type ReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'changes_requested'

export type DocStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'published'
  | 'archived'

export interface Reviewer {
  id: string
  document_id: string
  reviewer_user_id: string
  status: ReviewStatus
  comment: string | null
  reviewed_at: string | null
  added_at: string | null
  reviewer_email: string | null
  reviewer_name: string | null
}

export interface MyReviewItem {
  slug: string
  title: string
  doc_status: DocStatus
  review_status: ReviewStatus
  added_at: string | null
  reviewed_at: string | null
  author_id: string | null
  author_name: string | null
  author_email: string | null
}

export interface AddReviewersResult {
  items: Reviewer[]
  added: string[]
  skipped: string[]
}

export async function listReviewers(slug: Slug): Promise<Reviewer[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: Reviewer[] }>>(
    `/documents/${encodeURIComponent(slug)}/reviewers`,
  )
  return unwrap(res).items ?? []
}

export async function addReviewers(
  slug: Slug,
  userIds: string[],
): Promise<AddReviewersResult> {
  const res = await apiClient.post<ApiEnvelope<AddReviewersResult>>(
    `/documents/${encodeURIComponent(slug)}/reviewers`,
    { user_ids: userIds },
  )
  return unwrap(res)
}

export async function removeReviewer(slug: Slug, userId: string): Promise<void> {
  await apiClient.delete(
    `/documents/${encodeURIComponent(slug)}/reviewers/${encodeURIComponent(userId)}`,
  )
}

export async function submitDecision(
  slug: Slug,
  userId: string,
  status: 'approved' | 'rejected' | 'changes_requested',
  comment?: string,
): Promise<{ items: Reviewer[] }> {
  const res = await apiClient.post<ApiEnvelope<{ items: Reviewer[] }>>(
    `/documents/${encodeURIComponent(slug)}/reviewers/${encodeURIComponent(userId)}/decision`,
    { status, comment: comment ?? null },
  )
  return unwrap(res)
}

export async function transitionStatus(
  slug: Slug,
  status: DocStatus,
): Promise<{ slug: string; status: DocStatus; from: DocStatus }> {
  const res = await apiClient.post<
    ApiEnvelope<{ slug: string; status: DocStatus; from: DocStatus }>
  >(`/documents/${encodeURIComponent(slug)}/transition`, { status })
  return unwrap(res)
}

export async function listMyReviews(): Promise<MyReviewItem[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: MyReviewItem[] }>>(
    `/me/reviews`,
  )
  return unwrap(res).items ?? []
}
