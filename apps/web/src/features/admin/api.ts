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

// ── Audit viewer (BE: apps/api/app/routers/audit.py) ─────────────────────
export interface AuditEntry {
  id: string
  actor_user_id: string | null
  actor_name: string | null
  action: string
  target_kind: string | null
  target_id: string | null
  payload: Record<string, unknown> | null
  created_at: string | null
}

export interface AuditListParams {
  since?: string
  until?: string
  actor_user_id?: string
  action?: string
  target_kind?: string
  limit?: number
  offset?: number
}

export interface AuditListMeta {
  count: number
  total: number
  limit: number
  offset: number
}

export interface AuditListResult {
  items: AuditEntry[]
  meta: AuditListMeta
}

export async function listAuditViewer(
  params: AuditListParams,
): Promise<AuditListResult> {
  const res = await apiClient.get<ApiEnvelope<AuditEntry[]>>('/audit', {
    params,
  })
  const items = unwrap<AuditEntry[]>(res)
  const meta = (res.data?.meta ?? {
    count: items.length,
    total: items.length,
    limit: params.limit ?? items.length,
    offset: params.offset ?? 0,
  }) as unknown as AuditListMeta
  return { items, meta }
}

export async function listAuditActions(): Promise<string[]> {
  const res = await apiClient.get<ApiEnvelope<string[]>>('/audit/actions')
  return unwrap<string[]>(res)
}

/** Build a relative URL for the CSV export (axios baseURL prefixed). */
export function auditCsvUrl(params: AuditListParams): string {
  const base =
    (import.meta.env.VITE_API_URL as string | undefined) || `${import.meta.env.BASE_URL}api/v1`
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }
  const tail = qs.toString()
  return `${base}/audit/csv${tail ? `?${tail}` : ''}`
}

export async function getAdminHealth(): Promise<AdminHealth> {
  const res = await apiClient.get<ApiEnvelope<AdminHealth>>('/admin/health')
  return unwrap<AdminHealth>(res)
}

// ── Health dashboard (operations view) ───────────────────────────────────
export interface HealthBucket {
  name: string
  count: number
  size_bytes: number
  error?: string
}
export interface HealthIndex {
  uid: string
  count: number
}
export interface HealthTicker {
  name: string
  running: boolean
  last_tick_at: string | null
  next_due_at: string | null
}
export interface HealthDashboard {
  uptime_seconds: number
  version: string
  database: {
    pool_size: number
    checked_out: number
    overflow: number
    ok: boolean
    error?: string
  }
  minio: {
    endpoint: string
    buckets: HealthBucket[]
    ok: boolean
    error?: string
  }
  meilisearch: {
    url: string
    indexes: HealthIndex[]
    ok: boolean
    error?: string
  }
  tickers: HealthTicker[]
  errors_24h: number
  rate_limit: {
    active_buckets: number
    active_blocks: number
  }
  queue_depths: {
    automation_pending: number
    webhook_deliveries_pending: number
    subscription_digest_buffer: number
  }
}

export async function getHealthDashboard(): Promise<HealthDashboard> {
  const res = await apiClient.get<ApiEnvelope<HealthDashboard>>(
    '/admin/health-dashboard',
  )
  return unwrap<HealthDashboard>(res)
}

export async function runMaintenance(): Promise<MaintenanceResult> {
  const res = await apiClient.post<ApiEnvelope<MaintenanceResult>>(
    '/admin/maintenance/run',
  )
  return unwrap<MaintenanceResult>(res)
}

// ── Archived documents (cycle 8) ─────────────────────────────────────────
export interface ArchivedDoc {
  slug: string
  title: string
  archived_at: string | null
  owner_id: string | null
  owner_name: string | null
  owner_email: string | null
  last_edited_at: string | null
}

export interface ArchivedDocsListMeta {
  count: number
  total: number
  limit: number
  offset: number
}

export interface ArchivedDocsListResult {
  items: ArchivedDoc[]
  meta: ArchivedDocsListMeta
}

export interface ArchivedDocsListParams {
  since_days?: number
  author?: string
  team_id?: string
  limit?: number
  offset?: number
}

export async function listArchivedDocs(
  params: ArchivedDocsListParams,
): Promise<ArchivedDocsListResult> {
  const res = await apiClient.get<ApiEnvelope<ArchivedDoc[]>>(
    '/admin/archived-docs',
    { params },
  )
  const items = unwrap<ArchivedDoc[]>(res)
  const meta = (res.data?.meta ?? {
    count: items.length,
    total: items.length,
    limit: params.limit ?? items.length,
    offset: params.offset ?? 0,
  }) as unknown as ArchivedDocsListMeta
  return { items, meta }
}

export interface ArchivedDocsRestoreResult {
  restored: string[]
  skipped: Array<{ slug: string; reason: string }>
}

export async function restoreArchivedDocs(
  slugs: string[],
): Promise<ArchivedDocsRestoreResult> {
  const res = await apiClient.post<ApiEnvelope<ArchivedDocsRestoreResult>>(
    '/admin/archived-docs/restore',
    { slugs },
  )
  return unwrap<ArchivedDocsRestoreResult>(res)
}

export interface ArchivedDocsPurgeResult {
  purged: string[]
  skipped: Array<{ slug: string; reason: string }>
}

export async function purgeArchivedDocs(
  slugs: string[],
  force = false,
): Promise<ArchivedDocsPurgeResult> {
  const res = await apiClient.delete<ApiEnvelope<ArchivedDocsPurgeResult>>(
    '/admin/archived-docs/purge',
    { data: { slugs, force } },
  )
  return unwrap<ArchivedDocsPurgeResult>(res)
}
