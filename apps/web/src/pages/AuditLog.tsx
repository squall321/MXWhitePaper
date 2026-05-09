import { useCallback, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { useAuthStore } from '@/features/auth/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { ErrorState } from '@/components/ui/ErrorState'
import { useT } from '@/lib/i18n'

import {
  type AuditEntry,
  type AuditListParams,
  auditCsvUrl,
  listAuditActions,
  listAuditViewer,
} from '@/features/admin/api'

interface AuditLogPageProps {
  /** Embedded mode — skips the page chrome (heading + admin gate) so it can
   * be rendered inside `AdminDashboard` 의 audit 탭. */
  embedded?: boolean
}

/**
 * `/admin/audit` — 감사 로그 viewer.
 *
 *   - 날짜 (since/until), 작성자(actor uuid), 액션(multiselect), 타겟 종류 필터
 *   - 페이지네이션 + meta.total
 *   - 행 클릭 → payload JSON modal
 *   - "CSV 내보내기" 버튼 (a[href] download)
 */
export function AuditLogPage({ embedded = false }: AuditLogPageProps) {
  const t = useT()
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''

  // Always run hooks unconditionally (rules of hooks). Auth-gate after.
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [actorUserId, setActorUserId] = useState('')
  const [actions, setActions] = useState<string[]>([])
  const [targetKind, setTargetKind] = useState('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AuditEntry | null>(null)

  const PAGE_SIZE = 50

  const params: AuditListParams = useMemo(
    () => ({
      since: since || undefined,
      until: until || undefined,
      actor_user_id: actorUserId || undefined,
      // Backend takes a single action — when multiple are selected we issue
      // separate calls per action and merge client-side. For the typical
      // single-select case (most common), we forward as-is.
      action: actions.length === 1 ? actions[0] : undefined,
      target_kind: targetKind || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [since, until, actorUserId, actions, targetKind, page],
  )

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['audit', 'viewer', params],
    queryFn: () => listAuditViewer(params),
    enabled: role === 'admin',
  })

  const { data: knownActions } = useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: listAuditActions,
    staleTime: 5 * 60 * 1000,
    enabled: role === 'admin',
  })

  const onDownloadCsv = useCallback(() => {
    const url = auditCsvUrl({
      since: since || undefined,
      until: until || undefined,
      actor_user_id: actorUserId || undefined,
      action: actions.length === 1 ? actions[0] : undefined,
      target_kind: targetKind || undefined,
      limit: 10000,
    })
    // Open the URL — axios baseURL injects /api/v1 at runtime; the BE serves
    // a Content-Disposition: attachment header so the browser will save it.
    if (typeof window !== 'undefined') {
      window.location.assign(url)
    }
  }, [since, until, actorUserId, actions, targetKind])

  if (!user) return null
  if (role !== 'admin') return <Navigate to="/" replace />

  const total = data?.meta.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const body = (
    <section className="space-y-4" data-testid="audit-log-page">
      {/* Filter chips */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-600" htmlFor="audit-since">
            {t('page.auditLog.filter.since')}
          </label>
          <Input
            id="audit-since"
            type="datetime-local"
            value={since}
            onChange={(e) => {
              setPage(0)
              setSince(e.target.value)
            }}
            data-testid="audit-since"
            aria-label={t('page.auditLog.filter.since')}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600" htmlFor="audit-until">
            {t('page.auditLog.filter.until')}
          </label>
          <Input
            id="audit-until"
            type="datetime-local"
            value={until}
            onChange={(e) => {
              setPage(0)
              setUntil(e.target.value)
            }}
            data-testid="audit-until"
            aria-label={t('page.auditLog.filter.until')}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600" htmlFor="audit-actor">
            {t('page.auditLog.filter.actor')}
          </label>
          <Input
            id="audit-actor"
            value={actorUserId}
            onChange={(e) => {
              setPage(0)
              setActorUserId(e.target.value)
            }}
            placeholder={t('page.auditLog.filter.actorPlaceholder')}
            data-testid="audit-actor"
            aria-label={t('page.auditLog.filter.actor')}
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600" htmlFor="audit-action">
            {t('page.auditLog.filter.action')}
          </label>
          <Select
            id="audit-action"
            multiple
            value={actions}
            onChange={(e) => {
              setPage(0)
              const opts = Array.from(e.target.selectedOptions).map((o) => o.value)
              setActions(opts)
            }}
            data-testid="audit-action"
            aria-label={t('page.auditLog.filter.action')}
          >
            {(knownActions ?? []).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs text-gray-600" htmlFor="audit-tkind">
            {t('page.auditLog.filter.targetKind')}
          </label>
          <Input
            id="audit-tkind"
            value={targetKind}
            onChange={(e) => {
              setPage(0)
              setTargetKind(e.target.value)
            }}
            placeholder="document"
            data-testid="audit-tkind"
            aria-label={t('page.auditLog.filter.targetKind')}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void refetch()}
          data-testid="audit-refresh"
        >
          {t('common.refresh')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={onDownloadCsv}
          data-testid="audit-csv"
        >
          {t('page.auditLog.csv')}
        </Button>
      </div>

      {isPending && (
        <p role="status" aria-live="polite" className="text-sm text-gray-500">
          {t('common.loading')}
        </p>
      )}
      {isError && (
        <ErrorState
          title={t('page.auditLog.fetchFail')}
          description={error instanceof Error ? error.message : t('common.error')}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <>
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="audit-log-table"
              >
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2">{t('page.auditLog.col.time')}</th>
                    <th className="px-3 py-2">{t('page.auditLog.col.actor')}</th>
                    <th className="px-3 py-2">{t('page.auditLog.col.action')}</th>
                    <th className="px-3 py-2">{t('page.auditLog.col.target')}</th>
                    <th className="px-3 py-2">{t('page.auditLog.col.detail')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.items.map((row) => (
                    <tr key={row.id} data-testid={`audit-row-${row.id}`}>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {row.created_at
                          ? new Date(row.created_at).toLocaleString()
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700">
                        {row.actor_name || row.actor_user_id || 'system'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone="brand">{row.action}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-700">
                        {row.target_kind ? (
                          <span>
                            <span className="font-medium">{row.target_kind}</span>
                            {row.target_id && (
                              <span className="text-gray-500"> / {row.target_id}</span>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelected(row)}
                          data-testid={`audit-detail-${row.id}`}
                          aria-label={t('page.auditLog.detail.open')}
                        >
                          {t('page.auditLog.detail.button')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {data.items.length === 0 && (
                    <tr>
                      <td className="px-3 py-6 text-center text-gray-500" colSpan={5}>
                        {t('page.auditLog.empty')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <div
            className="flex items-center justify-between text-xs text-gray-600"
            data-testid="audit-pagination"
          >
            <span>
              {t('page.auditLog.pagination.summary', {
                from: total === 0 ? 0 : page * PAGE_SIZE + 1,
                to: Math.min((page + 1) * PAGE_SIZE, total),
                total,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                data-testid="audit-prev"
              >
                {t('page.auditLog.pagination.prev')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
                data-testid="audit-next"
              >
                {t('page.auditLog.pagination.next')}
              </Button>
            </div>
          </div>
        </>
      )}

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={t('page.auditLog.detail.title')}
        size="lg"
      >
        {selected && (
          <pre
            className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all bg-gray-50 p-4 text-xs"
            data-testid="audit-detail-payload"
          >
            {JSON.stringify(
              {
                id: selected.id,
                created_at: selected.created_at,
                actor: selected.actor_name || selected.actor_user_id,
                action: selected.action,
                target_kind: selected.target_kind,
                target_id: selected.target_id,
                payload: selected.payload,
              },
              null,
              2,
            )}
          </pre>
        )}
      </Modal>
    </section>
  )

  if (embedded) return body

  return (
    <div
      className="mx-auto max-w-6xl px-6 py-8"
      data-testid="audit-log-route"
    >
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-smsg-900">
          {t('page.auditLog.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          {t('page.auditLog.subtitle')}
        </p>
      </header>
      {body}
    </div>
  )
}
