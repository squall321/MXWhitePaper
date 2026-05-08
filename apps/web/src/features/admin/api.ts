/**
 * Admin dashboard typed API wrappers (Tier 2D).
 *
 * Mirrors `apps/api/app/routers/admin.py`. Every endpoint requires an admin
 * JWT — the `apiClient` interceptor injects the bearer token automatically.
 */
import { apiClient } from '@/lib/api/client'
import { unwrap, type ApiEnvelope } from '@/lib/api/envelope'

export interface AdminUser {
  id: string
  email: string
  name: string
  role: 'reader' | 'editor' | 'owner' | 'admin'
  team_id: string | null
  is_active: boolean
  created_at: string | null
  last_login_at: string | null
}

export interface AdminAuditEntry {
  id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  action: string
  target: string
  payload: Record<string, unknown> | null
  created_at: string | null
}

export interface AdminHealth {
  docs_active: number
  docs_archived: number
  users_active: number
  users_inactive: number
  audit_24h: number
  images: number
  pending_uploads: number
  meilisearch_docs: number
}

export interface MaintenanceResult {
  purged_pending: number
  compacted_versions: number
}

export interface UserPatchInput {
  role?: AdminUser['role']
  is_active?: boolean
}

export async function listAdminUsers(params: {
  q?: string
  role?: string
  limit?: number
}): Promise<AdminUser[]> {
  const res = await apiClient.get<ApiEnvelope<AdminUser[]>>('/admin/users', {
    params,
  })
  return unwrap<AdminUser[]>(res)
}

export async function patchAdminUser(
  id: string,
  body: UserPatchInput,
): Promise<AdminUser> {
  const res = await apiClient.patch<ApiEnvelope<AdminUser>>(
    `/admin/users/${id}`,
    body,
  )
  return unwrap<AdminUser>(res)
}

export async function listAuditLogs(params: {
  action?: string
  user?: string
  since?: string
  limit?: number
}): Promise<AdminAuditEntry[]> {
  const res = await apiClient.get<ApiEnvelope<AdminAuditEntry[]>>(
    '/admin/audit',
    { params },
  )
  return unwrap<AdminAuditEntry[]>(res)
}

export async function getAdminHealth(): Promise<AdminHealth> {
  const res = await apiClient.get<ApiEnvelope<AdminHealth>>('/admin/health')
  return unwrap<AdminHealth>(res)
}

export async function runMaintenance(): Promise<MaintenanceResult> {
  const res = await apiClient.post<ApiEnvelope<MaintenanceResult>>(
    '/admin/maintenance/run',
  )
  return unwrap<MaintenanceResult>(res)
}
