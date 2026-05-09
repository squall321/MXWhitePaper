import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import { ActivityWidget } from '@/features/activity/ActivityWidget'
import { AdminOrgsPage } from './AdminOrgs'
import { BackupAdminPage } from './BackupAdmin'
import { TagManagerPage } from './TagManager'
import { WebhooksSettingsPage } from './WebhooksSettings'
import {
  type AdminAuditEntry,
  type AdminHealth,
  type AdminUser,
  getAdminHealth,
  listAdminUsers,
  listAuditLogs,
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
  | 'webhooks'
  | 'backups'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'users', label: '사용자' },
  { key: 'audit', label: '감사 로그' },
  { key: 'health', label: '시스템 상태' },
  { key: 'maintenance', label: '유지보수' },
  { key: 'orgs', label: '조직' },
  { key: 'tags', label: '태그' },
  { key: 'webhooks', label: '웹훅' },
  { key: 'backups', label: '백업' },
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
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const [tab, setTab] = useState<TabKey>('users')

  if (!user) return null
  if (role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="mx-auto max-w-6xl px-6 py-8" data-testid="admin-dashboard-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-smsg-900">관리자 대시보드</h1>
        <p className="mt-1 text-sm text-gray-600">
          유저/감사/헬스/유지보수 — 운영 전용. 모든 변경은 audit_logs 에 남습니다.
        </p>
      </header>

      <div className="mb-6" data-testid="admin-activity-widget-slot">
        <ActivityWidget title="최근 활동 — 시스템 전체" />
      </div>

      <nav
        role="tablist"
        aria-label="관리자 탭"
        className="mb-6 flex flex-wrap gap-1 border-b border-gray-200"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            data-testid={`admin-tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={
              'border-b-2 px-3 py-2 text-sm transition-colors ' +
              (tab === t.key
                ? 'border-smsg-700 text-smsg-900 font-semibold'
                : 'border-transparent text-gray-600 hover:text-smsg-900')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'users' && <UsersTab />}
      {tab === 'audit' && <AuditTab />}
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
    </div>
  )
}

// ── Users ───────────────────────────────────────────────────────────────
function UsersTab() {
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
        toast.success('변경 저장됨')
        await qc.invalidateQueries({ queryKey: ['admin', 'users'] })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '저장 실패')
      }
    },
    [qc],
  )

  return (
    <section data-testid="admin-users-tab" className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">검색</label>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름/이메일"
            data-testid="admin-users-q"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">role</label>
          <Select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            data-testid="admin-users-role"
          >
            <option value="">전체</option>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="유저를 불러올 수 없습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="admin-users-table">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">이름 / 이메일</th>
                  <th className="px-3 py-2">role</th>
                  <th className="px-3 py-2">활성</th>
                  <th className="px-3 py-2">마지막 로그인</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((u) => (
                  <UserRow key={u.id} user={u} onPatch={onPatch} />
                ))}
                {data.length === 0 && (
                  <tr>
                    <td className="px-3 py-6 text-center text-gray-500" colSpan={4}>
                      유저가 없습니다
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
          />
          <span className="text-xs text-gray-600">{active ? '활성' : '비활성'}</span>
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
            저장
          </Button>
        </div>
      </td>
    </tr>
  )
}

// ── Audit logs ──────────────────────────────────────────────────────────
function AuditTab() {
  const [action, setAction] = useState('')
  const [user, setUser] = useState('')
  const [since, setSince] = useState('')

  const params = useMemo(
    () => ({
      action: action || undefined,
      user: user || undefined,
      since: since || undefined,
      limit: 100,
    }),
    [action, user, since],
  )

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () => listAuditLogs(params),
  })

  return (
    <section data-testid="admin-audit-tab" className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600">action</label>
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="document.create"
            data-testid="admin-audit-action"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">user</label>
          <Input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="이메일/UUID"
            data-testid="admin-audit-user"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">since (ISO)</label>
          <Input
            value={since}
            onChange={(e) => setSince(e.target.value)}
            placeholder="2026-05-01T00:00:00Z"
            data-testid="admin-audit-since"
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void refetch()}
          data-testid="admin-audit-refresh"
        >
          새로고침
        </Button>
      </div>

      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="감사 로그 불러오기 실패"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}
      {data && (
        <Card padded={false}>
          <ul
            className="max-h-[60vh] divide-y divide-gray-100 overflow-y-auto text-sm"
            data-testid="admin-audit-list"
          >
            {data.map((row) => (
              <AuditRow key={row.id} row={row} />
            ))}
            {data.length === 0 && (
              <li className="px-3 py-6 text-center text-gray-500">
                일치하는 항목 없음
              </li>
            )}
          </ul>
        </Card>
      )}
    </section>
  )
}

function AuditRow({ row }: { row: AdminAuditEntry }) {
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">{row.action}</Badge>
        <span className="text-xs text-gray-700">{row.target}</span>
        <span className="ml-auto text-xs text-gray-500">
          {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
        </span>
      </div>
      <div className="mt-1 text-xs text-gray-600">
        {row.user_email || row.user_id || 'system'}
      </div>
    </li>
  )
}

// ── Health ──────────────────────────────────────────────────────────────
function HealthTab() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: getAdminHealth,
    staleTime: 10_000,
  })

  return (
    <section data-testid="admin-health-tab" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-smsg-900">시스템 상태</h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void refetch()}
          data-testid="admin-health-refresh"
        >
          새로고침
        </Button>
      </div>
      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="헬스 정보 실패"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}
      {data && <HealthGrid h={data} />}
    </section>
  )
}

function HealthGrid({ h }: { h: AdminHealth }) {
  const items: Array<{ label: string; value: number }> = [
    { label: '활성 문서', value: h.docs_active },
    { label: '아카이브 문서', value: h.docs_archived },
    { label: '활성 유저', value: h.users_active },
    { label: '비활성 유저', value: h.users_inactive },
    { label: '24h 감사 로그', value: h.audit_24h },
    { label: '이미지', value: h.images },
    { label: 'pending 업로드', value: h.pending_uploads },
    { label: 'Meili 인덱스', value: h.meilisearch_docs },
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
        `정리 완료 — pending ${res.purged_pending}, versions ${res.compacted_versions}`,
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '유지보수 실패')
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <section data-testid="admin-maintenance-tab" className="space-y-4">
      <Card padded="lg">
        <h2 className="text-lg font-semibold text-smsg-900">유지보수</h2>
        <p className="mt-1 text-sm text-gray-600">
          만료된 임시 업로드를 정리하고, 오래된 버전을 보존 정책에 따라 압축합니다.
          한 번 클릭으로 두 sweep 가 모두 실행됩니다.
        </p>
        <div className="mt-4">
          <Button
            size="lg"
            variant="primary"
            onClick={onRun}
            disabled={busy}
            data-testid="admin-maintenance-run"
          >
            {busy ? '실행 중…' : '유지보수 실행'}
          </Button>
        </div>
        {last && (
          <p className="mt-4 text-xs text-gray-500" data-testid="admin-maintenance-last">
            마지막 실행: {new Date(last.at).toLocaleString()} — pending {last.purged}, versions{' '}
            {last.compacted}
          </p>
        )}
      </Card>
    </section>
  )
}
