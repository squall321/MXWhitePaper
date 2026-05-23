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
// xy-line 의 선형 회귀선/표기는 동일 함수를 에디터/뷰어가 공유하기 위해
// 별도 순수 모듈에 분리되어 있다 (chart-xy-line.plan §2.5).
import { fitLine, formatFit } from '@/features/editor/blocks/_fits'

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
  // display 토글 — gridOn 기본 true, 나머지는 명시적 true 일 때만 ON.
  const display = block.display ?? {}
  const gridOn = display.gridOn !== false

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
              value: series[0]?.values?.[i] ?? 0,
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
        xAxis: {
          type: 'value',
          splitLine: { show: gridOn },
        },
        yAxis: {
          type: 'value',
          splitLine: { show: gridOn },
        },
        series: series.map((s, i) => ({
          name: s.name,
          type: 'scatter',
          data: (s.values ?? []).map((y, j) => [j, y]),
          itemStyle: { color: PALETTE[i % PALETTE.length] },
          markPoint: markPoints.length > 0 ? { data: markPoints } : undefined,
        })),
      }
      break
    }
    case 'xy-line': {
      // 시리즈마다 자유 (x,y) 쌍 — labels 무시. stress-strain 같이 시료별
      // 측정점이 다른 데이터를 한 그림에 겹쳐 비교.
      const xName = block.data?.xAxisLabel ?? ''
      const yName = block.data?.yAxisLabel ?? ''
      // 데이터 시리즈
      const dataSeries = series.map((s, i) => {
        const color = PALETTE[i % PALETTE.length]
        return {
          name: s.name,
          type: 'line' as const,
          smooth: false,
          showSymbol: false,
          data: (s.points ?? []).map((p) => [p.x, p.y]),
          lineStyle: { color },
          itemStyle: { color },
        }
      })
      // showFit=true 면 시리즈마다 선형 회귀선을 별도 line 시리즈로 추가.
      // 같은 색의 dashed line + 끝점 label 로 fit 식/R² 표시.
      const fitSeries: any[] = []
      if (display.showFit === true) {
        series.forEach((s, i) => {
          const result = fitLine(s.points ?? [])
          if (!result) return
          const color = PALETTE[i % PALETTE.length]
          const label = formatFit(result.fit)
          fitSeries.push({
            // legend 와 충돌 안 나도록 fit 시리즈에는 별도 이름.
            name: `${s.name} (fit)`,
            type: 'line',
            smooth: false,
            showSymbol: false,
            // 회귀선 위에 라벨이 겹치지 않게 마지막 점에만 라벨 표시.
            data: [
              [result.line[0].x, result.line[0].y],
              [result.line[1].x, result.line[1].y, label],
            ],
            lineStyle: { color, type: 'dashed', width: 1.5 },
            itemStyle: { color },
            label: {
              show: true,
              position: 'right',
              formatter: (param: any) => {
                const v = param?.value
                // 끝점 (라벨 동봉) 만 표시. 다른 점은 빈 문자열.
                if (Array.isArray(v) && v.length >= 3) return String(v[2])
                return ''
              },
              color,
              fontSize: 11,
            },
            silent: true, // tooltip/legend 동작에서 제외 — fit 은 보조선.
          })
        })
      }

      typedOption = {
        tooltip: {
          trigger: 'axis',
          axisPointer: interactions.showCrosshair
            ? { type: 'cross' }
            : { type: 'line' },
          // xy-line tooltip — 시리즈명 / caption (회색) / (x, y) 단위 포함.
          formatter: (paramsRaw: any) => {
            const params = Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw]
            const rows = params
              .filter((p) => !String(p?.seriesName ?? '').endsWith('(fit)'))
              .map((p) => {
                const v = p?.value
                const x = Array.isArray(v) ? v[0] : ''
                const y = Array.isArray(v) ? v[1] : ''
                const seriesName = String(p?.seriesName ?? '')
                // caption — block.data.series 에서 동명 시리즈 찾기.
                const matched = series.find((s) => s.name === seriesName)
                const caption = matched?.caption
                const captionHtml = caption
                  ? `<div style="color:#888;font-size:11px">${escapeHtml(caption)}</div>`
                  : ''
                const xFmt = formatTooltipNum(x)
                const yFmt = formatTooltipNum(y)
                const xLabel = xName || 'x'
                const yLabel = yName || 'y'
                return `<div style="margin-bottom:4px">
                  <div style="font-weight:600">${escapeHtml(seriesName)}</div>
                  ${captionHtml}
                  <div>(${escapeHtml(xLabel)}, ${escapeHtml(yLabel)}) = (${xFmt}, ${yFmt})</div>
                </div>`
              })
            return rows.join('')
          },
        },
        legend: { bottom: 0, data: dataSeries.map((s) => s.name) },
        grid: { left: 56, right: 24, top: 24, bottom: 64, containLabel: true },
        xAxis: {
          // log 토글이 켜진 경우 type 자체를 'log' 로 — 음수/0 데이터는
          // ECharts 가 자체적으로 skip.
          type: display.xLog === true ? 'log' : 'value',
          name: xName,
          nameLocation: 'middle',
          nameGap: 30,
          splitLine: { show: gridOn },
        },
        yAxis: {
          type: display.yLog === true ? 'log' : 'value',
          name: yName,
          nameLocation: 'middle',
          nameGap: 50,
          splitLine: { show: gridOn },
        },
        // dataZoom — xy-line 의 핵심 인터랙션이라 기본 ON.
        dataZoom: [
          { type: 'inside' },
          { type: 'slider', show: true, bottom: 0 },
        ],
        series: [...dataSeries, ...fitSeries],
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
          splitLine: { show: gridOn },
        },
        yAxis: {
          // category 축인 x 와 달리 y 는 value — yLog 만 의미 있음.
          type: display.yLog === true ? 'log' : 'value',
          splitLine: { show: gridOn },
        },
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

// tooltip HTML 안에 사용자 입력 (시리즈명/caption/축 라벨) 을 끼워넣을 때
// XSS 방지를 위한 최소 escape. echarts formatter 가 반환한 문자열은
// innerHTML 로 들어간다.
function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// xy-line tooltip 용 숫자 포맷 — 크기에 따라 자릿수 자동 조절. 비숫자는 그대로.
function formatTooltipNum(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v ?? '')
  const abs = Math.abs(v)
  if (v === 0) return '0'
  if (abs >= 100) return v.toFixed(1)
  if (abs >= 1) return v.toFixed(3)
  if (abs >= 0.01) return v.toFixed(4)
  return v.toExponential(2)
}
