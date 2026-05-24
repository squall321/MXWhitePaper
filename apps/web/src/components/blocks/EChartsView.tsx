import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import {
  BarChart as EBar,
  CustomChart as ECustom,
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
  MarkLineComponent,
  MarkPointComponent,
  RadarComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ChartBlock } from '@/types/document'
// xy-line 의 회귀선/표기는 동일 함수를 에디터/뷰어가 공유하기 위해 별도 순수
// 모듈에 분리되어 있다 (chart-xy-line.plan §2.5). P3 에서 비선형 fit
// (poly2/poly3/exp/power) 도 같은 모듈로 들어왔다.
import {
  evaluateFit,
  exponentialFit,
  fitLine,
  formatFit,
  formatFitGeneric,
  linearFit,
  polyFit,
  powerFit,
  type AnyFitResult,
  type FitType,
  type XYPoint,
} from '@/features/editor/blocks/_fits'

// Register only the pieces we use to keep the bundle slim. Adding a new
// chart type later means importing it here too.
echarts.use([
  ELine,
  EBar,
  EPie,
  ERadar,
  EScatter,
  ECustom,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  DataZoomComponent,
  MarkPointComponent,
  MarkAreaComponent,
  MarkLineComponent,
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
 * 외부 (예: ChartBlockEditor 의 ⬇PNG 버튼) 가 EChartsView 의 내부 echarts
 * 인스턴스에서 데이터 URL 을 꺼낼 수 있도록 forwardRef 로 노출하는 핸들.
 * 인스턴스가 아직 init 전이거나 dispose 된 직후에는 null 을 반환한다.
 */
export interface EChartsViewHandle {
  getPng(): string | null
}

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
export const EChartsView = forwardRef<EChartsViewHandle, { block: ChartBlock }>(
  function EChartsView({ block }, ref) {
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

    // PNG export 는 ECharts 가 기본 제공하는 getDataURL — 흰 배경을 명시해
    // 발표 자료에 바로 붙여도 투명 배경 문제 없도록 한다.
    useImperativeHandle(
      ref,
      () => ({
        getPng() {
          const inst = instanceRef.current
          if (!inst) return null
          return inst.getDataURL({ type: 'png', backgroundColor: '#fff' })
        },
      }),
      [],
    )

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
  },
)

// P4 — 단위 테스트에서 LTTB/large 옵션 적용을 검증하기 위해 export.
export function buildOption(block: ChartBlock): echarts.EChartsCoreOption {
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
      const yName2 = block.data?.yAxisLabel2 ?? ''
      // P3: dual y-axis — 어떤 시리즈라도 yAxisIndex===1 이 있으면 우축을 추가.
      // 우축은 log 토글 대상이 아니며 (단순화), 좌축의 yLog 만 적용.
      const hasRightAxis = series.some((s) => s.yAxisIndex === 1)
      // P3: timestamp x — xAxisType='time' 이면 ECharts type='time'. log 와
      // 동시 ON 인 경우 time 우선 (log 무시).
      const xIsTime = block.data?.xAxisType === 'time'
      // P2: 수동 축 범위. xLog/yLog 가 켜진 경우 log scale 에는 양수만 들어갈
      // 수 있으므로 0 이하 입력은 무시한다 (echarts 가 NaN 으로 폭주하는 걸 방지).
      const xIsLog = !xIsTime && display.xLog === true
      const yIsLog = display.yLog === true
      const xAxisRange = resolveAxisRange(display.xMin, display.xMax, xIsLog)
      const yAxisRange = resolveAxisRange(display.yMin, display.yMax, yIsLog)
      // 시리즈별 색 — 사용자 지정 (s.color) 이 있으면 우선, 없으면 팔레트.
      const colorFor = (i: number): string =>
        series[i]?.color ?? PALETTE[i % PALETTE.length]!

      // 데이터 시리즈 (메인 line) — yAxisIndex / 색 override 반영.
      // P4 §2.11 — 시리즈 점이 100k 이상이면 ECharts LTTB sampling + large 모드를
      // 자동 ON. 사용자가 display.sampling 으로 명시하면 그 값 우선
      // ('none' = 끄기, 'lttb' = 강제 ON).
      const samplingPref = display.sampling
      const dataSeries: any[] = series.map((s, i) => {
        const color = colorFor(i)
        const points = s.points ?? []
        const useLttb =
          samplingPref === 'lttb' ||
          (samplingPref !== 'none' && points.length >= 100_000)
        const base: any = {
          name: s.name,
          type: 'line' as const,
          smooth: false,
          showSymbol: false,
          data: points.map((p) => [p.x, p.y]),
          lineStyle: { color },
          itemStyle: { color },
          yAxisIndex: s.yAxisIndex === 1 ? 1 : 0,
        }
        if (useLttb) {
          base.sampling = 'lttb'
          base.large = true
        }
        return base
      })

      // P3: error bar — 점마다 err/errLow/errHigh 가 하나라도 있으면 custom
      // series 로 vertical line 을 그린다. legend/tooltip 에서는 숨김.
      const errorSeries: any[] = []
      series.forEach((s, i) => {
        const pts = s.points ?? []
        const hasErr = pts.some(
          (p) => p.err != null || p.errLow != null || p.errHigh != null,
        )
        if (!hasErr) return
        const color = colorFor(i)
        // ECharts custom series 는 [x, yLow, yHigh] 행을 받고 renderItem 에서
        // 픽셀 좌표로 변환해 직접 그린다.
        const errData = pts
          .filter(
            (p) =>
              Number.isFinite(p.x) &&
              Number.isFinite(p.y) &&
              (p.err != null || p.errLow != null || p.errHigh != null),
          )
          .map((p) => {
            const low = p.err ?? p.errLow ?? 0
            const high = p.err ?? p.errHigh ?? 0
            return [p.x, p.y - low, p.y + high]
          })
        if (errData.length === 0) return
        errorSeries.push({
          name: `${s.name}_err`,
          type: 'custom',
          yAxisIndex: s.yAxisIndex === 1 ? 1 : 0,
          renderItem: (_params: any, api: any) => {
            // api.value(d) 는 raw 값, api.coord([x, y]) 는 픽셀 좌표.
            const x = api.value(0)
            const yLow = api.value(1)
            const yHigh = api.value(2)
            const ptLow = api.coord([x, yLow])
            const ptHigh = api.coord([x, yHigh])
            // 짧은 캡 (좌우 4px). vertical line + top/bottom cap.
            const cap = 4
            return {
              type: 'group',
              children: [
                {
                  type: 'line',
                  shape: {
                    x1: ptLow[0],
                    y1: ptLow[1],
                    x2: ptHigh[0],
                    y2: ptHigh[1],
                  },
                  style: { stroke: color, lineWidth: 1 },
                },
                {
                  type: 'line',
                  shape: {
                    x1: ptLow[0] - cap,
                    y1: ptLow[1],
                    x2: ptLow[0] + cap,
                    y2: ptLow[1],
                  },
                  style: { stroke: color, lineWidth: 1 },
                },
                {
                  type: 'line',
                  shape: {
                    x1: ptHigh[0] - cap,
                    y1: ptHigh[1],
                    x2: ptHigh[0] + cap,
                    y2: ptHigh[1],
                  },
                  style: { stroke: color, lineWidth: 1 },
                },
              ],
            }
          },
          data: errData,
          silent: true,
          tooltip: { show: false },
          // legend 에 표시되지 않도록 — legend.data 에서 제외하면 OK.
          z: 1,
        })
      })

      // showFit=true 면 시리즈마다 회귀선 (linear/poly2/poly3/exp/power) 을
      // 별도 line 시리즈로 추가. 같은 색의 dashed line + 끝점 label 로 식/R² 표시.
      // P2: display.fitRange 가 있으면 그 x 구간 안의 점만 회귀에 사용.
      // P3: display.fitType 에 따라 분기. fit 실패 (singular/데이터 부족) 면 skip.
      const fitSeries: any[] = []
      if (display.showFit === true) {
        const fitType: FitType = display.fitType ?? 'linear'
        const fitRange = display.fitRange
        const hasRange =
          fitRange &&
          Number.isFinite(fitRange.xMin) &&
          Number.isFinite(fitRange.xMax) &&
          fitRange.xMin < fitRange.xMax
        const rangeSuffix = hasRange
          ? ` (범위 [${formatTooltipNum(fitRange!.xMin)}, ${formatTooltipNum(fitRange!.xMax)}])`
          : ''
        series.forEach((s, i) => {
          const sourcePoints = s.points ?? []
          const targetPoints: XYPoint[] = (
            hasRange
              ? sourcePoints.filter(
                  (p) => p.x >= fitRange!.xMin && p.x <= fitRange!.xMax,
                )
              : sourcePoints
          ).map((p) => ({ x: p.x, y: p.y }))
          const color = colorFor(i)
          const yIdx = s.yAxisIndex === 1 ? 1 : 0

          if (fitType === 'linear') {
            // 직선은 기존처럼 두 끝점만 있으면 충분.
            const result = fitLine(targetPoints)
            if (!result) return
            const label = `${formatFit(result.fit)}${rangeSuffix}`
            fitSeries.push(
              buildFitLineSeries(
                s.name,
                color,
                yIdx,
                [
                  [result.line[0].x, result.line[0].y],
                  [result.line[1].x, result.line[1].y, label],
                ],
                false,
              ),
            )
            return
          }

          // 비선형 — fit 결과 + 곡선을 균등 50 점 샘플링.
          let result: AnyFitResult | null = null
          if (fitType === 'poly2') result = polyFit(targetPoints, 2)
          else if (fitType === 'poly3') result = polyFit(targetPoints, 3)
          else if (fitType === 'exp') result = exponentialFit(targetPoints)
          else if (fitType === 'power') result = powerFit(targetPoints)
          else {
            // fallback — 알 수 없는 fitType 은 linear 시도.
            const lin = linearFit(targetPoints)
            if (lin.n >= 2) result = lin
          }
          if (!result) return

          // 샘플링 x 범위 — fitRange 우선, 없으면 시리즈 x min/max.
          let xMin = Infinity
          let xMax = -Infinity
          if (hasRange) {
            xMin = fitRange!.xMin
            xMax = fitRange!.xMax
          } else {
            for (const p of targetPoints) {
              if (!Number.isFinite(p.x)) continue
              if (p.x < xMin) xMin = p.x
              if (p.x > xMax) xMax = p.x
            }
          }
          if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) {
            return
          }
          const N = 50
          const xs: number[] = new Array(N)
          for (let k = 0; k < N; k++) {
            xs[k] = xMin + ((xMax - xMin) * k) / (N - 1)
          }
          const ys = evaluateFit(fitType, result, xs)
          if (ys.length !== xs.length) return
          // 마지막 점에 라벨 동봉.
          const label = `${formatFitGeneric(fitType, result)}${rangeSuffix}`
          const curveData: any[] = []
          for (let k = 0; k < N; k++) {
            const y = ys[k]!
            if (!Number.isFinite(y)) continue
            if (k === N - 1) {
              curveData.push([xs[k], y, label])
            } else {
              curveData.push([xs[k], y])
            }
          }
          if (curveData.length < 2) return
          fitSeries.push(
            buildFitLineSeries(s.name, color, yIdx, curveData, true),
          )
        })
      }

      // P3: annotations — marker/arrow/box. 좌축 기준 (yAxisIndex=0) 으로 둔다.
      const annotationSeries: any[] = []
      const annotations = block.annotations ?? []
      annotations.forEach((ann) => {
        const color = ann.color ?? '#666'
        if (ann.kind === 'marker') {
          annotationSeries.push({
            name: `__ann_${ann.id}`,
            type: 'line',
            yAxisIndex: 0,
            data: [],
            silent: true,
            tooltip: { show: false },
            z: 5,
            markPoint: {
              symbol: 'pin',
              symbolSize: 36,
              data: [
                {
                  coord: [ann.x, ann.y],
                  itemStyle: { color },
                  label: {
                    show: true,
                    formatter: ann.label,
                    color: '#fff',
                    fontSize: 11,
                  },
                },
              ],
            },
          })
        } else if (ann.kind === 'arrow') {
          // 화살표 — line series 로 from→to + end symbol='arrow'.
          annotationSeries.push({
            name: `__ann_${ann.id}`,
            type: 'line',
            yAxisIndex: 0,
            data: [
              [ann.fromX, ann.fromY],
              [ann.toX, ann.toY],
            ],
            symbol: ['none', 'arrow'],
            symbolSize: 10,
            lineStyle: { color, type: 'dashed', width: 1.5 },
            itemStyle: { color },
            silent: true,
            tooltip: { show: false },
            z: 5,
            label: ann.label
              ? {
                  show: true,
                  position: 'middle',
                  formatter: ann.label,
                  color,
                  fontSize: 11,
                }
              : { show: false },
          })
        } else if (ann.kind === 'box') {
          // 박스 — markArea 로 직사각형 영역. 빈 데이터 line 에 markArea 부착.
          annotationSeries.push({
            name: `__ann_${ann.id}`,
            type: 'line',
            yAxisIndex: 0,
            data: [],
            silent: true,
            tooltip: { show: false },
            z: 5,
            markArea: {
              itemStyle: {
                color,
                opacity: 0.15,
                borderColor: color,
                borderWidth: 1,
                borderType: 'dashed',
              },
              label: ann.label
                ? {
                    show: true,
                    formatter: ann.label,
                    color,
                    fontSize: 11,
                    position: 'top',
                  }
                : { show: false },
              data: [
                [
                  { coord: [ann.xMin, ann.yMin] },
                  { coord: [ann.xMax, ann.yMax] },
                ],
              ],
            },
          })
        }
      })

      // 좌/우 y 축 구성 — 우축이 필요할 때만 array 로.
      const yAxisLeft = {
        type: yIsLog ? ('log' as const) : ('value' as const),
        name: yName,
        nameLocation: 'middle' as const,
        nameGap: 50,
        splitLine: { show: gridOn },
        ...yAxisRange,
      }
      const yAxisOption = hasRightAxis
        ? [
            yAxisLeft,
            {
              type: 'value' as const,
              name: yName2,
              nameLocation: 'middle' as const,
              nameGap: 50,
              splitLine: { show: false },
            },
          ]
        : yAxisLeft

      // x 축 — time 이면 type='time' (log 무시), 아니면 log/value.
      const xAxisType: 'time' | 'log' | 'value' = xIsTime
        ? 'time'
        : xIsLog
          ? 'log'
          : 'value'

      typedOption = {
        tooltip: {
          trigger: 'axis',
          axisPointer: interactions.showCrosshair
            ? { type: 'cross' }
            : { type: 'line' },
          // xy-line tooltip — 시리즈명 / caption (회색) / (x, y) 단위 포함.
          // fit/error/annotation 보조 시리즈는 제외.
          formatter: (paramsRaw: any) => {
            const params = Array.isArray(paramsRaw) ? paramsRaw : [paramsRaw]
            const rows = params
              .filter((p) => {
                const n = String(p?.seriesName ?? '')
                if (n.endsWith('(fit)')) return false
                if (n.endsWith('_err')) return false
                if (n.startsWith('__ann_')) return false
                return true
              })
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
        grid: { left: 56, right: hasRightAxis ? 56 : 24, top: 24, bottom: 64, containLabel: true },
        xAxis: {
          type: xAxisType,
          name: xName,
          nameLocation: 'middle',
          nameGap: 30,
          splitLine: { show: gridOn },
          ...(xIsTime ? {} : xAxisRange),
        },
        yAxis: yAxisOption,
        // dataZoom — xy-line 의 핵심 인터랙션이라 기본 ON.
        dataZoom: [
          { type: 'inside' },
          { type: 'slider', show: true, bottom: 0 },
        ],
        series: [
          ...dataSeries,
          ...errorSeries,
          ...fitSeries,
          ...annotationSeries,
        ],
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

// 사용자 지정 min/max 를 echarts axis 옵션으로 변환. 한쪽만 있어도 그쪽만
// 적용. log scale 인 축에는 0 / 음수가 들어가면 echarts 가 폭주하므로 양수만
// 통과시킨다 (그 외에는 자동 범위 유지).
function resolveAxisRange(
  min: number | undefined,
  max: number | undefined,
  isLog: boolean,
): { min?: number; max?: number } {
  const out: { min?: number; max?: number } = {}
  if (typeof min === 'number' && Number.isFinite(min)) {
    if (!isLog || min > 0) out.min = min
  }
  if (typeof max === 'number' && Number.isFinite(max)) {
    if (!isLog || max > 0) out.max = max
  }
  return out
}

// fit 시리즈 (선형/비선형 공용) — 같은 색의 dashed line + 끝점 label.
// linear 는 두 끝점, 비선형은 50 점 샘플링한 곡선. smooth 는 비선형일 때만.
function buildFitLineSeries(
  baseName: string,
  color: string,
  yAxisIndex: 0 | 1,
  data: any[],
  smooth: boolean,
): any {
  return {
    name: `${baseName} (fit)`,
    type: 'line',
    smooth,
    showSymbol: false,
    yAxisIndex,
    data,
    lineStyle: { color, type: 'dashed', width: 1.5 },
    itemStyle: { color },
    label: {
      show: true,
      position: 'right',
      formatter: (param: any) => {
        const v = param?.value
        // 라벨 동봉 점 (length>=3) 만 표시, 다른 점은 빈 문자열.
        if (Array.isArray(v) && v.length >= 3) return String(v[2])
        return ''
      },
      color,
      fontSize: 11,
    },
    silent: true, // tooltip/legend 동작에서 제외 — fit 은 보조선.
  }
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
