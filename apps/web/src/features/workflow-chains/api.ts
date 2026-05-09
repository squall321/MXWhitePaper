/**
 * Workflow chains API client (Cycle 18).
 *
 * Mirrors `apps/api/app/routers/workflow_chains.py`. Each chain owns an
 * ordered list of steps; PATCH replaces the steps array atomically.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'
import type { AutomationActionKind } from '@/features/automation/api'

export type FailStrategy = 'halt' | 'continue' | 'rollback'

export const ALL_FAIL_STRATEGIES: FailStrategy[] = [
  'halt',
  'continue',
  'rollback',
]

export interface WorkflowChainStep {
  id: string
  chain_id: string
  ordering: number
  rule_id: string | null
  action_kind: AutomationActionKind | 'trigger_chain' | null
  action_payload: Record<string, unknown>
  delay_seconds: number
  fail_strategy: FailStrategy
}

export interface WorkflowChain {
  id: string
  name: string
  description: string | null
  enabled: boolean
  created_by: string | null
  created_at: string | null
  updated_at: string | null
  step_count?: number
  last_run_at?: string | null
  steps?: WorkflowChainStep[]
}

export interface WorkflowChainRun {
  id: number
  triggered_at: string | null
  trigger_payload: Record<string, unknown>
  status: 'running' | 'ok' | 'failed' | 'rolled_back'
  steps_completed: number
  steps_failed: number
  finished_at: string | null
  error_message: string | null
}

export interface StepInput {
  ordering: number
  rule_id?: string | null
  action_kind?: string | null
  action_payload?: Record<string, unknown>
  delay_seconds?: number
  fail_strategy?: FailStrategy
}

export interface CreateWorkflowChainIn {
  name: string
  description?: string | null
  enabled?: boolean
  steps?: StepInput[]
}

export interface PatchWorkflowChainIn {
  name?: string
  description?: string | null
  enabled?: boolean
  steps?: StepInput[]
}

export async function listWorkflowChains(): Promise<WorkflowChain[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: WorkflowChain[] }>>(
    '/workflow-chains',
  )
  return unwrap(res).items ?? []
}

export async function getWorkflowChain(id: string): Promise<WorkflowChain> {
  const res = await apiClient.get<ApiEnvelope<WorkflowChain>>(
    `/workflow-chains/${encodeURIComponent(id)}`,
  )
  return unwrap(res)
}

export async function createWorkflowChain(
  body: CreateWorkflowChainIn,
): Promise<WorkflowChain> {
  const res = await apiClient.post<ApiEnvelope<WorkflowChain>>(
    '/workflow-chains',
    body,
  )
  return unwrap(res)
}

export async function patchWorkflowChain(
  id: string,
  body: PatchWorkflowChainIn,
): Promise<WorkflowChain> {
  const res = await apiClient.patch<ApiEnvelope<WorkflowChain>>(
    `/workflow-chains/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap(res)
}

export async function deleteWorkflowChain(id: string): Promise<void> {
  await apiClient.delete(`/workflow-chains/${encodeURIComponent(id)}`)
}

export async function runWorkflowChainNow(
  id: string,
  body: { trigger_payload?: Record<string, unknown> } = {},
): Promise<{
  chain_id: string
  run_id: number | null
  status: WorkflowChainRun['status']
  steps_completed: number
  steps_failed: number
  error_message: string | null
}> {
  const res = await apiClient.post<
    ApiEnvelope<{
      chain_id: string
      run_id: number | null
      status: WorkflowChainRun['status']
      steps_completed: number
      steps_failed: number
      error_message: string | null
    }>
  >(`/workflow-chains/${encodeURIComponent(id)}/run-now`, body)
  return unwrap(res)
}

export async function listWorkflowChainRuns(
  id: string,
  limit = 50,
): Promise<WorkflowChainRun[]> {
  const res = await apiClient.get<ApiEnvelope<{ items: WorkflowChainRun[] }>>(
    `/workflow-chains/${encodeURIComponent(id)}/runs?limit=${limit}`,
  )
  return unwrap(res).items ?? []
}
