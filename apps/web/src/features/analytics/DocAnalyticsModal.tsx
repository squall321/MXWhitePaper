/**
 * DocAnalyticsModal — per-doc analytics drawer (Cycle 0016).
 *
 * Trigger: WikiArticle 의 "📊 통계" 버튼 (editor+ 가시).
 *
 *   - 30일 일별 조회 LineChart (recharts)
 *   - KPI 4개 (총 조회 / unique reader / avg / median)
 *   - 섹션별 attention 표 (heat-map 대신 단순 정렬 + 막대 비주얼)
 *   - 유입 경로 (top_referrers)
 */
import { useQuery } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Drawer } from '@/components/ui/Drawer'
import { Badge } from '@/components/ui/Badge'
import { ErrorState } from '@/components/ui/ErrorState'
import { getDocAnalytics, type DocAnalytics } from './api'

export interface DocAnalyticsModalProps {
  slug: string
  open: boolean
  onClose: () => void
}

export function DocAnalyticsModal({ slug, open, onClose }: DocAnalyticsModalProps) {
  const q = useQuery({
    queryKey: ['analytics', 'doc', slug],
    queryFn: () => getDocAnalytics(slug),
    enabled: open,
  })

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      width="min(540px, 95vw)"
      ariaLabel="문서 통계"
    >
      <div className="flex h-full flex-col" data-testid="doc-analytics-modal">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-smsg-900">문서 통계</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-smsg-700"
            aria-label="닫기"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {q.isError && (
            <ErrorState
              title="통계 로드 실패"
              description={
                q.error instanceof Error ? q.error.message : '오류'
              }
              onRetry={() => void q.refetch()}
            />
          )}
          {q.isPending && (
            <p className="py-8 text-center text-sm text-gray-500">
              불러오는 중…
            </p>
          )}
          {q.data && <Body data={q.data} />}
        </div>
      </div>
    </Drawer>
  )
}

function Body({ data }: { data: DocAnalytics }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-medium text-gray-600">{data.title}</h3>
        <div className="grid grid-cols-2 gap-2" data-testid="doc-analytics-kpis">
          <Kpi label="총 조회" value={data.total_views} />
          <Kpi label="고유 독자" value={data.unique_readers} />
          <Kpi label="평균 시간(초)" value={data.avg_read_seconds} />
          <Kpi label="중앙값(초)" value={data.median_read_seconds} />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">최근 30일 조회</h3>
          <Badge tone="brand">30일</Badge>
        </div>
        <div className="h-44" data-testid="doc-analytics-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.last_30_days.map((d) => ({
                ...d,
                day: d.date.slice(5),
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="views"
                stroke="#1f4ed8"
                dot={false}
                name="조회"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium text-gray-700">섹션별 체류 시간</h3>
        {data.section_attention.length === 0 ? (
          <p className="rounded bg-gray-50 px-3 py-2 text-xs text-gray-500">
            아직 표본이 없습니다 — anchor 샘플은 30초 단위로 누적됩니다.
          </p>
        ) : (
          <SectionAttentionTable items={data.section_attention} />
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-medium text-gray-700">유입 경로</h3>
        {data.top_referrers.length === 0 ? (
          <p className="text-xs text-gray-500">데이터 없음</p>
        ) : (
          <ul className="space-y-1 text-sm" data-testid="doc-analytics-referrers">
            {data.top_referrers.map((r) => (
              <li key={r.kind} className="flex items-center justify-between">
                <span className="text-gray-700">{r.kind}</span>
                <Badge tone="muted">{r.count}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="text-xl font-bold text-smsg-900">
        {Number(value || 0).toLocaleString()}
      </div>
    </div>
  )
}

function SectionAttentionTable({
  items,
}: {
  items: { section_id: string; section_title: string; est_seconds_per_visitor: number }[]
}) {
  const max = Math.max(...items.map((i) => i.est_seconds_per_visitor), 1)
  return (
    <table
      className="w-full text-xs"
      data-testid="doc-analytics-section-attention"
    >
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1">섹션</th>
          <th className="w-24 py-1 text-right">초/방문자</th>
          <th className="w-28 py-1">분포</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const pct = Math.round((it.est_seconds_per_visitor / max) * 100)
          return (
            <tr key={it.section_id} className="border-t border-gray-100">
              <td className="py-1 pr-2 align-top">
                <span className="line-clamp-2 text-smsg-700">
                  {it.section_title}
                </span>
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {it.est_seconds_per_visitor}
              </td>
              <td className="py-1">
                <div className="h-2 w-full rounded bg-gray-100">
                  <div
                    className="h-2 rounded bg-smsg-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
