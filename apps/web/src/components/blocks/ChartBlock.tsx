import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import type { Block, ChartBlock, DataSourceBlock as DataSourceBlockType } from '@/types/document'
import { EChartsView } from './EChartsView'
import { useResolvedTheme } from '@/features/theme/useResolvedTheme'
import { WidgetExportMenu } from './WidgetExportMenu'
import { chartLabeledToCsv, drillRowsToCsv, drillRowsToTsv } from '@/lib/widgetExport'
import { DrillExportControls } from './DrillExportControls'
import { fetchDataSource } from './DataSourceBlock'
import { payloadToRows, collectSlicerFilters } from './PivotTableBlock'
import { collectTimelineFilters } from './TimelineBlock'
import { aggregateChartData, drillChartRows, type ChartAgg } from './pivotEngine'
import { Modal } from '@/components/ui/Modal'
import { useEditorStore } from '@/features/editor/state'
import { useSlicerStore } from '@/features/slicer/store'

const PALETTE = [
  '#1428A0',
  '#2E5BFF',
  '#10B981',
  '#F59E0B',
  '#DC2626',
  '#7C3AED',
  '#0891B2',
  '#DB2777',
]

/**
 * Dark-surface brighter variants of `PALETTE`. Index mapping preserved so
 * "blue line = sales" semantics stay stable across themes — only
 * luminance shifts. Mirrors the chart-dark-palette cycle pattern used in
 * EChartsView's `PALETTE_DARK`.
 */
const PALETTE_DARK = [
  '#93A5FF', // smsg-blue-700 dark
  '#6E8BFF', // smsg-blue-500 dark
  '#34D399', // emerald-400
  '#FBBF24', // amber-400
  '#F87171', // red-400
  '#A78BFA', // violet-400
  '#22D3EE', // cyan-400
  '#F472B6', // pink-400
]

export function getRechartsPalette(theme: 'light' | 'dark'): readonly string[] {
  return theme === 'dark' ? PALETTE_DARK : PALETTE
}

/**
 * Convert the {labels, series:[{name, values}]} normal form into the
 * row-oriented data Recharts wants: `[{ label, [seriesName]: value, … }]`.
 */
function rowData(block: ChartBlock) {
  const { labels, series } = block.data
  return labels.map((label, idx) => {
    const row: Record<string, string | number> = { label }
    for (const s of series) {
      row[s.name] = s.values?.[idx] ?? 0
    }
    return row
  })
}

function pieData(block: ChartBlock) {
  // For pie, use first series only.
  const s0 = block.data.series[0]
  if (!s0) return [] as { name: string; value: number }[]
  return block.data.labels.map((label, idx) => ({
    name: label,
    value: s0.values?.[idx] ?? 0,
  }))
}

function scatterPoints(series: ChartBlock['data']['series'][number]) {
  return (series.values ?? []).map((y, i) => ({ x: i, y }))
}

/**
 * H2 (G5) — when `block.source` is set, re-aggregate raw rows so slicers /
 * timelines can drive the chart. Returns the original block unchanged
 * when `source` is missing (today's behaviour). The hook fires the same
 * query key as DataSourceBlockView so the underlying HTTP fetch is shared
 * across DataSourceBlock + PivotTable + Chart that all reference the
 * same data-source id.
 *
 * J — also returns `drillContext` with the filtered raw rows + the
 * applied filter list, so the click handler can call `drillChartRows`
 * for a single label without re-fetching or re-merging filters.
 */
interface DrillContext {
  rawRows: Array<Record<string, string | number | null>>
  allFilters: Array<{ field: string; op: string; value: unknown }>
  labelField: string
}

function useHydratedChartBlock(block: ChartBlock): {
  block: ChartBlock
  drillContext: DrillContext | null
} {
  const draft = useEditorStore((s) => s.draft)
  const slicerActive = useSlicerStore((s) => s.active)
  const source = (block as { source?: { kind: string; dataSourceId?: string; rows?: Array<Record<string, unknown>> } }).source
  const labelField = (block as { labelField?: string }).labelField
  const aggregations = (block as { aggregations?: ChartAgg[] }).aggregations
  const filters = (block as { filters?: Array<{ field: string; op: string; value: unknown }> }).filters
  const boundSlicers = (block as { boundSlicers?: ReadonlyArray<string> }).boundSlicers

  const inline = source?.kind === 'inline'
  const dsId = source?.kind === 'data-source' ? source.dataSourceId : undefined

  const dataSourceBlock = useMemo<DataSourceBlockType | null>(() => {
    if (!dsId || !draft) return null
    for (const section of draft.sections ?? []) {
      for (const b of (section.blocks ?? []) as Block[]) {
        if (b.id === dsId && b.type === 'data-source') return b as DataSourceBlockType
      }
    }
    return null
  }, [dsId, draft])

  const endpoint = dataSourceBlock?.endpoint ?? ''
  const params = dataSourceBlock?.params ?? null
  const { data } = useQuery({
    queryKey: ['data-source', endpoint, JSON.stringify(params)],
    queryFn: () => fetchDataSource(endpoint, params),
    enabled: !inline && Boolean(endpoint),
    retry: false,
  })

  return useMemo<{ block: ChartBlock; drillContext: DrillContext | null }>(() => {
    if (!source || !labelField || !aggregations?.length) {
      return { block, drillContext: null }
    }

    const rawRows = inline
      ? (source.rows ?? []) as Array<Record<string, unknown>>
      : (payloadToRows(data?.data ?? null) as Array<Record<string, unknown>>)

    const slicerFilters = collectSlicerFilters(boundSlicers, draft?.sections ?? [], slicerActive)
    const timelineFilters = collectTimelineFilters(boundSlicers, draft?.sections ?? [], slicerActive)
    const allFilters = [...(filters ?? []), ...slicerFilters, ...timelineFilters]

    // aggregateChartData expects RawRow shape (string | number | null).
    // Coerce loose unknowns down — non-primitive cells become strings.
    const coerced = rawRows.map((r) => {
      const out: Record<string, string | number | null> = {}
      for (const [k, v] of Object.entries(r)) {
        out[k] = typeof v === 'string' || typeof v === 'number' || v === null
          ? v
          : v == null
            ? null
            : String(v)
      }
      return out
    })

    const { labels, series } = aggregateChartData(
      coerced,
      labelField,
      aggregations,
      allFilters as Parameters<typeof aggregateChartData>[3],
    )
    return {
      block: {
        ...block,
        data: {
          ...block.data,
          labels,
          series: series.map((s) => ({
            name: s.name,
            values: s.values,
            ...(s.color !== undefined ? { color: s.color } : {}),
            ...(s.yAxisIndex !== undefined ? { yAxisIndex: s.yAxisIndex } : {}),
          })),
        },
      },
      drillContext: {
        rawRows: coerced,
        allFilters,
        labelField,
      },
    }
  }, [block, source, labelField, aggregations, filters, boundSlicers, data, draft, slicerActive, inline])
}

export function ChartBlockView({ block: rawBlock }: { block: ChartBlock }) {
  const { block, drillContext } = useHydratedChartBlock(rawBlock)
  // J — drill-down state. Click on a chart label opens a modal with the
  // raw rows that contributed to that bucket. Only meaningful when
  // `drillContext` is populated (i.e. block.source + labelField + aggs
  // are all set). For ECharts engine path we currently skip drill — the
  // ECharts renderer ships its own native drill via brush/zoom.
  const [drillLabel, setDrillLabel] = useState<string | null>(null)
  const drillRows = useMemo(() => {
    if (!drillContext || drillLabel === null) return []
    return drillChartRows(
      drillContext.rawRows,
      drillContext.allFilters as Parameters<typeof drillChartRows>[1],
      drillContext.labelField,
      drillLabel,
    )
  }, [drillContext, drillLabel])

  // engine === 'echarts' uses the richer ECharts renderer (zoom, brush,
  // markPoint, markArea). Default 'recharts' keeps the original simple
  // surface for back-compat.
  if (block.engine === 'echarts') {
    return <EChartsView block={block} />
  }
  const theme = useResolvedTheme()
  const gridStroke = theme === 'dark' ? '#374151' : '#E5E7EB'
  const axisStroke = theme === 'dark' ? '#E5E7EB' : '#1A1A1A'
  const tooltipContentStyle = theme === 'dark'
    ? { background: '#111827', border: '1px solid #374151', color: '#E5E7EB' }
    : { background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#1A1A1A' }
  const tooltipItemStyle = { color: axisStroke }
  const data = rowData(block)
  return (
    <figure
      className="group relative rounded border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900"
      data-export-root="chart"
    >
      <WidgetExportMenu
        formats={['png', 'csv']}
        getCsv={() =>
          chartLabeledToCsv(block.data.xAxisLabel, block.data.labels, block.data.series)
        }
        filename={(block.title?.trim() || 'chart').replace(/\s+/g, '_')}
      />
      {block.title && (
        <figcaption className="mb-2 text-sm font-semibold text-smsg-900 dark:text-gray-100">
          {block.title}
        </figcaption>
      )}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(
            block,
            data,
            gridStroke,
            axisStroke,
            tooltipContentStyle,
            tooltipItemStyle,
            getRechartsPalette(theme),
            drillContext ? (label) => setDrillLabel(label) : null,
          )}
        </ResponsiveContainer>
      </div>
      {drillLabel !== null && drillContext && (
        <ChartDrillModal
          title={block.title}
          labelField={drillContext.labelField}
          label={drillLabel}
          rows={drillRows as ReadonlyArray<Record<string, string | number | null>>}
          onClose={() => setDrillLabel(null)}
        />
      )}
    </figure>
  )
}

/**
 * J — Chart drill modal. Mirrors PivotDrillModal but renders rows from a
 * Chart's source (not Pivot's). Fields shown: labelField + every other
 * field present in the rows (first-seen order).
 */
export function ChartDrillModal({
  title,
  labelField,
  label,
  rows,
  onClose,
}: {
  title: string | undefined
  labelField: string
  label: string
  rows: ReadonlyArray<Record<string, string | number | null>>
  onClose: () => void
}) {
  const fields = useMemo<string[]>(() => {
    const seen = new Set<string>([labelField])
    const out = [labelField]
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k)
          out.push(k)
        }
      }
    }
    return out
  }, [rows, labelField])
  const headerLabel = title
    ? `${title} — ${labelField}: ${label}`
    : `${labelField}: ${label}`
  return (
    <Modal open onClose={onClose} title={headerLabel} size="xl">
      <div data-testid="chart-drill-modal" className="px-5 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {rows.length === 0
              ? '해당 라벨에 속한 raw row 가 없습니다.'
              : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
          </p>
          {rows.length > 0 && (
            <DrillExportControls
              buildCsv={() => drillRowsToCsv(fields, rows as ReadonlyArray<Record<string, unknown>>)}
              buildTsv={() => drillRowsToTsv(fields, rows as ReadonlyArray<Record<string, unknown>>)}
              filename={`chart-drill-${label}`}
              testIdPrefix="chart-drill"
            />
          )}
        </div>
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {fields.map((f) => (
                    <th
                      key={`chart-drill-h-${f}`}
                      className="border-b border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                    >
                      {f}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`chart-drill-r-${i}`}
                    className={i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'}
                  >
                    {fields.map((f) => (
                      <td
                        key={`chart-drill-c-${i}-${f}`}
                        className="border-b border-gray-100 px-2 py-1 text-gray-800 dark:border-gray-800 dark:text-gray-200"
                      >
                        {r[f] == null ? '' : String(r[f])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}

function renderChart(
  block: ChartBlock,
  data: ReturnType<typeof rowData>,
  gridStroke: string,
  axisStroke: string,
  tooltipContentStyle: CSSProperties,
  tooltipItemStyle: CSSProperties,
  palette: readonly string[],
  onLabelClick: ((label: string) => void) | null,
) {
  const seriesNames = block.data.series.map((s) => s.name)
  // J — recharts attaches an onClick to the chart root. The callback
  // receives `{activeLabel, activePayload}`; we forward the label string
  // when present so the parent opens the drill modal. null guard means
  // drill is silently no-op when source is missing.
  const handleChartClick = onLabelClick
    ? (e: { activeLabel?: string | number } | null | undefined) => {
        const label = e?.activeLabel
        if (label === undefined) return
        onLabelClick(String(label))
      }
    : undefined
  // Visual affordance — pointer when drill is wired up, default otherwise.
  const cursorStyle: CSSProperties | undefined = onLabelClick ? { cursor: 'pointer' } : undefined
  const tooltipProps = {
    wrapperStyle: { outline: 'none' },
    isAnimationActive: false,
    contentStyle: tooltipContentStyle,
    itemStyle: tooltipItemStyle,
    labelStyle: tooltipItemStyle,
  }

  switch (block.chartType) {
    case 'line':
      return (
        <LineChart data={data} onClick={handleChartClick} style={cursorStyle}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="label" stroke={axisStroke} tick={{ fill: axisStroke }} />
          <YAxis stroke={axisStroke} tick={{ fill: axisStroke }} />
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          {seriesNames.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={palette[i % palette.length]}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      )
    case 'bar':
      return (
        <BarChart data={data} onClick={handleChartClick} style={cursorStyle}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="label" stroke={axisStroke} tick={{ fill: axisStroke }} />
          <YAxis stroke={axisStroke} tick={{ fill: axisStroke }} />
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          {seriesNames.map((name, i) => (
            <Bar key={name} dataKey={name} fill={palette[i % palette.length]} />
          ))}
        </BarChart>
      )
    case 'area':
      return (
        <AreaChart data={data} onClick={handleChartClick} style={cursorStyle}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis dataKey="label" stroke={axisStroke} tick={{ fill: axisStroke }} />
          <YAxis stroke={axisStroke} tick={{ fill: axisStroke }} />
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          {seriesNames.map((name, i) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stroke={palette[i % palette.length]}
              fill={palette[i % palette.length]}
              fillOpacity={0.25}
            />
          ))}
        </AreaChart>
      )
    case 'pie': {
      const pData = pieData(block)
      // N — Pie sector click — datum carries `{name, value}` (name == label).
      const handlePieClick = onLabelClick
        ? (d: { name?: string | number } | null | undefined) => {
            if (d?.name === undefined) return
            onLabelClick(String(d.name))
          }
        : undefined
      return (
        <PieChart style={cursorStyle}>
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          <Pie
            data={pData}
            dataKey="value"
            nameKey="name"
            outerRadius={90}
            label
            onClick={handlePieClick}
          >
            {pData.map((_, i) => (
              <Cell key={i} fill={palette[i % palette.length]} />
            ))}
          </Pie>
        </PieChart>
      )
    }
    case 'radar':
      // N — RadarChart 의 onClick 도 LineChart 와 같은 activeLabel 시그니처.
      return (
        <RadarChart data={data} onClick={handleChartClick} style={cursorStyle}>
          <PolarGrid />
          <PolarAngleAxis dataKey="label" />
          <PolarRadiusAxis />
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          {seriesNames.map((name, i) => (
            <Radar
              key={name}
              dataKey={name}
              stroke={palette[i % palette.length]}
              fill={palette[i % palette.length]}
              fillOpacity={0.25}
            />
          ))}
        </RadarChart>
      )
    case 'scatter': {
      // N — Scatter point click. scatterPoints emits `(x: index, y: value)`
      // so the clicked datum's x is the label's index in block.data.labels.
      // Map back to the label string so drill resolution stays uniform with
      // line/bar/area.
      const handlePointClick = onLabelClick
        ? (d: { x?: number } | null | undefined) => {
            if (d?.x === undefined) return
            const label = block.data.labels[d.x]
            if (label === undefined) return
            onLabelClick(String(label))
          }
        : undefined
      return (
        <ScatterChart style={cursorStyle}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
          <XAxis type="number" dataKey="x" name="x" stroke={axisStroke} tick={{ fill: axisStroke }} />
          <YAxis type="number" dataKey="y" name="y" stroke={axisStroke} tick={{ fill: axisStroke }} />
          <ZAxis range={[60, 60]} />
          <Tooltip {...tooltipProps} cursor={{ strokeDasharray: '3 3' }} />
          <Legend verticalAlign="bottom" />
          {block.data.series.map((s, i) => (
            <Scatter
              key={s.name}
              name={s.name}
              data={scatterPoints(s)}
              fill={palette[i % palette.length]}
              onClick={handlePointClick}
            />
          ))}
        </ScatterChart>
      )
    }
    default:
      // Exhaustive fallback — render the data as a table-ish list.
      return (
        <LineChart data={data}>
          <XAxis dataKey="label" stroke={axisStroke} tick={{ fill: axisStroke }} />
          <YAxis stroke={axisStroke} tick={{ fill: axisStroke }} />
          <Tooltip {...tooltipProps} />
        </LineChart>
      )
  }
}
