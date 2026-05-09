import { useCallback, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuthStore } from '@/features/auth/store'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Input, Select } from '@/components/ui/Input'
import { toast } from '@/components/ui/Toast'
import { ErrorState } from '@/components/ui/ErrorState'

import {
  type BackupCadence,
  type BackupFormat,
  type BackupRun,
  type BackupSchedule,
  type BackupScope,
  type CreateScheduleInput,
  createSchedule,
  deleteSchedule,
  downloadRunUrl,
  listRuns,
  listSchedules,
  patchSchedule,
  runNow,
} from '@/features/backups/api'

/**
 * `/admin/backups` — admin operations console for scheduled backups.
 *
 *   - 일정: CRUD on `backup_schedules`
 *   - 최근 실행: 최근 20개 `backup_runs` + presigned 다운로드
 *   - 지금 실행: 즉시 admin 백업 트리거
 */
export function BackupAdminPage() {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  if (!user) return null
  if (role !== 'admin') return <Navigate to="/" replace />

  return (
    <div
      className="mx-auto max-w-6xl px-6 py-8 space-y-8"
      data-testid="backup-admin-page"
    >
      <header>
        <h1 className="text-2xl font-bold text-smsg-900">백업 관리</h1>
        <p className="mt-1 text-sm text-gray-600">
          예약 백업(daily/weekly/monthly) 과 즉시 백업을 관리합니다. 결과 zip 은
          MinIO `mxwp-backups` 버킷에 저장됩니다.
        </p>
      </header>

      <SchedulesSection />
      <RunNowSection />
      <RunsSection />
    </div>
  )
}

// ── Schedules table + new-schedule form ───────────────────────────────
function SchedulesSection() {
  const qc = useQueryClient()
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['backups', 'schedules'],
    queryFn: listSchedules,
  })

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await deleteSchedule(id)
        toast.success('일정 삭제됨')
        await qc.invalidateQueries({ queryKey: ['backups', 'schedules'] })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '삭제 실패')
      }
    },
    [qc],
  )

  const onToggle = useCallback(
    async (s: BackupSchedule) => {
      try {
        await patchSchedule(s.id, { enabled: !s.enabled })
        await qc.invalidateQueries({ queryKey: ['backups', 'schedules'] })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '저장 실패')
      }
    },
    [qc],
  )

  return (
    <section className="space-y-4" data-testid="backup-schedules">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-smsg-900">일정</h2>
        <NewScheduleForm
          onCreated={() =>
            qc.invalidateQueries({ queryKey: ['backups', 'schedules'] })
          }
        />
      </div>
      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="일정 불러오기 실패"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}
      {data && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              data-testid="backup-schedules-table"
            >
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">scope</th>
                  <th className="px-3 py-2">cadence / 시각</th>
                  <th className="px-3 py-2">format</th>
                  <th className="px-3 py-2">대상</th>
                  <th className="px-3 py-2">활성</th>
                  <th className="px-3 py-2">다음 실행</th>
                  <th className="px-3 py-2 text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((s) => (
                  <tr key={s.id} data-testid={`backup-schedule-row-${s.id}`}>
                    <td className="px-3 py-2">
                      <Badge tone="brand">{s.scope}</Badge>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {s.cadence} @ {s.hour_utc.toString().padStart(2, '0')}:00 UTC
                    </td>
                    <td className="px-3 py-2 text-gray-700">{s.format}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {s.target_doc_slug ||
                        s.target_user_id ||
                        '—'}
                    </td>
                    <td className="px-3 py-2">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={s.enabled}
                          onChange={() => void onToggle(s)}
                          data-testid={`backup-schedule-enabled-${s.id}`}
                        />
                        <span className="text-xs text-gray-600">
                          {s.enabled ? '활성' : '중지'}
                        </span>
                      </label>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {s.next_run_at
                        ? new Date(s.next_run_at).toLocaleString()
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void onDelete(s.id)}
                        data-testid={`backup-schedule-delete-${s.id}`}
                      >
                        삭제
                      </Button>
                    </td>
                  </tr>
                ))}
                {data.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      등록된 일정이 없습니다
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

const SCOPES: BackupScope[] = ['full', 'user', 'doc']
const CADENCES: BackupCadence[] = ['daily', 'weekly', 'monthly']
const FORMATS: BackupFormat[] = ['json', 'html', 'md', 'docx', 'pptx']

function NewScheduleForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CreateScheduleInput>({
    scope: 'full',
    cadence: 'daily',
    hour_utc: 3,
    format: 'json',
  })
  const m = useMutation({
    mutationFn: createSchedule,
    onSuccess: () => {
      toast.success('일정 생성됨')
      onCreated()
      setOpen(false)
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : '저장 실패'),
  })

  if (!open) {
    return (
      <Button
        size="sm"
        variant="primary"
        onClick={() => setOpen(true)}
        data-testid="backup-schedule-new"
      >
        + 새 일정
      </Button>
    )
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      data-testid="backup-schedule-form"
      onSubmit={(e) => {
        e.preventDefault()
        m.mutate(form)
      }}
    >
      <Select
        value={form.scope}
        onChange={(e) =>
          setForm({ ...form, scope: e.target.value as BackupScope })
        }
        data-testid="backup-schedule-form-scope"
      >
        {SCOPES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
      <Select
        value={form.cadence}
        onChange={(e) =>
          setForm({ ...form, cadence: e.target.value as BackupCadence })
        }
        data-testid="backup-schedule-form-cadence"
      >
        {CADENCES.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
      <Input
        type="number"
        min={0}
        max={23}
        value={form.hour_utc ?? 3}
        onChange={(e) =>
          setForm({ ...form, hour_utc: Number(e.target.value) })
        }
        className="w-20"
        data-testid="backup-schedule-form-hour"
      />
      <Select
        value={form.format}
        onChange={(e) =>
          setForm({ ...form, format: e.target.value as BackupFormat })
        }
        data-testid="backup-schedule-form-format"
      >
        {FORMATS.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </Select>
      {form.scope === 'doc' && (
        <Input
          placeholder="doc slug"
          value={form.target_doc_slug ?? ''}
          onChange={(e) =>
            setForm({ ...form, target_doc_slug: e.target.value })
          }
          data-testid="backup-schedule-form-slug"
        />
      )}
      {form.scope === 'user' && (
        <Input
          placeholder="user UUID (비우면 본인)"
          value={form.target_user_id ?? ''}
          onChange={(e) =>
            setForm({ ...form, target_user_id: e.target.value })
          }
          data-testid="backup-schedule-form-user"
        />
      )}
      <Button
        size="sm"
        variant="primary"
        type="submit"
        disabled={m.isPending}
        data-testid="backup-schedule-form-submit"
      >
        저장
      </Button>
      <Button
        size="sm"
        variant="secondary"
        type="button"
        onClick={() => setOpen(false)}
      >
        취소
      </Button>
    </form>
  )
}

// ── Run-now ───────────────────────────────────────────────────────────
function RunNowSection() {
  const qc = useQueryClient()
  const [scope, setScope] = useState<BackupScope>('full')
  const [format, setFormat] = useState<BackupFormat>('json')
  const [slug, setSlug] = useState('')
  const m = useMutation({
    mutationFn: runNow,
    onSuccess: (r) => {
      toast.success(`백업 완료 — ${r.doc_count} 문서, ${formatSize(r.size_bytes)}`)
      void qc.invalidateQueries({ queryKey: ['backups', 'runs'] })
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : '백업 실패'),
  })

  const onRun = useCallback(() => {
    m.mutate({
      scope,
      format,
      target_doc_slug: scope === 'doc' ? slug : null,
    })
  }, [m, scope, format, slug])

  return (
    <section data-testid="backup-run-now" className="space-y-3">
      <h2 className="text-lg font-semibold text-smsg-900">지금 실행</h2>
      <Card padded="lg">
        <div className="flex flex-wrap items-end gap-3">
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value as BackupScope)}
            data-testid="backup-run-now-scope"
          >
            {SCOPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
          <Select
            value={format}
            onChange={(e) => setFormat(e.target.value as BackupFormat)}
            data-testid="backup-run-now-format"
          >
            {FORMATS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
          {scope === 'doc' && (
            <Input
              placeholder="doc slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              data-testid="backup-run-now-slug"
            />
          )}
          <Button
            variant="primary"
            onClick={onRun}
            disabled={m.isPending}
            data-testid="backup-run-now-submit"
          >
            {m.isPending ? '실행 중…' : '지금 실행'}
          </Button>
        </div>
      </Card>
    </section>
  )
}

// ── Recent runs ───────────────────────────────────────────────────────
function RunsSection() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['backups', 'runs'],
    queryFn: () => listRuns(20),
    refetchInterval: 30_000,
  })

  return (
    <section data-testid="backup-runs" className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-smsg-900">최근 실행</h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void refetch()}
          data-testid="backup-runs-refresh"
        >
          새로고침
        </Button>
      </div>
      {isPending && <p className="text-sm text-gray-500">불러오는 중…</p>}
      {isError && (
        <ErrorState
          title="실행 이력 불러오기 실패"
          description={error instanceof Error ? error.message : '오류'}
          onRetry={() => void refetch()}
        />
      )}
      {data && (
        <Card padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="backup-runs-table">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">시작</th>
                  <th className="px-3 py-2">scope</th>
                  <th className="px-3 py-2">format</th>
                  <th className="px-3 py-2">상태</th>
                  <th className="px-3 py-2">문서</th>
                  <th className="px-3 py-2">크기</th>
                  <th className="px-3 py-2 text-right">다운로드</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
                {data.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      실행 기록이 없습니다
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

function RunRow({ run }: { run: BackupRun }) {
  const tone = useMemo<'brand' | 'success' | 'error' | 'neutral'>(() => {
    if (run.status === 'ok') return 'success'
    if (run.status === 'failed') return 'error'
    return 'brand'
  }, [run.status])
  return (
    <tr data-testid={`backup-run-row-${run.id}`}>
      <td className="px-3 py-2 text-xs text-gray-600">
        {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}
      </td>
      <td className="px-3 py-2 text-gray-700">{run.scope}</td>
      <td className="px-3 py-2 text-gray-700">{run.format}</td>
      <td className="px-3 py-2">
        <Badge tone={tone}>{run.status}</Badge>
      </td>
      <td className="px-3 py-2 text-gray-700">
        {run.doc_count ?? '—'}
      </td>
      <td className="px-3 py-2 text-gray-700">
        {formatSize(run.size_bytes)}
      </td>
      <td className="px-3 py-2 text-right">
        {run.status === 'ok' ? (
          <a
            href={downloadRunUrl(run.id)}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-smsg-700 underline"
            data-testid={`backup-run-download-${run.id}`}
          >
            받기
          </a>
        ) : (
          <span className="text-xs text-gray-400">—</span>
        )}
      </td>
    </tr>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
