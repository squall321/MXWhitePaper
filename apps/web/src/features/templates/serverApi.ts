/**
 * Server-backed document templates API client (cycle 0020).
 *
 * Mirrors `apps/api/app/routers/doc_templates.py`. Lives next to the
 * existing hard-coded `templates.ts` library — the gallery merges both
 * sources at render time. We deliberately keep this module small (no
 * react-query wiring) so it can be imported from both the gallery and
 * the AdminDashboard manager page without circular dependencies.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { SectionLevel1 } from '@/types/document'

export type ServerTemplateScope = 'private' | 'team' | 'org'
export type ServerTemplateCategory =
  | 'report'
  | 'collab'
  | 'tech'
  | 'announce'
  | 'custom'

export interface ServerTemplateSummary {
  id: string
  slug: string
  title: string
  description: string | null
  category: ServerTemplateCategory
  thumb_image_id: string | null
  section_count: number
  scope: ServerTemplateScope
  use_count: number
  created_by: string | null
  author_name: string | null
  created_at: string | null
  updated_at: string | null
}

export interface ServerTemplate
  extends Omit<ServerTemplateSummary, 'section_count'> {
  sections: SectionLevel1[]
}

export interface CreateServerTemplateInput {
  slug?: string
  title: string
  description?: string | null
  category: ServerTemplateCategory
  thumb_image_id?: string | null
  sections: SectionLevel1[]
  scope?: ServerTemplateScope
}

export interface PatchServerTemplateInput {
  title?: string
  description?: string | null
  category?: ServerTemplateCategory
  thumb_image_id?: string | null
  sections?: SectionLevel1[]
  scope?: ServerTemplateScope
}

export interface ListServerTemplatesOptions {
  scope?: ServerTemplateScope
  category?: ServerTemplateCategory
  q?: string
  limit?: number
  offset?: number
}

export interface UseServerTemplateInput {
  target_slug: string
  title?: string
}

export async function listServerTemplates(
  opts: ListServerTemplatesOptions = {},
): Promise<ServerTemplateSummary[]> {
  const params: Record<string, string | number> = {}
  if (opts.scope) params.scope = opts.scope
  if (opts.category) params.category = opts.category
  if (opts.q) params.q = opts.q
  if (opts.limit != null) params.limit = opts.limit
  if (opts.offset != null) params.offset = opts.offset
  const res = await apiClient.get<
    ApiEnvelope<{ items: ServerTemplateSummary[] }>
  >('/doc-templates', { params })
  return unwrap(res).items
}

export async function getServerTemplate(slug: string): Promise<ServerTemplate> {
  const res = await apiClient.get<ApiEnvelope<ServerTemplate>>(
    `/doc-templates/${encodeURIComponent(slug)}`,
  )
  return unwrap(res)
}

export async function createServerTemplate(
  body: CreateServerTemplateInput,
): Promise<{ template_id: string; slug: string }> {
  const res = await apiClient.post<
    ApiEnvelope<{ template_id: string; slug: string }>
  >('/doc-templates', body)
  return unwrap(res)
}

export async function patchServerTemplate(
  slug: string,
  body: PatchServerTemplateInput,
): Promise<ServerTemplate> {
  const res = await apiClient.patch<ApiEnvelope<ServerTemplate>>(
    `/doc-templates/${encodeURIComponent(slug)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteServerTemplate(slug: string): Promise<void> {
  await apiClient.delete(`/doc-templates/${encodeURIComponent(slug)}`)
}

export async function useServerTemplate(
  slug: string,
  body: UseServerTemplateInput,
): Promise<{ slug: string; id: string }> {
  const res = await apiClient.post<ApiEnvelope<{ slug: string; id: string }>>(
    `/doc-templates/${encodeURIComponent(slug)}/use`,
    body,
  )
  return unwrap(res)
}
