/**
 * Snippets (block library) API client.
 *
 * 미러: `apps/api/app/routers/snippets.py`. 표준 envelope unwrap.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { Block } from '@/types/document'

export type SnippetScope = 'private' | 'team' | 'org'

export interface SnippetSummary {
  id: string
  owner_user_id: string
  scope: SnippetScope
  name: string
  description: string | null
  block_count: number
  /** 1-line preview of the first block's text-ish field. */
  preview: string
  tags: string[]
  use_count: number
  created_at: string | null
  updated_at: string | null
}

export interface Snippet extends Omit<SnippetSummary, 'block_count' | 'preview'> {
  blocks: Block[]
}

export interface CreateSnippetInput {
  name: string
  description?: string | null
  blocks: Block[]
  scope?: SnippetScope
  tags?: string[]
}

export interface PatchSnippetInput {
  name?: string
  description?: string | null
  scope?: SnippetScope
  tags?: string[]
}

export interface ListSnippetsOptions {
  scope?: SnippetScope
  q?: string
  limit?: number
  offset?: number
}

export async function listSnippets(
  opts: ListSnippetsOptions = {},
): Promise<SnippetSummary[]> {
  const params: Record<string, string | number> = {}
  if (opts.scope) params.scope = opts.scope
  if (opts.q) params.q = opts.q
  if (opts.limit != null) params.limit = opts.limit
  if (opts.offset != null) params.offset = opts.offset
  const res = await apiClient.get<ApiEnvelope<{ items: SnippetSummary[] }>>(
    '/snippets',
    { params },
  )
  return unwrap(res).items
}

export async function getSnippet(id: string): Promise<Snippet> {
  const res = await apiClient.get<ApiEnvelope<Snippet>>(
    `/snippets/${encodeURIComponent(id)}`,
  )
  return unwrap(res)
}

export async function createSnippet(
  body: CreateSnippetInput,
): Promise<{ snippet_id: string }> {
  const res = await apiClient.post<ApiEnvelope<{ snippet_id: string }>>(
    '/snippets',
    body,
  )
  return unwrap(res)
}

export async function patchSnippet(
  id: string,
  body: PatchSnippetInput,
): Promise<Snippet> {
  const res = await apiClient.patch<ApiEnvelope<Snippet>>(
    `/snippets/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteSnippet(id: string): Promise<void> {
  await apiClient.delete(`/snippets/${encodeURIComponent(id)}`)
}

export async function useSnippet(
  id: string,
): Promise<{ snippet_id: string; use_count: number }> {
  const res = await apiClient.post<ApiEnvelope<{ snippet_id: string; use_count: number }>>(
    `/snippets/${encodeURIComponent(id)}/use`,
  )
  return unwrap(res)
}
