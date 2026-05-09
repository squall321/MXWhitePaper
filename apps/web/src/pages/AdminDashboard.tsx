import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import { ActivityWidget } from '@/features/activity/ActivityWidget'
import { AdminOrgsPage } from './AdminOrgs'
import { AuditLogPage } from './AuditLog'
import { BackupAdminPage } from './BackupAdmin'
import { BulkDocImportPage } from './BulkDocImport'
import { TagManagerPage } from './TagManager'
import { TemplateManagerPage } from './TemplateManager'
import { WebhooksSettingsPage } from './WebhooksSettings'
import { useT } from '@/lib/i18n'
import {
  type AdminHealth,
  type AdminUser,
  getAdminHealth,
  listAdminUsers,
  patchAdminUser,
  runMaintenance,
} from '@/features/admin/api'

type TabKey =
  | 'users'
  | 'audit'
  | 'health'
  | 'maintenance'
  | 'orgs'
  | 'tags'
  | 'templates'
  | 'webhooks'
  | 'backups'
  | 'import-csv'

/** Tabs reference an i18n key; the visible label is resolved at render. */
const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'users', labelKey: 'page.adminDashboard.tab.users' },
  { key: 'audit', labelKey: 'page.adminDashboard.tab.audit' },
  { key: 'health', labelKey: 'page.adminDashboard.tab.health' },
  { key: 'maintenance', labelKey: 'page.adminDashboard.tab.maintenance' },
  { key: 'orgs', labelKey: 'page.adminDashboard.tab.orgs' },
  { key: 'tags', labelKey: 'page.adminDashboard.tab.tags' },
  { key: 'templates', labelKey: 'page.adminDashboard.tab.templates' },
  { key: 'webhooks', labelKey: 'page.adminDashboard.tab.webhooks' },
  { key: 'backups', labelKey: 'page.adminDashboard.tab.backups' },
  { key: 'import-csv', labelKey: 'page.adminDashboard.tab.importCsv' },
]

const ROLE_OPTIONS = [
  { value: 'reader', label: 'reader' },
  { value: 'editor', label: 'editor' },
  { value: 'owner', label: 'owner' },
  { value: 'admin', label: 'admin' },
]

/**
 * `/admin/dashboard` — admin operations console.
 *
 *   - 사용자: role/active 인라인 편집
 *   - 감사 로그: action / user / since 필터
 *   - 시스템 상태: 헬스 카운터
 *   - 유지보수: 한 방 sweep + version compaction
 *   - 조직: 기존 `/admin/orgs` 페이지를 탭으로 임베드
 */
export function AdminDashboardPage() {
  const t = useT()
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const [tab, setTab] = useState<TabKey>('users')

  if (!user) return null
  if (role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="mx-auto max-w-6xl px-6 py-8" data-testid="admin-dashboard-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-smsg-900">{t('page.adminDashboard.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {t('page.adminDashboard.subtitle')}
        </p>
      </header>

      <div className="mb-6" data-testid="admin-activity-widget-slot">
        <ActivityWidget title={t('page.adminDashboard.activityTitle')} />
      </div>

      <nav
        role="tablist"
        aria-label={t('page.adminDashboard.tabsAria')}
        className="mb-6 flex flex-wrap gap-1 border-b border-gray-200"
      >
        {TABS.map((tabDef) => (
          <button
            key={tabDef.key}
            role="tab"
            aria-selected={tab === tabDef.key}
            data-testid={`admin-tab-${tabDef.key}`}
            onClick={() => setTab(tabDef.key)}
            className={
              'border-b-2 px-3 py-2 text-sm transition-colors ' +
              (tab === tabDef.key
                ? 'border-smsg-700 text-smsg-900 font-semibold'
                : 'border-transparent text-gray-600 hover:text-smsg-900')
            }
          >
            {t(tabDef.labelKey)}
          </button>
        ))}
      </nav>

      {tab === 'users' && <UsersTab />}
      {tab === 'audit' && (
        <div data-testid="admin-audit-tab">
          <AuditLogPage embedded />
        </div>
      )}
      {tab === 'health' && <HealthTab />}
      {tab === 'maintenance' && <MaintenanceTab />}
      {tab === 'orgs' && (
        <div data-testid="admin-tab-orgs-content">
          <AdminOrgsPage />
        </div>
      )}
      {tab === 'tags' && (
        <div data-testid="admin-tab-tags-content">
          <TagManagerPage />
        </div>
      )}
      {tab === 'templates' && (
        <div data-testid="admin-tab-templates-content">
          <TemplateManagerPage />
        </div>
      )}
      {tab === 'webhooks' && (
        <div data-testid="admin-tab-webhooks-content">
          <WebhooksSettingsPage />
        </div>
      )}
      {tab === 'backups' && (
        <div data-testid="admin-tab-backups-content">
          <BackupAdminPage />
        </div>
      )}
      {tab === 'import-csv' && (
        <div data-testid="admin-tab-import-csv-content">
          <BulkDocImportPage />
        </div>
      )}
    </div>
  )
}

// ── Users ───────────────────────────────────────────────────────────────
function UsersTab() {
  const t = useT()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')

  const params = useMemo(
    () => ({ q: q || undefined, role: roleFilter || undefined, limit: 100 }),
    [q, roleFilter],
  )

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () => listAdminUsers(params),
  })

  const onPatch = useCallback(
    async (id: string, body: Parameters<typeof patchAdminUser>[1]) => {
      try {
        await patchAdminUser(id, body)
        toast.success(t('page.adminDashboard.users.saved'))
        await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('page.adminDashboard.users.saveFail'))
      }
    },
    [qc, t],
  )

  return (
    <section data-testid="admin-users-tab" className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600" htmlFor="admin-users-q">
            {t('page.adminDashboard.users.search')}
          </label>
          <Input
            id="admin-users-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('page.adminDashboard.users.searchPlaceholder')}
            data-testid="admin-users-q"
            aria-label={t('page.adminDashboard.users.search')}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600" htmlFor="admin-users-role">
            {t('page.adminDashboard.users.role')}
          </label>
          <Select
            id="admin-users-role"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            data-testid="admin-users-role"
            aria-label={t('page.adminDashboard.users.role')}
          >
            <option value="">{t('page.adminDashboard.users.allRoles')}</option>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isPending && (
        <p role="status" aria-live="polite" className="text-sm text-gray-500">
          {t('common.loading')}
        </p>
      )}
      {isError && (
        <ErrorState
          title={t('page.adminDashboard.users.fetchFail')}
          description={error instanceof Error ? error.message : t('common.error')}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-users-table">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">{t('page.adminDashboard.users.colName')}</th>
                  <th className="px-3 py-2">{t('page.adminDashboard.users.colRole')}</th>
                  <th className="px-3 py-2">{t('page.adminDashboard.users.colActive')}</th>
                  <th className="px-3 py-2">{t('page.adminDashboard.users.colLastLogin')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((u) => (
                  <UserRow key={u.id} user={u} onPatch={onPatch} />
                ))}
                {data.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-gray-500" colSpan={4}>
                      {t('page.adminDashboard.users.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  )
}

function UserRow({
  user,
  onPatch,
}: {
  user: AdminUser
  onPatch: (id: string, body: Parameters<typeof patchAdminUser>[1]) => void
}) {
  const t = useT()
  const [role, setRole] = useState(user.role)
  const [active, setActive] = useState(user.is_active)
  const dirty = role !== user.role || active !== user.is_active
  return (
    <tr data-testid={`admin-user-row-${user.email}`}>
      <td className="px-3 py-2">
        <div className="font-medium text-smsg-900">{user.name || user.email}</div>
        <div className="text-xs text-gray-500">{user.email}</div>
      </td>
      <td className="px-3 py-2">
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as AdminUser['role'])}
          data-testid={`admin-user-role-${user.email}`}
          aria-label={t('page.adminDashboard.users.role')}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </td>
      <td className="px-3 py-2">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            data-testid={`admin-user-active-${user.email}`}
            aria-label={t('page.adminDashboard.users.colActive')}
          />
          <span className="text-xs text-gray-600">
            {active
              ? t('page.adminDashboard.users.active')
              : t('page.adminDashboard.users.inactive')}
          </span>
        </label>
      </td>
      <td className="px-3 py-2 text-xs text-gray-500">
        {user.last_login_at
          ? new Date(user.last_login_at).toLocaleString()
          : '—'}
        <div className="mt-1">
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty}
            data-testid={`admin-user-save-${user.email}`}
            onClick={() => onPatch(user.id, { role, is_active: active })}
          >
            {t('page.adminDashboard.users.save')}
          </Button>
        </div>
      </td>
    </tr>
  )
}

// ── Health ──────────────────────────────────────────────────────────────
function HealthTab() {
  const t = useT()
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: getAdminHealth,
    staleTime: 10_000,
  })

  return (
    <section data-testid="admin-health-tab" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-smsg-900">{t('page.adminDashboard.health.title')}</h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void refetch()}
          data-testid="admin-health-refresh"
        >
          {t('common.refresh')}
        </Button>
      </div>
      {isPending && (
        <p role="status" aria-live="polite" className="text-sm text-gray-500">
          {t('common.loading')}
        </p>
      )}
      {isError && (
        <ErrorState
          title={t('page.adminDashboard.health.fetchFail')}
          description={error instanceof Error ? error.message : t('common.error')}
          onRetry={() => void refetch()}
        />
      )}
      {data && <HealthGrid h={data} />}
    </section>
  )
}

function HealthGrid({ h }: { h: AdminHealth }) {
  const t = useT()
  const items: Array<{ label: string; value: number }> = [
    { label: t('page.adminDashboard.health.docsActive'), value: h.docs_active },
    { label: t('page.adminDashboard.health.docsArchived'), value: h.docs_archived },
    { label: t('page.adminDashboard.health.usersActive'), value: h.users_active },
    { label: t('page.adminDashboard.health.usersInactive'), value: h.users_inactive },
    { label: t('page.adminDashboard.health.audit24h'), value: h.audit_24h },
    { label: t('page.adminDashboard.health.images'), value: h.images },
    { label: t('page.adminDashboard.health.pendingUploads'), value: h.pending_uploads },
    { label: t('page.adminDashboard.health.meiliDocs'), value: h.meilisearch_docs },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="admin-health-grid">
      {items.map((it) => (
        <Card key={it.label} padded="md">
          <div className="text-xs text-gray-500">{it.label}</div>
          <div className="mt-1 text-2xl font-bold text-smsg-900">
            {it.value.toLocaleString()}
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Maintenance ─────────────────────────────────────────────────────────
function MaintenanceTab() {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{
    at: string
    purged: number
    compacted: number
  } | null>(null)

  const onRun = useCallback(async () => {
    setBusy(true)
    try {
      const res = await runMaintenance()
      setLast({
        at: new Date().toISOString(),
        purged: res.purged_pending,
        compacted: res.compacted_versions,
      })
      toast.success(
        t('page.adminDashboard.maintenance.success', {
          p: res.purged_pending,
          v: res.compacted_versions,
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('page.adminDashboard.maintenance.fail'))
    } finally {
      setBusy(false)
    }
  }, [t])

  return (
    <section data-testid="admin-maintenance-tab" className="space-y-4">
      <Card padded="lg">
        <h2 className="text-lg font-semibold text-smsg-900">
          {t('page.adminDashboard.maintenance.title')}
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          {t('page.adminDashboard.maintenance.description')}
        </p>
        <div className="mt-4">
          <Button
            size="lg"
            variant="primary"
            onClick={onRun}
            disabled={busy}
            data-testid="admin-maintenance-run"
          >
            {busy
              ? t('page.adminDashboard.maintenance.running')
              : t('page.adminDashboard.maintenance.run')}
          </Button>
        </div>
        {last && (
          <p
            className="mt-4 text-xs text-gray-500"
            data-testid="admin-maintenance-last"
            role="status"
            aria-live="polite"
          >
            {t('page.adminDashboard.maintenance.last', {
              at: new Date(last.at).toLocaleString(),
              p: last.purged,
              v: last.compacted,
            })}
          </p>
        )}
      </Card>
    </section>
  )
}
