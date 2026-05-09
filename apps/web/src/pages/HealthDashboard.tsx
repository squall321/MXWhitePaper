import { useEffect, useRef, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { useAuthStore } from '@/features/auth/store'
import {
  type HealthDashboard,
  type HealthTicker,
  getHealthDashboard,
} from '@/features/admin/api'

const REFRESH_MS = 30_000

/**
 * `/admin/health` — operations console.
 *
 * Auto-refreshes every 30s (toggle via the checkbox). Each card shows a
 * green/yellow/red status pill driven by the ``ok`` flag returned per
 * subsystem. The errors_24h counter feeds a Recharts sparkline that
 * accumulates the last N samples client-side.
 */
export function HealthDashboardPage() {
  const user = useAuthStore((s) => s.user)
  const role = user?.role ?? ''
  if (!user) return null
  if (role !== 'admin') return <Navigate to="/" replace />
  return <HealthDashboardInner />
}

function HealthDashboardInner() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const { data, isPending, isError, error, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['admin', 'health-dashboard'],
    queryFn: getHealthDashboard,
    refetchInterval: autoRefresh ? REFRESH_MS : false,
    staleTime: 5_000,
  })

  // ── Sparkline series (errors_24h over time) ─────────────────────────
  const seriesRef = useRef<Array<{ t: number; v: number }>>([])
  useEffect(() => {
    if (!data) return
    const arr = seriesRef.current
    arr.push({ t: dataUpdatedAt || Date.now(), v: data.errors_24h })
    // Keep last 30 samples (= 15 minutes at 30s cadence).
    if (arr.length > 30) arr.splice(0, arr.length - 30)
  }, [data, dataUpdatedAt])

  const series = seriesRef.current.map((p) => ({
    label: new Date(p.t).toLocaleTimeString().slice(0, 5),
    errors: p.v,
  }))

  return (
    <div className="mx-auto max-w-6xl px-6 py-8" data-testid="health-dashboard-page">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">시스템 상태 대시보드</h1>
          <p className="mt-1 text-sm text-gray-600">
            운영용 — DB / MinIO / Meilisearch / 백그라운드 ticker 상태를 30초 간격으로 새로고침합니다.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              data-testid="health-auto-refresh"
            />
            자동 새로고침
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void refetch()}
            data-testid="health-refresh"
          >
            지금 새로고침
          </Button>
        </div>
      </header>

      {isPending && (
        <p role="status" aria-live="polite" className="text-sm text-gray-500">
          불러오는 중…
        </p>
      )}
      {isError && (
        <ErrorState
          title="헬스 대시보드 조회 실패"
          description={error instanceof Error ? error.message : '알 수 없는 오류'}
          onRetry={() => void refetch()}
        />
      )}

      {data && (
        <div className="space-y-4">
          <SummaryCards d={data} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DatabaseCard d={data} />
            <MinioCard d={data} />
            <MeiliCard d={data} />
            <RateLimitCard d={data} />
          </div>
          <QueuesCard d={data} />
          <TickersCard tickers={data.tickers} />
          <ErrorsTrendCard series={series} />
        </div>
      )}
    </div>
  )
}

// ── Status pill ──────────────────────────────────────────────────────────
type Severity = 'ok' | 'warn' | 'fail'

function StatusPill({ severity, label }: { severity: Severity; label: string }) {
  const colour =
    severity === 'ok'
      ? 'bg-green-100 text-green-800'
      : severity === 'warn'
        ? 'bg-yellow-100 text-yellow-800'
        : 'bg-red-100 text-red-800'
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colour}`}
      data-testid={`health-pill-${severity}`}
    >
      {label}
    </span>
  )
}

// ── Cards ────────────────────────────────────────────────────────────────
function SummaryCards({ d }: { d: HealthDashboard }) {
  const items = [
    { label: '가동 시간', value: formatUptime(d.uptime_seconds) },
    { label: '버전', value: d.version },
    { label: '24h 에러', value: d.errors_24h.toLocaleString() },
  ]
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="health-summary">
      {items.map((it) => (
        <Card key={it.label} padded="md">
          <div className="text-xs text-gray-500">{it.label}</div>
          <div
            className="mt-1 truncate text-xl font-bold text-smsg-900"
            title={String(it.value)}
          >
            {it.value}
          </div>
        </Card>
      ))}
    </div>
  )
}

function DatabaseCard({ d }: { d: HealthDashboard }) {
  const sev: Severity = d.database.ok ? 'ok' : 'fail'
  const utilization =
    d.database.pool_size > 0
      ? Math.round((d.database.checked_out / d.database.pool_size) * 100)
      : 0
  const warn: Severity = utilization >= 80 ? 'warn' : sev
  return (
    <Card padded="md" data-testid="health-card-database">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-smsg-900">DB 풀</h2>
        <StatusPill severity={warn} label={d.database.ok ? '정상' : '오류'} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-gray-500">pool_size</dt>
          <dd className="font-mono">{d.database.pool_size}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">checked_out</dt>
          <dd className="font-mono">{d.database.checked_out}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">overflow</dt>
          <dd className="font-mono">{d.database.overflow}</dd>
        </div>
      </dl>
    </Card>
  )
}

function MinioCard({ d }: { d: HealthDashboard }) {
  const sev: Severity = d.minio.ok ? 'ok' : 'fail'
  return (
    <Card padded="md" data-testid="health-card-minio">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-smsg-900">MinIO</h2>
        <StatusPill severity={sev} label={d.minio.ok ? '정상' : '오류'} />
      </div>
      <p className="mb-2 truncate font-mono text-xs text-gray-500" title={d.minio.endpoint}>
        {d.minio.endpoint}
      </p>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-gray-500">
          <tr>
            <th className="text-left">버킷</th>
            <th className="text-right">개수</th>
            <th className="text-right">크기</th>
          </tr>
        </thead>
        <tbody>
          {d.minio.buckets.map((b) => (
            <tr key={b.name} data-testid={`health-bucket-${b.name}`}>
              <td className="font-mono">{b.name}</td>
              <td className="text-right font-mono">{b.count.toLocaleString()}</td>
              <td className="text-right font-mono">{formatBytes(b.size_bytes)}</td>
            </tr>
          ))}
          {d.minio.buckets.length === 0 && (
            <tr>
              <td colSpan={3} className="py-2 text-center text-xs text-gray-500">
                버킷 정보 없음
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  )
}

function MeiliCard({ d }: { d: HealthDashboard }) {
  const sev: Severity = d.meilisearch.ok ? 'ok' : 'fail'
  return (
    <Card padded="md" data-testid="health-card-meilisearch">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-smsg-900">Meilisearch</h2>
        <StatusPill severity={sev} label={d.meilisearch.ok ? '정상' : '오류'} />
      </div>
      <p className="mb-2 truncate font-mono text-xs text-gray-500" title={d.meilisearch.url}>
        {d.meilisearch.url}
      </p>
      <ul className="text-sm">
        {d.meilisearch.indexes.map((i) => (
          <li key={i.uid} className="flex justify-between" data-testid={`health-index-${i.uid}`}>
            <span className="font-mono">{i.uid}</span>
            <span className="font-mono">{i.count.toLocaleString()}</span>
          </li>
        ))}
        {d.meilisearch.indexes.length === 0 && (
          <li className="text-xs text-gray-500">인덱스 정보 없음</li>
        )}
      </ul>
    </Card>
  )
}

function RateLimitCard({ d }: { d: HealthDashboard }) {
  const blocked = d.rate_limit.active_blocks
  const sev: Severity = blocked > 5 ? 'warn' : 'ok'
  return (
    <Card padded="md" data-testid="health-card-rate-limit">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-smsg-900">Rate limit</h2>
        <StatusPill severity={sev} label={blocked > 0 ? `차단 ${blocked}` : '정상'} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-gray-500">active_buckets</dt>
          <dd className="font-mono">{d.rate_limit.active_buckets.toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-xs text-gray-500">active_blocks</dt>
          <dd className="font-mono">{d.rate_limit.active_blocks.toLocaleString()}</dd>
        </div>
      </dl>
    </Card>
  )
}

function QueuesCard({ d }: { d: HealthDashboard }) {
  const items = [
    { label: '자동화 대기', value: d.queue_depths.automation_pending },
    { label: '웹훅 대기', value: d.queue_depths.webhook_deliveries_pending },
    { label: '구독 다이제스트 버퍼', value: d.queue_depths.subscription_digest_buffer },
  ]
  return (
    <Card padded="md" data-testid="health-card-queues">
      <h2 className="mb-2 text-sm font-semibold text-smsg-900">큐 깊이</h2>
      <div className="grid grid-cols-3 gap-2 text-sm">
        {items.map((it) => (
          <div key={it.label}>
            <div className="text-xs text-gray-500">{it.label}</div>
            <div className="mt-1 font-mono text-lg">{it.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function TickersCard({ tickers }: { tickers: HealthTicker[] }) {
  return (
    <Card padded="md" data-testid="health-card-tickers">
      <h2 className="mb-2 text-sm font-semibold text-smsg-900">백그라운드 ticker</h2>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-gray-500">
          <tr>
            <th className="text-left">이름</th>
            <th className="text-left">상태</th>
            <th className="text-left">마지막 tick</th>
            <th className="text-left">다음 예정</th>
          </tr>
        </thead>
        <tbody>
          {tickers.map((tk) => (
            <tr key={tk.name} data-testid={`health-ticker-${tk.name}`}>
              <td className="font-mono">{tk.name}</td>
              <td>
                <StatusPill
                  severity={tk.running ? 'ok' : 'fail'}
                  label={tk.running ? '🟢 실행 중' : '🔴 정지'}
                />
              </td>
              <td className="font-mono text-xs">
                {tk.last_tick_at ? new Date(tk.last_tick_at).toLocaleString() : '—'}
              </td>
              <td className="font-mono text-xs">
                {tk.next_due_at ? new Date(tk.next_due_at).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function ErrorsTrendCard({
  series,
}: {
  series: Array<{ label: string; errors: number }>
}) {
  return (
    <Card padded="md" data-testid="health-card-errors-trend">
      <h2 className="mb-2 text-sm font-semibold text-smsg-900">
        24h 에러 추이 (현재 세션)
      </h2>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Line
              type="monotone"
              dataKey="errors"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}초`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}분`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  if (hrs < 24) return `${hrs}시간 ${rem}분`
  const days = Math.floor(hrs / 24)
  const hh = hrs % 24
  return `${days}일 ${hh}시간`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

