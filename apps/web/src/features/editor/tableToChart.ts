import type { ChartBlock, TableBlock } from '@/types/document'
import { ulid } from './ulid'

/**
 * Pure conversion: take the first column of a TableBlock as labels and the
 * remaining columns as numeric series. Non-numeric cells coerce to 0.
 *
 * Lifted from ChartBlockEditor so the read-mode "차트로" hover affordance
 * (TableBlockView) and the in-editor "표 → 차트" button can share the same
 * algorithm.
 */
export function tableToChartData(table: TableBlock): ChartBlock['data'] {
  const labels = table.rows.map((r) => r[0] ?? '')
  const seriesCount = Math.max(0, table.headers.length - 1)
  const series = Array.from({ length: seriesCount }, (_, sIdx) => ({
    name: table.headers[sIdx + 1] ?? `Series ${sIdx + 1}`,
    values: table.rows.map((r) => {
      const n = Number(r[sIdx + 1])
      return Number.isFinite(n) ? n : 0
    }),
  }))
  return { labels, series }
}

/** Build a ready-to-insert ChartBlock from a TableBlock. */
export function buildChartFromTable(
  table: TableBlock,
  chartType: ChartBlock['chartType'] = 'bar',
): ChartBlock {
  return {
    type: 'chart',
    id: ulid(),
    chartType,
    data: tableToChartData(table),
    title: '',
  }
}
