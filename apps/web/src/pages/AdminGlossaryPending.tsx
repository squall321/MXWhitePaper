import { useCallback, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuthStore } from '@/features/auth/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { toast } from '@/components/ui/Toast'
import {
  approveGlossaryTerm,
  listPendingGlossary,
  rejectGlossaryTerm,
  type PendingGlossaryTerm,
} from '@/features/glossary/api'
import { RejectReasonModal } from '@/features/glossary/components/RejectReasonModal'

const PAGE_SIZE = 20

interface BulkProgress {
  done: number
  total: number
  failed: number
  mode: 'approve' | 'reject'
}

interface RejectTarget {
  /** null = bulk over the current selection. */
  id: string | null
  /** Human label for the modal header. Bulk uses "n건". */
  label: string
}

/**
 * `/admin/glossary-pending` — FR-04/05/06 moderation console.
 * Admin guard mirrors the sibling pages (AdminOrgs/AdminDashboard).
 */
export function AdminGlossaryPendingPage() {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  const qc = useQueryClient()

  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejectTarget, setRejectTarget] = useState<RejectTarget | null>(null)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [progress, setProgress] = useState<BulkProgress | null>(null)

  const query = useQuery({
    queryKey: ['glossary', 'pending', { page, size: PAGE_SIZE }],
    queryFn: () => listPendingGlossary({ page, size: PAGE_SIZE }),
    enabled: role === 'admin',
    placeholderData: keepPreviousData,
  })

  const items = query.data?.items ?? []
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // After any mutation we invalidate both the pending list and the public
  // glossary list (an approve flips status='approved' so the term should
  // appear there immediately).
  const invalidateAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['glossary', 'pending'] })
    void qc.invalidateQueries({ queryKey: ['glossary'] })
  }, [qc])

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveGlossaryTerm(id),
  })
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectGlossaryTerm(id, reason),
  })

  const markBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const onApproveOne = useCallback(
    async (term: PendingGlossaryTerm) => {
      markBusy(term.id, true)
      try {
        await approveMutation.mutateAsync(term.id)
        toast.success(`승인됨: ${term.term}`)
        setSelected((prev) => {
          if (!prev.has(term.id)) return prev
          const next = new Set(prev)
          next.delete(term.id)
          return next
        })
        invalidateAll()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '승인 실패')
      } finally {
        markBusy(term.id, false)
      }
    },
    [approveMutation, invalidateAll, markBusy],
  )

  const openRejectOne = useCallback((term: PendingGlossaryTerm) => {
    setRejectTarget({ id: term.id, label: term.term })
  }, [])

  const openRejectBulk = useCallback(() => {
    if (selected.size === 0) return
    setRejectTarget({ id: null, label: `${selected.size}건 일괄` })
  }, [selected])

  const onConfirmReject = useCallback(
    async (reason: string) => {
      if (!rejectTarget) return
      // Single
      if (rejectTarget.id) {
        const id = rejectTarget.id
        const target = items.find((it) => it.id === id)
        const label = target?.term ?? id
        markBusy(id, true)
        try {
          await rejectMutation.mutateAsync({ id, reason })
          toast.success(`거부됨: ${label}`)
          setSelected((prev) => {
            if (!prev.has(id)) return prev
            const next = new Set(prev)
            next.delete(id)
            return next
          })
          invalidateAll()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : '거부 실패')
        } finally {
          markBusy(id, false)
          setRejectTarget(null)
        }
        return
      }
      // Bulk
      const ids = Array.from(selected)
      if (ids.length === 0) {
        setRejectTarget(null)
        return
      }
      setBulkBusy(true)
      setProgress({ done: 0, total: ids.length, failed: 0, mode: 'reject' })
      const results = await Promise.allSettled(
        ids.map((id) => rejectMutation.mutateAsync({ id, reason })),
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      setProgress({ done: ids.length, total: ids.length, failed, mode: 'reject' })
      if (failed === 0) toast.success(`${ids.length}건 거부됨`)
      else toast.warn(`${ids.length - failed}건 성공, ${failed}건 실패`)
      setSelected(new Set())
      setBulkBusy(false)
      setRejectTarget(null)
      invalidateAll()
    },
    [rejectTarget, items, rejectMutation, selected, markBusy, invalidateAll],
  )

  const onBulkApprove = useCallback(async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    // D6 polish — bulk approve was firing without any confirmation,
    // making accidental "approve N pending terms" a single misclick
    // away. Reject already gates through RejectReasonModal; mirror that
    // with a lightweight window.confirm gate so the destructive side of
    // the toolbar gets the same friction.
    if (ids.length >= 3) {
      const ok =
        typeof window === 'undefined' ||
        window.confirm(`${ids.length}건을 일괄 승인할까요?`)
      if (!ok) return
    }
    setBulkBusy(true)
    setProgress({ done: 0, total: ids.length, failed: 0, mode: 'approve' })
    const results = await Promise.allSettled(
      ids.map((id) => approveMutation.mutateAsync(id)),
    )
    const failed = results.filter((r) => r.status === 'rejected').length
    setProgress({ done: ids.length, total: ids.length, failed, mode: 'approve' })
    if (failed === 0) toast.success(`${ids.length}건 승인됨`)
    else toast.warn(`${ids.length - failed}건 성공, ${failed}건 실패`)
    setSelected(new Set())
    setBulkBusy(false)
    invalidateAll()
  }, [selected, approveMutation, invalidateAll])

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const allOnPageIds = useMemo(() => items.map((it) => it.id), [items])
  const allOnPageSelected =
    allOnPageIds.length > 0 && allOnPageIds.every((id) => selected.has(id))
  const someOnPageSelected = allOnPageIds.some((id) => selected.has(id))

  const toggleAllOnPage = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) {
        for (const id of allOnPageIds) next.delete(id)
      } else {
        for (const id of allOnPageIds) next.add(id)
      }
      return next
    })
  }, [allOnPageIds, allOnPageSelected])

  if (!user) return null
  if (role !== 'admin') return <Navigate to="/" replace />

  return (
    <div
      className="mx-auto max-w-6xl px-6 py-8"
      data-testid="admin-glossary-pending-page"
    >
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-smsg-900">용어집 승인 대기</h1>
        <p className="mt-1 text-sm text-gray-600">
          제안된 용어를 검토하고 승인 또는 거부합니다.{' '}
          <span data-testid="admin-glossary-pending-total">총 {total}건</span>
        </p>
      </header>

      {/* Bulk action toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2" data-testid="admin-glossary-pending-toolbar">
        <span className="text-sm text-gray-600" data-testid="admin-glossary-pending-selected">
          선택 {selected.size}건
        </span>
        <Button
          size="sm"
          variant="primary"
          onClick={onBulkApprove}
          disabled={selected.size === 0 || bulkBusy}
          data-testid="admin-glossary-pending-bulk-approve"
          aria-disabled={selected.size === 0 || bulkBusy || undefined}
        >
          선택 {selected.size}건 승인
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={openRejectBulk}
          disabled={selected.size === 0 || bulkBusy}
          data-testid="admin-glossary-pending-bulk-reject"
          aria-disabled={selected.size === 0 || bulkBusy || undefined}
        >
          선택 {selected.size}건 거부
        </Button>
        {progress && (
          <div
            className="flex items-center gap-2"
            role="status"
            aria-live="polite"
            data-testid="admin-glossary-pending-progress"
          >
            <span className="text-xs text-gray-500">
              {progress.mode === 'approve' ? '승인' : '거부'} 진행:{' '}
              {progress.done}/{progress.total}
              {progress.failed > 0 && ` (실패 ${progress.failed})`}
            </span>
            {/* D6 polish — accompany the textual count with a visible
             * progressbar. Width-percent drives the fill so the bar shows
             * partial completion while the Promise.allSettled batch is
             * still resolving. */}
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.done}
              data-testid="admin-glossary-pending-progress-bar"
              className="h-1.5 w-32 overflow-hidden rounded bg-gray-200"
            >
              <div
                className={
                  progress.failed > 0
                    ? 'h-full bg-amber-500 transition-all'
                    : 'h-full bg-smsg-500 transition-all'
                }
                style={{
                  width: `${Math.min(100, Math.round((progress.done / Math.max(1, progress.total)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {query.isPending && (
        <p role="status" aria-live="polite" className="text-sm text-gray-500">
          불러오는 중…
        </p>
      )}

      {query.isError && (
        <ErrorState
          title="목록을 불러오지 못했습니다"
          description={
            query.error instanceof Error ? query.error.message : '알 수 없는 오류'
          }
          onRetry={() => void query.refetch()}
        />
      )}

      {!query.isPending && !query.isError && items.length === 0 && (
        <Card padded="lg">
          <p
            className="py-10 text-center text-sm text-gray-500"
            data-testid="admin-glossary-pending-empty"
          >
            승인 대기 중인 제안이 없습니다.
          </p>
        </Card>
      )}

      {items.length > 0 && (
        <>
          {/* Desktop table (sm+) */}
          <Card padded={false} className="hidden sm:block">
            <div className="overflow-x-auto">
              <table
                className="w-full text-sm"
                data-testid="admin-glossary-pending-table"
              >
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 w-10">
                      {/* D6 polish — wrap the indeterminate checkbox so
                       * a partial selection gets a visible bracket on
                       * Chrome/Firefox (native indeterminate is a flat
                       * grey line, easy to miss). aria-checked='mixed'
                       * sells the same story to screen readers. */}
                      <span
                        className={
                          !allOnPageSelected && someOnPageSelected
                            ? 'inline-flex h-5 w-5 items-center justify-center rounded ring-2 ring-smsg-400 ring-offset-1 ring-offset-white'
                            : 'inline-flex h-5 w-5 items-center justify-center'
                        }
                        data-testid="admin-glossary-pending-select-all-wrap"
                        data-indeterminate={!allOnPageSelected && someOnPageSelected ? 'true' : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={allOnPageSelected}
                          ref={(el) => {
                            if (el)
                              el.indeterminate = !allOnPageSelected && someOnPageSelected
                          }}
                          onChange={toggleAllOnPage}
                          aria-label="이 페이지 전체 선택"
                          aria-checked={!allOnPageSelected && someOnPageSelected ? 'mixed' : allOnPageSelected}
                          data-testid="admin-glossary-pending-select-all"
                        />
                      </span>
                    </th>
                    <th className="px-3 py-2">용어</th>
                    <th className="px-3 py-2">분야</th>
                    <th className="px-3 py-2">제안자</th>
                    <th className="px-3 py-2">제안 시각</th>
                    <th className="px-3 py-2">정의</th>
                    <th className="px-3 py-2 w-44">작업</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((it) => (
                    <Row
                      key={it.id}
                      term={it}
                      selected={selected.has(it.id)}
                      busy={busyIds.has(it.id)}
                      onToggle={() => toggleOne(it.id)}
                      onApprove={() => void onApproveOne(it)}
                      onReject={() => openRejectOne(it)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile card list (< sm) */}
          <div className="sm:hidden space-y-3" data-testid="admin-glossary-pending-cards">
            {items.map((it) => (
              <MobileCard
                key={it.id}
                term={it}
                selected={selected.has(it.id)}
                busy={busyIds.has(it.id)}
                onToggle={() => toggleOne(it.id)}
                onApprove={() => void onApproveOne(it)}
                onReject={() => openRejectOne(it)}
              />
            ))}
          </div>

          <Pagination
            page={page}
            totalPages={totalPages}
            onPage={(p) => setPage(p)}
          />
        </>
      )}

      <RejectReasonModal
        open={rejectTarget !== null}
        termLabel={rejectTarget?.label}
        busy={bulkBusy || (rejectTarget?.id ? busyIds.has(rejectTarget.id) : false)}
        onClose={() => {
          if (bulkBusy) return
          setRejectTarget(null)
        }}
        onConfirm={onConfirmReject}
      />
    </div>
  )
}

// ── Subcomponents ────────────────────────────────────────────────────────
function Row({
  term,
  selected,
  busy,
  onToggle,
  onApprove,
  onReject,
}: {
  term: PendingGlossaryTerm
  selected: boolean
  busy: boolean
  onToggle: () => void
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <tr data-testid={`admin-glossary-pending-row-${term.id}`}>
      <td className="px-3 py-2 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`${term.term} 선택`}
          data-testid={`admin-glossary-pending-select-${term.id}`}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <div className="font-medium text-smsg-900">{term.term}</div>
        {term.aliases.length > 0 && (
          <div className="mt-0.5 text-xs text-gray-500">
            alias: {term.aliases.join(', ')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top text-xs text-gray-700">
        {term.domain ?? '—'}
        {term.subdomain ? ` / ${term.subdomain}` : ''}
      </td>
      <td className="px-3 py-2 align-top text-xs text-gray-700">
        {term.proposed_by ?? '—'}
      </td>
      <td className="px-3 py-2 align-top text-xs text-gray-500">
        {term.proposed_at
          ? new Date(term.proposed_at).toLocaleString()
          : '—'}
      </td>
      <td className="px-3 py-2 align-top text-xs text-gray-700">
        <p className="line-clamp-3">{term.definition}</p>
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="primary"
            onClick={onApprove}
            disabled={busy}
            aria-disabled={busy || undefined}
            data-testid={`admin-glossary-pending-approve-${term.id}`}
          >
            승인
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={onReject}
            disabled={busy}
            aria-disabled={busy || undefined}
            data-testid={`admin-glossary-pending-reject-${term.id}`}
          >
            거부
          </Button>
        </div>
      </td>
    </tr>
  )
}

function MobileCard({
  term,
  selected,
  busy,
  onToggle,
  onApprove,
  onReject,
}: {
  term: PendingGlossaryTerm
  selected: boolean
  busy: boolean
  onToggle: () => void
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <Card padded="md" data-testid={`admin-glossary-pending-card-${term.id}`}>
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`${term.term} 선택`}
          className="mt-1"
        />
        <div className="flex-1">
          <div className="flex items-baseline justify-between">
            <div className="font-medium text-smsg-900">{term.term}</div>
            <div className="text-xs text-gray-500">{term.domain ?? '—'}</div>
          </div>
          <p className="mt-1 text-xs text-gray-700 line-clamp-3">{term.definition}</p>
          {term.aliases.length > 0 && (
            <div className="mt-1 text-[11px] text-gray-500">
              alias: {term.aliases.join(', ')}
            </div>
          )}
          <div className="mt-1 text-[11px] text-gray-500">
            {term.proposed_by ?? '—'} ·{' '}
            {term.proposed_at
              ? new Date(term.proposed_at).toLocaleString()
              : '—'}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={onApprove}
              disabled={busy}
              aria-disabled={busy || undefined}
            >
              승인
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={onReject}
              disabled={busy}
              aria-disabled={busy || undefined}
            >
              거부
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (p: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div
      className="mt-4 flex items-center justify-between"
      data-testid="admin-glossary-pending-pagination"
    >
      <Button
        size="sm"
        variant="ghost"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="이전 페이지"
      >
        ‹ 이전
      </Button>
      <span className="text-xs text-gray-600">
        {page} / {totalPages}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label="다음 페이지"
      >
        다음 ›
      </Button>
    </div>
  )
}
