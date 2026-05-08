import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Input'
import { ErrorState } from '@/components/ui/ErrorState'
import { useAuthStore } from '@/features/auth/store'
import {
  getDaily,
  getOverview,
  getTopViews,
  type DailyMetric,
} from '@/features/analytics/api'

const DAYS_OPTIONS = [
  { value: 7, label: '최근 7일' },
  { value: 14, label: '최근 14일' },
  { value: 30, label: '최근 30일' },
  { value: 60, label: '최근 60일' },
]

/**
 * `/analytics` — read-only usage analytics dashboard.
 *
 *   - 카드: MAU / 총 문서 / 평균 backlinks / Top 검색
 *   - 일별 활동 LineChart
 *   - 탑 조회 문서 / 탑 검색
 */
export function AnalyticsPage() {
  const user = useAuthStore((s) => s.user)
  const [days, setDays] = useState(30)

  const overviewQ = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: getOverview,
  })
  const dailyQ = useQuery({
    queryKey: ['analytics', 'daily', days],
    queryFn: () => getDaily(days),
  })
  const topQ = useQuery({
    queryKey: ['analytics', 'top-views', 7],
    queryFn: () => getTopViews(7),
  })

  if (!user) return null

  const o = overviewQ.data
  const topSearch = o?.top_searches?.[0]?.q ?? '—'

  return (
    <div className="mx-auto max-w-6xl px-6 py-8" data-testid="analytics-page">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-smsg-900">사용량 분석</h1>
          <p className="mt-1 text-sm text-gray-600">
            audit_logs / links 기반 추정값입니다 — 실시간이 아닐 수 있습니다.
          </p>
        </div>
        <div>
          <label className="block text-xs text-gray-600">기간</label>
          <Select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            data-testid="analytics-days"
          >
            {DAYS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="analytics-cards">
        <KpiCard label="월간 활성 유저 (MAU)" value={o?.mau ?? '—'} />
        <KpiCard label="총 문서" value={o?.total_docs ?? '—'} />
        <KpiCard
          label="평균 backlinks"
          value={o ? o.avg_backlinks.toFixed(2) : '—'}
        />
        <KpiCard label="Top 검색" value={topSearch} small />
      </div>

      <Card padded="lg" className="mb-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-smsg-900">일별 활동</h2>
          <Badge tone="brand">{`${days}일`}</Badge>
        </div>
        {dailyQ.isError && (
          <ErrorState
            title="일별 데이터 실패"
            description={
              dailyQ.error instanceof Error ? dailyQ.error.message : '오류'
            }
            onRetry={() => void dailyQ.refetch()}
          />
        )}
        {dailyQ.isPending && (
          <p className="py-12 text-center text-sm text-gray-500">불러오는 중…</p>
        )}
        {dailyQ.data && <DailyChart data={dailyQ.data} />}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card padded="lg">
          <h2 className="mb-3 text-lg font-semibold text-smsg-900">탑 조회 문서 (7일)</h2>
          {topQ.isError && (
            <p className="text-sm text-red-700">불러오기 실패</p>
          )}
          {topQ.isPending && (
            <p className="text-sm text-gray-500">불러오는 중…</p>
          )}
          {topQ.data && (
            <ol className="divide-y divide-gray-100" data-testid="analytics-top-views">
              {topQ.data.map((d, i) => (
                <li key={d.target} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-6 text-right text-xs text-gray-500">{i + 1}</span>
                  <Link
                    to={`/docs/${d.slug}`}
                    className="flex-1 truncate text-smsg-700 hover:underline"
                  >
                    {d.title}
                  </Link>
                  <Badge tone="neutral">{d.count}</Badge>
                </li>
              ))}
              {topQ.data.length === 0 && (
                <li className="py-3 text-center text-sm text-gray-500">
                  데이터 없음
                </li>
              )}
            </ol>
          )}
        </Card>

        <Card padded="lg">
          <h2 className="mb-3 text-lg font-semibold text-smsg-900">탑 검색 (30일)</h2>
          {overviewQ.data?.top_searches && overviewQ.data.top_searches.length > 0 ? (
            <SearchBars data={overviewQ.data.top_searches} />
          ) : (
            <p className="text-sm text-gray-500">데이터 없음</p>
          )}
        </Card>
      </div>
    </div>
  )
}

function KpiCard({
  label,
  value,
  small,
}: {
  label: string
  value: string | number
  small?: boolean
}) {
  return (
    <Card padded="md">
      <div className="text-xs text-gray-500">{label}</div>
      <div
        className={
          'mt-1 truncate font-bold text-smsg-900 ' +
          (small ? 'text-base' : 'text-2xl')
        }
        title={String(value)}
      >
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </Card>
  )
}

function DailyChart({ data }: { data: DailyMetric[] }) {
  const formatted = data.map((d) => ({ ...d, day: d.date.slice(5) }))
  return (
    <div className="mt-3 h-72" data-testid="analytics-daily-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line
            type="monotone"
            dataKey="active_users"
            name="활성 유저"
            stroke="#1f4ed8"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="doc_writes"
            name="문서 작성"
            stroke="#10b981"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="doc_reads"
            name="조회"
            stroke="#f59e0b"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="search_count"
            name="검색"
            stroke="#ef4444"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function SearchBars({ data }: { data: Array<{ q: string; count: number }> }) {
  return (
    <div className="h-72" data-testid="analytics-top-searches">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="q"
            width={120}
            tick={{ fontSize: 11 }}
          />
          <Tooltip />
          <Bar dataKey="count" fill="#1f4ed8" name="검색 횟수" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
