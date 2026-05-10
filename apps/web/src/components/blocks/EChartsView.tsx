import { useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import {
  BarChart as EBar,
  LineChart as ELine,
  PieChart as EPie,
  RadarChart as ERadar,
  ScatterChart as EScatter,
} from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkPointComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ChartBlock } from '@/types/document'

// Register only the pieces we use to keep the bundle slim. Adding a new
// chart type later means importing it here too.
echarts.use([
  ELine,
  EBar,
  EPie,
  ERadar,
  EScatter,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  MarkPointComponent,
  MarkAreaComponent,
  RadarComponent,
  CanvasRenderer,
])

const PALETTE = [
  '#1428A0',
  '#2E5BFF',
  '#10B981',
  '#F59E0B',
  '#DC2626',
  '#8B5CF6',
  '#0EA5E9',
  '#EC4899',
]

/**
 * EChartsView — renders a `ChartBlock` with `engine === 'echarts'` via
 * Apache ECharts. The translation pipeline is:
 *
 *   1. Convert `data.labels` + `data.series` → standard ECharts axes / series
 *   2. Apply `interactions` knobs (markPoints, markAreas, dataZoom,
 *      crosshair) so casual users get rich interactivity without writing
 *      raw EChartsOption.
 *   3. Deep-merge `block.options` (raw ECharts EChartsOption) on top so
 *      power users can override anything.
 *
 * The chart instance is disposed on unmount and re-renders on data
 * changes via a stable signature (JSON.stringify of the option fragment).
 */
export function EChartsView({ block }: { block: ChartBlock }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const instanceRef = useRef<echarts.ECharts | null>(null)

  const option = useMemo(() => buildOption(block), [block])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const inst = echarts.init(el)
    instanceRef.current = inst
    inst.setOption(option, true)
    const onResize = () => inst.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      inst.dispose()
      instanceRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const inst = instanceRef.current
    if (!inst) return
    inst.setOption(option, true)
  }, [option])

  return (
    <figure className="rounded border border-gray-200 bg-white p-3">
      {block.title && (
        <figcaption className="mb-2 text-sm font-semibold text-smsg-900">
          {block.title}
        </figcaption>
      )}
      <div ref={containerRef} className="h-72 w-full" data-echarts-view />
    </figure>
  )
}

function buildOption(block: ChartBlock): echarts.EChartsCoreOption {
  const labels = block.data?.labels ?? []
  const series = block.data?.series ?? []
  const interactions = block.interactions ?? {}

  // markPoint coords use the series' (x, y) pair. We resolve `xIndex` to
  // the label at that index + the y from the FIRST series — that mirrors
  // the most common "highlight a notable data point" intent.
  const firstValues = series[0]?.values ?? []
  const markPoints = (interactions.keyPoints ?? [])
    .filter((kp) => kp.xIndex >= 0 && kp.xIndex < firstValues.length)
    .map((kp) => ({
      name: kp.label,
      coord: [labels[kp.xIndex], firstValues[kp.xIndex]],
      label: { formatter: kp.label, position: 'top' as const },
      itemStyle: kp.color ? { color: kp.color } : undefined,
    }))

  const markAreas = (interactions.regions ?? [])
    .filter(
      (r) =>
        r.xFromIndex >= 0 &&
        r.xToIndex >= r.xFromIndex &&
        r.xToIndex < labels.length,
    )
    .map((r) => [
      {
        name: r.label,
        xAxis: labels[r.xFromIndex],
        itemStyle: r.color
          ? { color: r.color, opacity: 0.18 }
          : { opacity: 0.12 },
      },
      { xAxis: labels[r.xToIndex] },
    ])

  // ── Per-chart-type translation. ECharts has its own series names,
  // so we map our `chartType` enum onto its conventions. Pie/radar
  // ignore axes; the others use cartesian.
  let typedOption: echarts.EChartsCoreOption

  switch (block.chartType) {
    case 'pie': {
      typedOption = {
        title: undefined, // we render the title in the figcaption
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [
          {
            type: 'pie',
            radius: ['35%', '65%'],
            data: labels.map((label, i) => ({
              name: label,
              value: series[0]?.values[i] ?? 0,
            })),
            itemStyle: { borderColor: '#fff', borderWidth: 2 },
            label: { show: true, formatter: '{b}\n{d}%' },
          },
        ],
      }
      break
    }
    case 'radar': {
      typedOption = {
        tooltip: { trigger: 'axis' },
        legend: { bottom: 0, data: series.map((s) => s.name) },
        radar: {
          indicator: labels.map((name) => ({ name })),
        },
        series: [
          {
            type: 'radar',
            data: series.map((s, i) => ({
              name: s.name,
              value: s.values,
              itemStyle: { color: PALETTE[i % PALETTE.length] },
            })),
          },
        ],
      }
      break
    }
    case 'scatter': {
      typedOption = {
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        xAxis: { type: 'value' },
        yAxis: { type: 'value' },
        series: series.map((s, i) => ({
          name: s.name,
          type: 'scatter',
          data: s.values.map((y, j) => [j, y]),
          itemStyle: { color: PALETTE[i % PALETTE.length] },
          markPoint: markPoints.length > 0 ? { data: markPoints } : undefined,
        })),
      }
      break
    }
    case 'line':
    case 'area':
    case 'bar':
    default: {
      const isBar = block.chartType === 'bar'
      const isArea = block.chartType === 'area'
      typedOption = {
        tooltip: {
          trigger: 'axis',
          axisPointer: interactions.showCrosshair
            ? { type: 'cross' }
            : { type: 'line' },
        },
        legend: { bottom: 0, data: series.map((s) => s.name) },
        grid: { left: 56, right: 24, top: 24, bottom: 56, containLabel: true },
        xAxis: {
          type: 'category',
          data: labels,
          boundaryGap: isBar,
        },
        yAxis: { type: 'value' },
        dataZoom: interactions.showZoom
          ? [
              { type: 'inside' },
              { type: 'slider', height: 18, bottom: 32 },
            ]
          : undefined,
        series: series.map((s, i) => {
          const base = {
            name: s.name,
            type: isBar ? ('bar' as const) : ('line' as const),
            data: s.values,
            itemStyle: { color: PALETTE[i % PALETTE.length] },
            smooth: !isBar,
            areaStyle: isArea
              ? { color: PALETTE[i % PALETTE.length], opacity: 0.2 }
              : undefined,
          }
          // Attach mark{Point,Area} to the FIRST series so the highlights
          // sit on top of the most prominent line — they're shared across
          // the chart visually anyway.
          if (i === 0) {
            return {
              ...base,
              markPoint: markPoints.length > 0 ? { data: markPoints } : undefined,
              markArea: markAreas.length > 0 ? { data: markAreas } : undefined,
            }
          }
          return base
        }),
      }
      break
    }
  }

  // Power-user override: deep-merge raw ECharts options last. We don't
  // bring in lodash for this — a shallow top-level spread covers 95% of
  // the cases and avoids a 70KB dep. Users who want fine-grained merging
  // can pass the full option object themselves.
  if (block.options && typeof block.options === 'object') {
    return { ...typedOption, ...block.options }
  }
  return typedOption
}
