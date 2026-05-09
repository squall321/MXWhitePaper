/**
 * Retention policies API client (Cycle 0027).
 *
 * Talks to `/admin/retention-policies` (admin-only). Mirrors
 * `apps/api/app/routers/retention.py` 1:1.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type RetentionAction = 'archive' | 'notify_owner' | 'transition'

export const ALL_RETENTION_ACTIONS: RetentionAction[] = [
  'archive',
  'notify_owner',
  'transition',
]

export type RetentionTriggerField =
  | 'updated_at'
  | 'last_read_at'
  | 'created_at'

export const ALL_RETENTION_TRIGGER_FIELDS: RetentionTriggerField[] = [
  'updated_at',
  'last_read_at',
  'created_at',
]

export interface RetentionScopeFilter {
  part_id?: string
  tag?: string
  status?: string
  owner_id?: string
}

export interface RetentionPolicy {
  id: string
  name: string
  scope_filter: RetentionScopeFilter
  action: RetentionAction
  action_payload: Record<string, unknown>
  trigger_age_days: number
  trigger_field: RetentionTriggerField
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_by: string | null
  created_at: string | null
  run_count?: number
}

export interface RetentionRun {
  id: number
  run_at: string | null
  affected_doc_count: number
  status: 'ok' | 'failed' | 'dry_run'
  error_message: string | null
  doc_slugs: string[]
}

export interface CreateRetentionPolicyIn {
  name: string
  scope_filter?: RetentionScopeFilter
  action: RetentionAction
  action_payload?: Record<string, unknown>
  trigger_age_days: number
  trigger_field: RetentionTriggerField
  enabled?: boolean
}

export interface PatchRetentionPolicyIn {
  name?: string
  scope_filter?: RetentionScopeFilter
  action?: RetentionAction
  action_payload?: Record<string, unknown>
  trigger_age_days?: number
  trigger_field?: RetentionTriggerField
  enabled?: boolean
}

export interface RetentionRunResult {
  policy_id: string
  status: 'ok' | 'failed' | 'dry_run'
  affected_doc_count: number
  doc_slugs: string[]
  error_message: string | null
}

export async function listRetentionPolicies(): Promise<RetentionPolicy[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: RetentionPolicy[] }>>(
    '/admin/retention-policies',
  )
  return unwrap(res).items ?? []
}

export async function createRetentionPolicy(
  body: CreateRetentionPolicyIn,
): Promise<RetentionPolicy> {
  const res = await apiClient.post<ApiEnvelope<RetentionPolicy>>(
    '/admin/retention-policies',
    body,
  )
  return unwrap(res)
}

export async function patchRetentionPolicy(
  id: string,
  body: PatchRetentionPolicyIn,
): Promise<RetentionPolicy> {
  const res = await apiClient.patch<ApiEnvelope<RetentionPolicy>>(
    `/admin/retention-policies/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteRetentionPolicy(id: string): Promise<void> {
  await apiClient.delete(
    `/admin/retention-policies/${encodeURIComponent(id)}`,
  )
}

export async function dryRunRetentionPolicy(
  id: string,
): Promise<RetentionRunResult> {
  const res = await apiClient.post<ApiEnvelope<RetentionRunResult>>(
    `/admin/retention-policies/${encodeURIComponent(id)}/dry-run`,
  )
  return unwrap(res)
}

export async function runRetentionPolicy(
  id: string,
): Promise<RetentionRunResult> {
  const res = await apiClient.post<ApiEnvelope<RetentionRunResult>>(
    `/admin/retention-policies/${encodeURIComponent(id)}/run`,
  )
  return unwrap(res)
}

export async function listRetentionRuns(
  id: string,
  limit = 20,
): Promise<RetentionRun[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: RetentionRun[] }>>(
    `/admin/retention-policies/${encodeURIComponent(id)}/runs?limit=${limit}`,
  )
  return unwrap(res).items ?? []
}
