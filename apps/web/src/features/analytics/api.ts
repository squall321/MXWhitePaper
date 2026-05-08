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
