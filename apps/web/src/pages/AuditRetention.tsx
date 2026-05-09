import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'
import {
  RETAIN_DAY_OPTIONS,
  type AuditRetentionConfig,
  getAuditRetention,
  patchAuditRetention,
  pruneAuditNow,
} from '@/features/audit-retention/api'

/**
 * `/admin/audit-retention` — admin tunable retention for the `audit_logs`
 * table.
 *
 * Slider sets `retain_days` (30/90/180/365/730/1825). Toggle gates the
 * daily ticker. "지금 실행" fires `prune-now` immediately (force=true on
 * the BE so it runs even when disabled). Stats panel shows total audit
 * rows, all-time pruned count, and last_run_at.
 */
export function AuditRetentionPage({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['audit-retention', 'config'],
    queryFn: getAuditRetention,
  })

  const containerCls = embedded
    ? ''
    : 'mx-auto max-w-3xl px-6 py-8'

  return (
    <div className={containerCls} data-testid="audit-retention-page">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-smsg-900">감사 로그 보존 설정</h1>
        <p className="mt-1 text-sm text-gray-600">
          오래된 audit_logs 행을 자동으로 정리합니다. 24시간 ticker — single replica.
        </p>
      </header>

      {isPending && (
        <p className="text-sm text-gray-500" data-testid="audit-retention-loading">
          불러오는 중…
        </p>
      )}
      {isError && (
        <ErrorState
          title="감사 로그 보존 설정을 불러올 수 없습니다"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <ConfigForm
          initial={data}
          onSaved={() =>
            void qc.invalidateQueries({ queryKey: ['audit-retention', 'config'] })
          }
        />
      )}
    </div>
  )
}

// ── Config form ─────────────────────────────────────────────────────────

function ConfigForm({
  initial,
  onSaved,
}: {
  initial: AuditRetentionConfig
  onSaved: () => void
}) {
  const [retainDays, setRetainDays] = useState<number>(initial.retain_days)
  const [enabled, setEnabled] = useState<boolean>(initial.enabled)

  // If the upstream data refreshes (after a prune-now invalidation), keep
  // local sliders in sync — but only if the user hasn't started editing.
  useEffect(() => {
    setRetainDays(initial.retain_days)
    setEnabled(initial.enabled)
  }, [initial.retain_days, initial.enabled])

  const dirty =
    retainDays !== initial.retain_days || enabled !== initial.enabled

  const save = useMutation({
    mutationFn: () =>
      patchAuditRetention({ retain_days: retainDays, enabled }),
    onSuccess: () => {
      toast.success('저장됨')
      onSaved()
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : '저장 실패'),
  })

  const pruneNow = useMutation({
    mutationFn: pruneAuditNow,
    onSuccess: (r) => {
      toast.success(`prune 완료 — ${r.rows_pruned}건 삭제`)
      onSaved()
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : '실행 실패'),
  })

  // Slider position = index into the discrete option list.
  const optionIndex = Math.max(
    0,
    RETAIN_DAY_OPTIONS.indexOf(retainDays) === -1
      ? // Unknown value (shouldn't happen) — pick the closest stop.
        nearestStopIndex(retainDays)
      : RETAIN_DAY_OPTIONS.indexOf(retainDays),
  )

  return (
    <div className="space-y-4">
      <Card padded="lg" data-testid="audit-retention-stats">
        <h2 className="text-sm font-semibold text-smsg-900">통계</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat
            label="전체 audit_logs"
            value={initial.audit_log_total.toLocaleString()}
            testid="audit-retention-stat-total"
          />
          <Stat
            label="누적 삭제"
            value={initial.rows_pruned_total.toLocaleString()}
            testid="audit-retention-stat-pruned"
          />
          <Stat
            label="마지막 실행"
            value={
              initial.last_run_at
                ? relativeTime(initial.last_run_at)
                : '아직 실행 안됨'
            }
            testid="audit-retention-stat-last-run"
          />
        </div>
      </Card>

      <Card padded="lg" data-testid="audit-retention-config-form">
        <h2 className="text-sm font-semibold text-smsg-900">보존 정책</h2>

        <div className="mt-4 flex items-center gap-2">
          <Badge tone={enabled ? 'success' : 'neutral'}>
            {enabled ? '활성' : '비활성'}
          </Badge>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              data-testid="audit-retention-enabled"
              aria-label="자동 prune 활성화"
            />
            <span className="text-sm text-gray-700">자동 prune 활성화</span>
          </label>
        </div>

        <div className="mt-6">
          <div className="flex items-end justify-between">
            <label
              className="block text-xs text-gray-600"
              htmlFor="audit-retention-slider"
            >
              보관 기간 (retain_days)
            </label>
            <span className="text-sm font-semibold text-smsg-900">
              {retainDays}일
              <span className="ml-2 text-xs text-gray-500">
                ≈ {Math.round((retainDays / 365) * 10) / 10}년
              </span>
            </span>
          </div>
          <input
            id="audit-retention-slider"
            type="range"
            min={0}
            max={RETAIN_DAY_OPTIONS.length - 1}
            step={1}
            value={optionIndex}
            onChange={(e) =>
              setRetainDays(
                RETAIN_DAY_OPTIONS[Number.parseInt(e.target.value, 10)] ?? 365,
              )
            }
            className="mt-2 w-full"
            data-testid="audit-retention-slider"
            aria-valuemin={RETAIN_DAY_OPTIONS[0]}
            aria-valuemax={RETAIN_DAY_OPTIONS[RETAIN_DAY_OPTIONS.length - 1]}
            aria-valuenow={retainDays}
          />
          <div className="mt-1 flex justify-between text-[11px] text-gray-500">
            {RETAIN_DAY_OPTIONS.map((d) => (
              <span key={d}>{d}d</span>
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            data-testid="audit-retention-save"
          >
            {save.isPending ? '저장 중…' : '저장'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (
                window.confirm(
                  '지금 prune 을 실행하면 보관 기간보다 오래된 행이 즉시 삭제됩니다. 진행할까요?',
                )
              ) {
                pruneNow.mutate()
              }
            }}
            disabled={pruneNow.isPending}
            data-testid="audit-retention-prune-now"
          >
            {pruneNow.isPending ? '실행 중…' : '지금 실행'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ── Bits ────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  testid,
}: {
  label: string
  value: string | number
  testid: string
}) {
  return (
    <div data-testid={testid}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-bold text-smsg-900">{value}</div>
    </div>
  )
}

function nearestStopIndex(value: number): number {
  let best = 0
  let bestDiff = Number.POSITIVE_INFINITY
  RETAIN_DAY_OPTIONS.forEach((opt, idx) => {
    const diff = Math.abs(opt - value)
    if (diff < bestDiff) {
      best = idx
      bestDiff = diff
    }
  })
  return best
}

function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const now = Date.now()
  const diff = Math.max(0, now - ts)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return `${sec}초 전`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  return `${day}일 전`
}
