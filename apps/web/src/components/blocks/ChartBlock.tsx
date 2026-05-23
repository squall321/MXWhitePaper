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
import type { ChartBlock } from '@/types/document'
import { EChartsView } from './EChartsView'

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

export function ChartBlockView({ block }: { block: ChartBlock }) {
  // engine === 'echarts' uses the richer ECharts renderer (zoom, brush,
  // markPoint, markArea). Default 'recharts' keeps the original simple
  // surface for back-compat.
  if (block.engine === 'echarts') {
    return <EChartsView block={block} />
  }
  const data = rowData(block)
  return (
    <figure className="rounded border border-gray-200 bg-white p-3">
      {block.title && (
        <figcaption className="mb-2 text-sm font-semibold text-smsg-900">
          {block.title}
        </figcaption>
      )}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart(block, data)}
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

function renderChart(block: ChartBlock, data: ReturnType<typeof rowData>) {
  const seriesNames = block.data.series.map((s) => s.name)
  const tooltipProps = { wrapperStyle: { outline: 'none' }, isAnimationActive: false }

  switch (block.chartType) {
    case 'line':
      return (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          {seriesNames.map((name, i) => (
            <Line
              key={name}
              type="monotone"
              dataKey={name}
              stroke={PALETTE[i % PALETTE.length]}
              dot={false}
              strokeWidth={2}
            />
          ))}
        </LineChart>
      )
    case 'bar':
      return (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          {seriesNames.map((name, i) => (
            <Bar key={name} dataKey={name} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </BarChart>
      )
    case 'area':
      return (
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          {seriesNames.map((name, i) => (
            <Area
              key={name}
              type="monotone"
              dataKey={name}
              stroke={PALETTE[i % PALETTE.length]}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.25}
            />
          ))}
        </AreaChart>
      )
    case 'pie': {
      const pData = pieData(block)
      return (
        <PieChart>
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          <Pie data={pData} dataKey="value" nameKey="name" outerRadius={90} label>
            {pData.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
        </PieChart>
      )
    }
    case 'radar':
      return (
        <RadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey="label" />
          <PolarRadiusAxis />
          <Tooltip {...tooltipProps} />
          <Legend verticalAlign="bottom" />
          {seriesNames.map((name, i) => (
            <Radar
              key={name}
              dataKey={name}
              stroke={PALETTE[i % PALETTE.length]}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.25}
            />
          ))}
        </RadarChart>
      )
    case 'scatter':
      return (
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis type="number" dataKey="x" name="x" />
          <YAxis type="number" dataKey="y" name="y" />
          <ZAxis range={[60, 60]} />
          <Tooltip {...tooltipProps} cursor={{ strokeDasharray: '3 3' }} />
          <Legend verticalAlign="bottom" />
          {block.data.series.map((s, i) => (
            <Scatter
              key={s.name}
              name={s.name}
              data={scatterPoints(s)}
              fill={PALETTE[i % PALETTE.length]}
            />
          ))}
        </ScatterChart>
      )
    default:
      // Exhaustive fallback — render the data as a table-ish list.
      return (
        <LineChart data={data}>
          <XAxis dataKey="label" />
          <YAxis />
          <Tooltip {...tooltipProps} />
        </LineChart>
      )
  }
}
