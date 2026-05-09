/**
 * Backups API client (Cycle 0015).
 *
 * Mirrors `apps/api/app/routers/backups.py`. The `apiClient` interceptor
 * injects the bearer token; downloads use a 302 redirect from the BE so the
 * FE just opens the URL in a new tab.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export type BackupScope = 'full' | 'user' | 'doc'
export type BackupCadence = 'daily' | 'weekly' | 'monthly'
export type BackupFormat = 'json' | 'html' | 'md' | 'docx' | 'pptx'

export interface BackupSchedule {
  id: string
  scope: BackupScope
  cadence: BackupCadence
  hour_utc: number
  format: BackupFormat
  target_user_id: string | null
  target_doc_slug: string | null
  enabled: boolean
  last_run_at: string | null
  next_run_at: string | null
  created_by: string
  created_at: string | null
}

export interface BackupRun {
  id: string
  schedule_id: string | null
  scope: BackupScope
  format: BackupFormat
  storage_key: string
  size_bytes: number
  doc_count: number | null
  status: 'running' | 'ok' | 'failed'
  error_message: string | null
  started_at: string | null
  finished_at: string | null
}

export interface CreateScheduleInput {
  scope: BackupScope
  cadence: BackupCadence
  hour_utc?: number
  format: BackupFormat
  target_user_id?: string | null
  target_doc_slug?: string | null
}

export interface PatchScheduleInput {
  cadence?: BackupCadence
  hour_utc?: number
  format?: BackupFormat
  enabled?: boolean
}

export interface RunNowInput {
  scope: BackupScope
  format: BackupFormat
  target_user_id?: string | null
  target_doc_slug?: string | null
}

export interface RunNowResult {
  run_id: string
  size_bytes: number
  doc_count: number
}

export async function listSchedules(): Promise<BackupSchedule[]> {
  const res = await apiClient.get<ApiEnvelope<BackupSchedule[]>>(
    '/backups/schedules',
  )
  return unwrap<BackupSchedule[]>(res)
}

export async function createSchedule(
  body: CreateScheduleInput,
): Promise<BackupSchedule> {
  const res = await apiClient.post<ApiEnvelope<BackupSchedule>>(
    '/backups/schedules',
    body,
  )
  return unwrap<BackupSchedule>(res)
}

export async function patchSchedule(
  id: string,
  body: PatchScheduleInput,
): Promise<BackupSchedule> {
  const res = await apiClient.patch<ApiEnvelope<BackupSchedule>>(
    `/backups/schedules/${encodeURIComponent(id)}`,
    body,
  )
  return unwrap<BackupSchedule>(res)
}

export async function deleteSchedule(id: string): Promise<void> {
  await apiClient.delete(`/backups/schedules/${encodeURIComponent(id)}`)
}

export async function listRuns(limit = 20): Promise<BackupRun[]> {
  const res = await apiClient.get<ApiEnvelope<BackupRun[]>>('/backups/runs', {
    params: { limit },
  })
  return unwrap<BackupRun[]>(res)
}

export async function runNow(body: RunNowInput): Promise<RunNowResult> {
  const res = await apiClient.post<ApiEnvelope<RunNowResult>>(
    '/backups/run-now',
    body,
  )
  return unwrap<RunNowResult>(res)
}

/** Build the absolute URL to GET (redirects to a presigned MinIO URL). */
export function downloadRunUrl(id: string): string {
  const base = (import.meta.env.VITE_API_URL as string) || '/api/v1'
  return `${base}/backups/runs/${encodeURIComponent(id)}/download`
}
