/**
 * Usage analytics API (Tier 2D).
 *
 * Read-only — reader+ can call. Mirrors `apps/api/app/routers/analytics.py`.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface AnalyticsOverview {
  mau: number
  total_docs: number
  total_links: number
  avg_backlinks: number
  top_searches: Array<{ q: string; count: number }>
  top_viewed_docs: Array<{
    target: string
    slug: string
    title: string
    count: number
  }>
}

export interface DailyMetric {
  date: string
  active_users: number
  doc_writes: number
  doc_reads: number
  search_count: number
}

export interface TopViewedDoc {
  target: string
  slug: string
  title: string
  count: number
}

export async function getOverview(): Promise<AnalyticsOverview> {
  const res = await apiClient.get<ApiEnvelope<AnalyticsOverview>>(
    '/analytics/overview',
  )
  return unwrap<AnalyticsOverview>(res)
}

export async function getDaily(days: number = 30): Promise<DailyMetric[]> {
  const res = await apiClient.get<ApiEnvelope<DailyMetric[]>>(
    '/analytics/daily',
    { params: { days } },
  )
  return unwrap<DailyMetric[]>(res)
}

export async function getTopViews(days: number = 7): Promise<TopViewedDoc[]> {
  const res = await apiClient.get<ApiEnvelope<TopViewedDoc[]>>(
    '/analytics/top-views',
    { params: { days } },
  )
  return unwrap<TopViewedDoc[]>(res)
}

// ── Cycle 0016 — per-doc + inactive + top docs ────────────────────────

export interface DocViewBucket {
  date: string
  views: number
}

export interface DocReferrer {
  kind: string
  count: number
}

export interface DocSectionAttention {
  section_id: string
  section_title: string
  est_seconds_per_visitor: number
}

export interface DocAnalytics {
  slug: string
  title: string
  total_views: number
  unique_readers: number
  avg_read_seconds: number
  median_read_seconds: number
  last_30_days: DocViewBucket[]
  top_referrers: DocReferrer[]
  section_attention: DocSectionAttention[]
}

export async function getDocAnalytics(slug: string): Promise<DocAnalytics> {
  const res = await apiClient.get<ApiEnvelope<DocAnalytics>>(
    `/analytics/documents/${encodeURIComponent(slug)}`,
  )
  return unwrap<DocAnalytics>(res)
}

export interface InactiveDoc {
  slug: string
  title: string
  last_edited: string | null
  last_read: string | null
  owner_name: string
}

export async function getInactiveDocs(
  sinceDays: number = 90,
): Promise<InactiveDoc[]> {
  const res = await apiClient.get<ApiEnvelope<InactiveDoc[]>>(
    '/analytics/inactive-docs',
    { params: { since_days: sinceDays } },
  )
  return unwrap<InactiveDoc[]>(res)
}

export interface TopDoc {
  slug: string
  title: string
  views: number
  unique_readers: number
  avg_read_seconds: number
}

export async function getTopDocs(
  days: number = 30,
  limit: number = 20,
): Promise<TopDoc[]> {
  const res = await apiClient.get<ApiEnvelope<TopDoc[]>>(
    '/analytics/top-docs',
    { params: { days, limit } },
  )
  return unwrap<TopDoc[]>(res)
}
