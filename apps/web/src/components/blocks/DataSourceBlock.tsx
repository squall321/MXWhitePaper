import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api/client'
import type {
  ChartBlock,
  DataSourceBlock,
  KpiCardsBlock,
  TableBlock,
  Ulid,
} from '@/types/document'
import { ChartBlockView } from './ChartBlock'
import { TableBlockView } from './TableBlock'
import { KpiCardsBlockView } from './KpiCardsBlock'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/ErrorState'
import { Badge } from '@/components/ui/Badge'

/**
 * The shape of a data-source response is intentionally narrow: the BE
 * registry hands back either the same payload as a TableBlock / ChartBlock
 * / KpiCardsBlock (sans `id`/`type`), or a generic record array we can
 * coerce into a 2-column table for `render: table`.
 */
interface DataSourceResponse {
  data?: unknown
  meta?: Record<string, unknown>
}

/**
 * Default: stale-while-revalidate every refreshInterval seconds.
 * Falls back to 60s when not specified.
 */
const DEFAULT_REFRESH_S = 60
const STABLE_PARAMS_KEY = (params: unknown) => {
  try {
    return JSON.stringify(params ?? {})
  } catch {
    return ''
  }
}

/**
 * Derive react-query polling settings from `block.refreshInterval` (seconds).
 * Pure — exported for unit testing.
 *
 *  - When `enabled` is false (no endpoint), `refetchInterval` is `false`
 *    so we don't kick off a useless poll.
 *  - `staleTime` is set to `intervalMs - 1000` so each poll sees a stale
 *    cache and refetches; clamped at 0 if `refreshInterval` is tiny.
 *  - When `refreshInterval` is unset, we fall back to `DEFAULT_REFRESH_S`
 *    (60s), matching the schema default.
 */
export function derivePollingConfig(
  refreshIntervalSec: number | undefined,
  enabled: boolean,
): { intervalMs: number; refetchInterval: number | false; staleTime: number } {
  const intervalMs = (refreshIntervalSec ?? DEFAULT_REFRESH_S) * 1000
  return {
    intervalMs,
    refetchInterval: enabled ? intervalMs : false,
    staleTime: Math.max(0, intervalMs - 1000),
  }
}

async function fetchDataSource(endpoint: string, params: unknown) {
  // The endpoint may be absolute (`/widgets/kpi/finance-daily`) or relative.
  // The api client baseURL already includes `/api/v1`, so strip a leading
  // `/api/v1` if the author copy-pasted the full path.
  const ep = endpoint.replace(/^\/?api\/v1\/?/, '/')
  const url = ep.startsWith('/') ? ep : `/${ep}`
  const res = await apiClient.get<DataSourceResponse>(url, { params: params ?? {} })
  return res.data
}

/** Coerce arbitrary JSON into a `TableBlock`-like payload. */
function asTable(payload: unknown, blockId: Ulid): TableBlock {
  if (
    payload &&
    typeof payload === 'object' &&
    'headers' in payload &&
    'rows' in payload
  ) {
    const p = payload as { headers: unknown; rows: unknown }
    if (Array.isArray(p.headers) && Array.isArray(p.rows)) {
      return {
        type: 'table',
        id: blockId,
        headers: p.headers.map(String),
        rows: p.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [String(r ?? '')])),
      }
    }
  }
  // Fallback: render whatever as JSON inside a 1×1 table.
  return {
    type: 'table',
    id: blockId,
    headers: ['응답'],
    rows: [[JSON.stringify(payload)]],
  }
}

function asChart(payload: unknown, blockId: Ulid): ChartBlock {
  if (
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    payload &&
    typeof (payload as { data: unknown }).data === 'object'
  ) {
    const p = payload as ChartBlock
    return {
      type: 'chart',
      id: blockId,
      chartType: p.chartType ?? 'line',
      title: p.title,
      data: p.data ?? { labels: [], series: [] },
    }
  }
  return { type: 'chart', id: blockId, chartType: 'line', data: { labels: [], series: [] } }
}

function asKpiCards(payload: unknown, blockId: Ulid): KpiCardsBlock {
  if (payload && typeof payload === 'object' && 'items' in payload) {
    const items = (payload as { items: unknown }).items
    if (Array.isArray(items)) {
      return { type: 'kpi-cards', id: blockId, items: items as KpiCardsBlock['items'] }
    }
  }
  return { type: 'kpi-cards', id: blockId, items: [] }
}

interface Props {
  block: DataSourceBlock
}

/**
 * Read-mode `data-source` block. Polls the configured endpoint and renders
 * via the matching read-mode component. Auto-refresh interval = `refreshInterval`.
 */
export function DataSourceBlockView({ block }: Props) {
  const paramsKey = STABLE_PARAMS_KEY(block?.params)
  const enabled = Boolean(block?.endpoint)
  const { refetchInterval, staleTime } = derivePollingConfig(
    block?.refreshInterval,
    enabled,
  )

  const { data, error, isLoading, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['data-source', block?.endpoint, paramsKey],
    queryFn: () => fetchDataSource(block.endpoint, block.params),
    enabled,
    refetchInterval,
    staleTime,
    retry: false,
  })

  const payload = data?.data ?? null

  const stamp = useMemo(() => {
    if (!dataUpdatedAt) return null
    const d = new Date(dataUpdatedAt)
    return d.toLocaleTimeString('ko-KR', { hour12: false })
  }, [dataUpdatedAt])

  if (!enabled) {
    return (
      <div className="rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-500">
        데이터 소스 endpoint가 설정되지 않았습니다.
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }
  if (error) {
    return <ErrorState title="데이터를 불러올 수 없습니다" description={(error as Error).message} />
  }

  const blockId = block?.id ?? ''
  let body: React.ReactNode
  try {
    if (block?.render === 'chart') body = <ChartBlockView block={asChart(payload, blockId)} />
    else if (block?.render === 'kpi-cards')
      body = <KpiCardsBlockView block={asKpiCards(payload, blockId)} />
    else body = <TableBlockView block={asTable(payload, blockId)} />
  } catch (err) {
    body = (
      <ErrorState
        title="데이터를 표시할 수 없습니다"
        description={(err as Error)?.message ?? '알 수 없는 오류'}
      />
    )
  }

  return (
    <section className="space-y-2 rounded border border-gray-200 bg-white p-3">
      <header className="flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <Badge tone="info" size="sm">데이터 소스</Badge>
          <code className="text-[11px] text-gray-600">{block.endpoint}</code>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && <span className="text-amber-600">갱신 중…</span>}
          {stamp && <span>마지막 갱신 {stamp}</span>}
        </div>
      </header>
      {body}
    </section>
  )
}
