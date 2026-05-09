/**
 * Audit retention API client (Cycle 0032).
 *
 * Talks to `/admin/audit-retention` (admin-only). Mirrors
 * `apps/api/app/routers/audit_retention.py` 1:1.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface AuditRetentionConfig {
  retain_days: number
  enabled: boolean
  last_run_at: string | null
  rows_pruned_total: number
  updated_at: string | null
  audit_log_total: number
}

export interface PatchAuditRetentionIn {
  retain_days?: number
  enabled?: boolean
}

export interface PruneNowResult {
  rows_pruned: number
}

export async function getAuditRetention(): Promise<AuditRetentionConfig> {
  const res = await apiClient.get<ApiEnvelope<AuditRetentionConfig>>(
    '/admin/audit-retention',
  )
  return unwrap(res)
}

export async function patchAuditRetention(
  body: PatchAuditRetentionIn,
): Promise<AuditRetentionConfig> {
  const res = await apiClient.patch<ApiEnvelope<AuditRetentionConfig>>(
    '/admin/audit-retention',
    body,
  )
  return unwrap(res)
}

export async function pruneAuditNow(): Promise<PruneNowResult> {
  const res = await apiClient.post<ApiEnvelope<PruneNowResult>>(
    '/admin/audit-retention/prune-now',
  )
  return unwrap(res)
}

/** Slider stops per the mandate. */
export const RETAIN_DAY_OPTIONS: number[] = [30, 90, 180, 365, 730, 1825]
