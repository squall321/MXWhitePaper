/**
 * Version-tags API client (Cycle 16).
 *
 * 미러: `apps/api/app/routers/version_tags.py`. Envelope `{data, meta}` 를
 * 풀어 도메인 형으로 노출한다.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface VersionTag {
  id: string
  document_id: string
  version: number
  tag_name: string
  description: string | null
  tagged_by: string | null
  tagged_by_name: string | null
  tagged_at: string | null
  is_locked: boolean
}

export interface CreateVersionTagBody {
  tag_name: string
  description?: string | null
  is_locked?: boolean
}

export interface BranchFromTagResponse {
  slug: string
  version: number
  branched_from: {
    slug: string
    version: number
    tag_name: string
  }
}

export async function createVersionTag(
  slug: string,
  version: number,
  body: CreateVersionTagBody,
): Promise<VersionTag> {
  const res = await apiClient.post<ApiEnvelope<VersionTag>>(
    `/documents/${encodeURIComponent(slug)}/versions/${version}/tags`,
    body,
  )
  return unwrap(res)
}

export async function listVersionTags(slug: string): Promise<VersionTag[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: VersionTag[] }>>(
    `/documents/${encodeURIComponent(slug)}/version-tags`,
  )
  return unwrap(res).items
}

export async function deleteVersionTag(
  slug: string,
  tagName: string,
): Promise<void> {
  await apiClient.delete(
    `/documents/${encodeURIComponent(slug)}/version-tags/${encodeURIComponent(
      tagName,
    )}`,
  )
}

export async function branchFromTag(
  slug: string,
  body: { tag_name: string; target_slug: string },
): Promise<BranchFromTagResponse> {
  const res = await apiClient.post<ApiEnvelope<BranchFromTagResponse>>(
    `/documents/${encodeURIComponent(slug)}/branch-from-tag`,
    body,
  )
  return unwrap(res)
}

/** React Query keys. */
export const versionTagsKey = (slug: string) =>
  ['version-tags', slug] as const
