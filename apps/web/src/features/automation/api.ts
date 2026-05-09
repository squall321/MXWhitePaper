/**
 * Automation rules API client (Cycle 0025).
 *
 * Talks to `/automation/rules` (admin-only). The shape mirrors the
 * FastAPI router 1:1 — `trigger_filter` and `action_payload` are
 * free-form JSON dictionaries whose meaning depends on `trigger_kind` /
 * `action_kind`.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type AutomationTriggerKind =
  | 'doc_published'
  | 'doc_archived'
  | 'review_decided'
  | 'status_transition'
  | 'comment_added'
  | 'tag_added'
  | 'cron'

export const ALL_AUTOMATION_TRIGGERS: AutomationTriggerKind[] = [
  'doc_published',
  'doc_archived',
  'review_decided',
  'status_transition',
  'comment_added',
  'tag_added',
  'cron',
]

export type AutomationActionKind =
  | 'webhook'
  | 'notification_blast'
  | 'add_tag'
  | 'remove_tag'
  | 'transition'
  | 'email_subscribers'

export const ALL_AUTOMATION_ACTIONS: AutomationActionKind[] = [
  'webhook',
  'notification_blast',
  'add_tag',
  'remove_tag',
  'transition',
  'email_subscribers',
]

export interface AutomationRule {
  id: string
  name: string
  trigger_kind: AutomationTriggerKind
  trigger_filter: Record<string, unknown>
  action_kind: AutomationActionKind
  action_payload: Record<string, unknown>
  enabled: boolean
  created_by: string | null
  created_at: string | null
  last_fired_at: string | null
  fire_count: number
  // Cycle 15 U4 — populated only when `trigger_kind === 'cron'`.
  cron_expression: string | null
  next_cron_run_at: string | null
  // Cycle 20 — IANA tz name; defaults to 'UTC'. Returned for every rule
  // even when trigger_kind != 'cron' (the column NOT NULL DEFAULT).
  cron_timezone: string
}

/**
 * Common IANA timezones offered in the admin form. Not exhaustive —
 * the BE accepts any zoneinfo entry, this list is just for UX.
 */
export const COMMON_CRON_TIMEZONES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Seoul', label: 'Asia/Seoul (KST)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'America/New_York', label: 'America/New_York (ET)' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AET)' },
]

export interface AutomationRunLog {
  id: number
  triggered_at: string | null
  trigger_payload: Record<string, unknown>
  status: 'ok' | 'failed' | 'skipped'
  error_message: string | null
}

export interface CreateAutomationRuleIn {
  name: string
  trigger_kind: AutomationTriggerKind
  trigger_filter?: Record<string, unknown>
  action_kind: AutomationActionKind
  action_payload?: Record<string, unknown>
  enabled?: boolean
  cron_expression?: string
  cron_timezone?: string
}

export interface PatchAutomationRuleIn {
  name?: string
  trigger_kind?: AutomationTriggerKind
  trigger_filter?: Record<string, unknown>
  action_kind?: AutomationActionKind
  action_payload?: Record<string, unknown>
  enabled?: boolean
  cron_expression?: string
  cron_timezone?: string
}

export interface TestAutomationRuleResult {
  rule_id: string
  dry_run: boolean
  status: 'ok' | 'failed' | 'skipped'
  error_message: string | null
}

export async function listAutomationRules(): Promise<AutomationRule[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: AutomationRule[] }>>(
    '/automation/rules',
  )
  return unwrap(res).items ?? []
}

export async function getAutomationRule(id: string): Promise<AutomationRule> {
  const res = await apiClient.get<ApiEnvelope<AutomationRule>>(
    `/automation/rules/${encodeURIComponent(id)}`,
  )
  return unwrap(res)
}

export async function createAutomationRule(
  body: CreateAutomationRuleIn,
): Promise<AutomationRule> {
  const res = await apiClient.post<ApiEnvelope<AutomationRule>>(
    '/automation/rules',
    body,
  )
  return unwrap(res)
}

export async function patchAutomationRule(
  id: string,
  body: PatchAutomationRuleIn,
): Promise<AutomationRule> {
  const res = await apiClient.patch<ApiEnvelope<AutomationRule>>(
    `/automation/rules/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteAutomationRule(id: string): Promise<void> {
  await apiClient.delete(`/automation/rules/${encodeURIComponent(id)}`)
}

export async function listAutomationRuns(
  id: string,
  limit = 50,
): Promise<AutomationRunLog[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: AutomationRunLog[] }>>(
    `/automation/rules/${encodeURIComponent(id)}/runs?limit=${limit}`,
  )
  return unwrap(res).items ?? []
}

export async function testAutomationRule(
  id: string,
  body: { dry_run?: boolean; payload?: Record<string, unknown> } = {},
): Promise<TestAutomationRuleResult> {
  const res = await apiClient.post<ApiEnvelope<TestAutomationRuleResult>>(
    `/automation/rules/${encodeURIComponent(id)}/test`,
    body,
  )
  return unwrap(res)
}
