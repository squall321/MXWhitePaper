import { useRef, useState } from 'react'
import type { ChartBlock, TableBlock } from '@/types/document'
import { ChartBlockView } from '@/components/blocks/ChartBlock'
import { EChartsView, type EChartsViewHandle } from '@/components/blocks/EChartsView'
import { useEditorStore } from '@/features/editor/state'
import { parseCsv } from '@/features/editor/extensions/csv-paste'
import { tableToChartData } from '@/features/editor/tableToChart'
import { useT } from '@/lib/i18n'
import { toast } from '@/components/ui/Toast'
import { parseChartPaste, type ChartPasteResult } from './_chartPaste'
import { linearFit, type FitType, type XYPoint } from './_fits'
import { differentiate, integrate, findPeaks, diffSeries } from './_derived'

// P3 — annotation kind (block.annotations 의 union 원소).
type ChartAnnotation = NonNullable<ChartBlock['annotations']>[number]
type AnnotationKind = ChartAnnotation['kind']

// P3 — derived 시리즈 종류 (toolbar dropdown 의 값).
type DerivedOp = 'diff' | 'integrate' | 'peaks' | 'subtract'

interface ChartBlockEditorProps {
  block: ChartBlock
  onChange: (next: ChartBlock) => void
}

interface ChartTypeMeta {
  type: ChartBlock['chartType']
  /** i18n key for the visible label. */
  labelKey: string
  thumb: string
}

const CHART_TYPES: ChartBlock['chartType'][] = [
  'line',
  'bar',
  'pie',
  'area',
  'radar',
  'scatter',
  'xy-line',
]

/**
 * Tiny inline-SVG thumbnails so the dropdown can show a glanceable preview
 * of each chart type. Kept inline (no asset shipping) to avoid bundle bloat.
 */
const CHART_TYPE_META: ReadonlyArray<ChartTypeMeta> = [
  { type: 'line', labelKey: 'editor.chart.type.line', thumb: '╱╲╱' },
  { type: 'bar', labelKey: 'editor.chart.type.bar', thumb: '▁▄▆█' },
  { type: 'pie', labelKey: 'editor.chart.type.pie', thumb: '◔◑◕●' },
  { type: 'area', labelKey: 'editor.chart.type.area', thumb: '▁▃▅▇' },
  { type: 'radar', labelKey: 'editor.chart.type.radar', thumb: '⌬' },
  { type: 'scatter', labelKey: 'editor.chart.type.scatter', thumb: '· · · ·' },
  // xy-line — 시리즈마다 자유 (x, y). stress-strain 같은 측정 데이터용.
  // 엑셀에서 두 컬럼 paste 하면 자동 시리즈 생성.
  { type: 'xy-line', labelKey: 'editor.chart.type.xyLine', thumb: '⤴⤵' },
]

/**
 * 5-row × 3-series sample data — used by the "샘플 데이터" entry point so
 * users can iterate the chart type without first hand-entering numbers.
 */
const SAMPLE_DATA: ChartBlock['data'] = {
  labels: ['1월', '2월', '3월', '4월', '5월'],
  series: [
    { name: 'A 지표', values: [10, 14, 17, 23, 28] },
    { name: 'B 지표', values: [8, 11, 15, 19, 22] },
    { name: 'C 지표', values: [5, 9, 12, 16, 20] },
  ],
}

/**
 * paste 결과를 기존 ChartBlock 에 합쳐 새 block 을 반환하는 순수 함수.
 *
 * 규칙:
 *  - chartType === 'xy-line' 이고 기존 series 가 있으면 **append** (시리즈 누적)
 *  - 그 외엔 chartType 을 'xy-line' 으로 전환하고 series 전체 교체
 *    (사용자가 다른 차트 위에 의도적으로 데이터 paste 했다고 본다)
 *  - title / xAxisLabel / yAxisLabel: 기존 값이 비어 있을 때만 paste 결과로 채운다
 *
 * onPaste 핸들러와 단위 테스트 양쪽이 같은 경로를 쓰도록 export.
 */
export function applyChartPasteToBlock(
  block: ChartBlock,
  parsed: ChartPasteResult,
): ChartBlock {
  const isXyLine = block.chartType === 'xy-line'
  const hasExistingSeries = (block.data.series ?? []).length > 0

  // paste 결과 시리즈를 ChartBlock 의 series shape (points 기반) 으로 사상.
  const pastedSeries = parsed.series.map((s) => {
    const out: ChartBlock['data']['series'][number] = {
      name: s.name,
      points: s.points,
    }
    if (s.caption !== undefined) out.caption = s.caption
    return out
  })

  // append vs 교체.
  const nextSeries =
    isXyLine && hasExistingSeries
      ? [...block.data.series, ...pastedSeries]
      : pastedSeries

  // title / 축 라벨 — 기존 값이 비어 있을 때만 paste 결과로 채운다.
  const nextTitle =
    block.title && block.title.trim() !== '' ? block.title : parsed.title

  const data = block.data
  const nextXAxisLabel =
    data.xAxisLabel && data.xAxisLabel.trim() !== ''
      ? data.xAxisLabel
      : parsed.xAxisLabel
  const nextYAxisLabel =
    data.yAxisLabel && data.yAxisLabel.trim() !== ''
      ? data.yAxisLabel
      : parsed.yAxisLabel
  // P3 — paste 가 timestamp 컬럼을 인식했으면 xAxisType='time' 전파 (기존 값 우선).
  const nextXAxisType = data.xAxisType ?? parsed.xAxisType

  return {
    ...block,
    chartType: 'xy-line',
    title: nextTitle,
    data: {
      ...data,
      // xy-line 은 labels 를 사용하지 않지만 스키마상 필수이므로 기존 값 유지.
      labels: data.labels ?? [],
      series: nextSeries,
      xAxisLabel: nextXAxisLabel,
      yAxisLabel: nextYAxisLabel,
      xAxisType: nextXAxisType,
    },
  }
}

/**
 * P2 — xy-line series 를 union x 축의 N×(K+1) CSV 로 직렬화하는 순수 함수.
 *
 * 시리즈마다 x 가 다를 수 있으므로 (stress-strain 시료별로 측정점이 다름)
 * 모든 x 의 합집합을 만들고 정렬 → 시리즈별로 해당 x 에 y 가 있으면 채우고
 * 없으면 빈 칸. 결과 CSV 의 첫 행은 헤더 `x,Series1,Series2,...`.
 *
 * 시리즈 이름에 콤마/따옴표/개행이 있으면 RFC 4180 식으로 quote.
 * onChange handler 가 아닌 download 헬퍼가 호출하지만, 순수 함수로 분리해
 * 테스트에서 직접 검증한다.
 */
export function buildCsvExport(
  series: ReadonlyArray<{
    name: string
    points?: ReadonlyArray<XYPoint>
  }>,
): string {
  // x 합집합 (정확 동치만 — float noise 가 있는 데이터는 paste 단계에서 이미
  // 정수/문자열 키로 정규화되어 있다고 가정).
  const xSet = new Set<number>()
  for (const s of series) {
    for (const p of s.points ?? []) {
      if (Number.isFinite(p.x)) xSet.add(p.x)
    }
  }
  const xs = Array.from(xSet).sort((a, b) => a - b)

  // 시리즈별 x→y lookup.
  const lookups = series.map((s) => {
    const m = new Map<number, number>()
    for (const p of s.points ?? []) {
      if (Number.isFinite(p.x) && Number.isFinite(p.y)) m.set(p.x, p.y)
    }
    return m
  })

  const header = ['x', ...series.map((s) => csvField(s.name))].join(',')
  const rows = xs.map((x) => {
    const cells = [String(x), ...lookups.map((m) => {
      const y = m.get(x)
      return y === undefined ? '' : String(y)
    })]
    return cells.join(',')
  })
  return [header, ...rows].join('\n')
}

function csvField(raw: string): string {
  // RFC 4180 — , / " / 개행 포함이면 quote + 내부 " 는 ""
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

/**
 * P2 — 시리즈별 통계 한 줄 (B6 통계 박스). slope 는 linearFit 결과.
 * 점 수 < 1 이면 NaN 으로 표시되도록 호출측이 처리한다.
 */
export interface SeriesStat {
  name: string
  n: number
  xMin: number
  xMax: number
  yMean: number
  yStd: number
  slope: number | null
}

export function computeSeriesStats(
  series: ReadonlyArray<{
    name: string
    points?: ReadonlyArray<XYPoint>
  }>,
): SeriesStat[] {
  return series.map((s) => {
    const pts = (s.points ?? []).filter(
      (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
    )
    const n = pts.length
    if (n === 0) {
      return {
        name: s.name,
        n: 0,
        xMin: NaN,
        xMax: NaN,
        yMean: NaN,
        yStd: NaN,
        slope: null,
      }
    }
    let xMin = Infinity
    let xMax = -Infinity
    let sumY = 0
    for (const p of pts) {
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      sumY += p.y
    }
    const yMean = sumY / n
    // 표본표준편차 (n>1 일 때만 의미). n==1 이면 0.
    let varSum = 0
    for (const p of pts) {
      const d = p.y - yMean
      varSum += d * d
    }
    const yStd = n > 1 ? Math.sqrt(varSum / (n - 1)) : 0
    // 기울기는 n>=2 이고 x 가 모두 같지 않을 때만.
    const fit = n >= 2 ? linearFit(pts) : null
    const slope = fit && fit.n >= 2 ? fit.slope : null
    return { name: s.name, n, xMin, xMax, yMean, yStd, slope }
  })
}

/** stats 패널에서 NaN/null 안전 출력. */
function formatStatNum(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 100) return v.toFixed(1)
  if (abs >= 1) return v.toFixed(3)
  if (abs >= 0.01) return v.toFixed(4)
  return v.toExponential(2)
}

/**
 * Edit-mode surface for `chart` blocks. Sprint 6 minimum:
 *   - title input
 *   - chart-type dropdown
 *   - data grid (labels in first column, series as columns)
 *   - "표 → 차트 변환" button: scans the current draft for the FIRST
 *     `table` block and copies its first column → labels and remaining
 *     columns → series.
 *
 * The live ChartBlockView renders below the grid for instant preview.
 */
export function ChartBlockEditor({ block, onChange }: ChartBlockEditorProps) {
  const t = useT()
  const draft = useEditorStore((s) => s.draft)
  const [convertHint, setConvertHint] = useState<string | null>(null)
  // 차트 타입 분기 — xy-line 은 series.points 기반 별도 편집 UI 를 그린다.
  const isXyLine = block.chartType === 'xy-line'

  const setLabel = (idx: number, label: string) => {
    const labels = [...block.data.labels]
    labels[idx] = label
    onChange({ ...block, data: { ...block.data, labels } })
  }
  const setValue = (sIdx: number, lIdx: number, raw: string) => {
    const value = Number(raw)
    const series = block.data.series.map((s, i) => {
      if (i !== sIdx) return s
      const values = [...(s.values ?? [])]
      values[lIdx] = Number.isFinite(value) ? value : 0
      return { ...s, values }
    })
    onChange({ ...block, data: { ...block.data, series } })
  }
  const setSeriesName = (sIdx: number, name: string) => {
    const series = block.data.series.map((s, i) =>
      i === sIdx ? { ...s, name } : s,
    )
    onChange({ ...block, data: { ...block.data, series } })
  }
  const addRow = () => {
    const labels = [...block.data.labels, `Row ${block.data.labels.length + 1}`]
    const series = block.data.series.map((s) => ({ ...s, values: [...(s.values ?? []), 0] }))
    onChange({ ...block, data: { ...block.data, labels, series } })
  }
  const addSeries = () => {
    const series = [
      ...block.data.series,
      { name: `Series ${block.data.series.length + 1}`, values: block.data.labels.map(() => 0) },
    ]
    onChange({ ...block, data: { ...block.data, series } })
  }
  const removeRow = (idx: number) => {
    const labels = block.data.labels.filter((_, i) => i !== idx)
    const series = block.data.series.map((s) => ({
      ...s,
      values: (s.values ?? []).filter((_, i) => i !== idx),
    }))
    onChange({ ...block, data: { ...block.data, labels, series } })
  }

  const convertFromTable = () => {
    const table = findFirstTable(draft)
    if (!table) {
      setConvertHint(t('editor.chart.noTable'))
      return
    }
    const next = tableToChartData(table)
    onChange({ ...block, data: next })
    setConvertHint(t('editor.chart.seriesConverted', { n: table.headers.length - 1 }))
  }

  const seedSample = () => {
    onChange({ ...block, data: SAMPLE_DATA })
    setConvertHint(t('editor.chart.sampleApplied'))
  }

  // Convert raw CSV text → chart data. Pulled out of the paste handler so
  // both `onPaste` AND the explicit "적용" button share the same code path.
  // Without the button, users who *typed* into the textarea (or used Ctrl+V
  // into a sub-element of the textarea) had no way to commit the change.
  const applyCsvText = (text: string): boolean => {
    const parsed = parseCsv(text)
    if (!parsed) {
      setConvertHint(t('editor.chart.notCsv'))
      return false
    }
    const labels = parsed.rows.map((r) => r[0] ?? '')
    const seriesCount = Math.max(0, parsed.headers.length - 1)
    const series = Array.from({ length: seriesCount }, (_, sIdx) => ({
      name: parsed.headers[sIdx + 1] ?? `Series ${sIdx + 1}`,
      values: parsed.rows.map((r) => {
        const n = Number(r[sIdx + 1])
        return Number.isFinite(n) ? n : 0
      }),
    }))
    onChange({ ...block, data: { labels, series } })
    setConvertHint(t('editor.chart.csvApplied', { rows: parsed.rows.length, cols: seriesCount }))
    return true
  }

  const onCsvPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (applyCsvText(text)) e.preventDefault()
  }

  // 차트 블록 wrapper 위에서 받은 paste 이벤트.
  //
  // 핵심 — input/textarea 가 target 인 경우에도 *클립보드 내용 자체가 표 모양*
  // (multi-line + tab/comma) 이면 차트 데이터로 간주해 가로챈다. 사용자가
  // 차트 블록 안 어디든 paste 했을 때 직관적으로 동작하기 위함. 표 모양이
  // 아닌 평범한 짧은 텍스트 (시리즈명 입력 등) 는 native paste 그대로.
  const onWrapperPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const parsed = parseChartPaste(text)
    if (!parsed) return  // non-csv → 기본 paste 동작 유지
    // 표 모양 텍스트 — input/textarea/contentEditable 안에서도 가로채기.
    e.preventDefault()
    e.stopPropagation()
    onChange(applyChartPasteToBlock(block, parsed))
    setConvertHint(
      t('editor.chart.csvApplied', {
        rows: parsed.series[0]?.points.length ?? 0,
        cols: parsed.series.length,
      }),
    )
    // P4 §2.11 — 5σ outlier 가 1% 초과인 시리즈는 toast.warn 으로 알림.
    // (최대 3 건만 띄워 toast 폭주 방지.)
    if (parsed.outliers && parsed.outliers.length > 0) {
      for (const o of parsed.outliers.slice(0, 3)) {
        toast.warn(`${o.seriesName}: 큰 outlier ${o.count}/${o.total} 점 — 데이터 확인 권장`)
      }
    }
  }

  // toolbar — display 토글 update 헬퍼.
  const display = block.display ?? {}
  const setDisplay = (patch: Partial<NonNullable<ChartBlock['display']>>) => {
    onChange({ ...block, display: { ...display, ...patch } })
  }
  // gridOn: 명시되지 않으면 true 로 본다.
  const gridOn = display.gridOn !== false

  const [csvDraft, setCsvDraft] = useState('')
  const onApplyClick = () => {
    if (!csvDraft.trim()) {
      setConvertHint(t('editor.chart.csvEmpty'))
      return
    }
    applyCsvText(csvDraft)
  }
  const onLoadExample = () => {
    const ex = '월,매출,비용\n1월,120,80\n2월,150,90\n3월,180,110\n4월,210,130\n5월,240,140'
    setCsvDraft(ex)
    applyCsvText(ex)
  }

  // P2 — 숫자 input 갱신용 헬퍼. 빈 칸이면 해당 키를 display 에서 제거 (auto).
  // 유한수만 받음. 다른 키는 보존.
  const setAxisRange = (
    key: 'xMin' | 'xMax' | 'yMin' | 'yMax',
    raw: string,
  ) => {
    const trimmed = raw.trim()
    const nextDisplay = { ...display }
    if (trimmed === '') {
      delete nextDisplay[key]
    } else {
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return // 잘못된 입력은 무시 (이전 값 유지)
      nextDisplay[key] = n
    }
    onChange({ ...block, display: nextDisplay })
  }
  const setFitRange = (key: 'xMin' | 'xMax', raw: string) => {
    const trimmed = raw.trim()
    const current = display.fitRange
    const nextDisplay = { ...display }
    if (trimmed === '') {
      // 한쪽이라도 비면 fitRange 자체를 제거 (전체 점 회귀).
      delete nextDisplay.fitRange
    } else {
      const n = Number(trimmed)
      if (!Number.isFinite(n)) return
      const other = key === 'xMin' ? 'xMax' : 'xMin'
      const otherVal = current?.[other]
      // 한쪽만 들어와 있고 다른쪽이 없으면 NaN 대신 동일값 임시 — 검증은
      // EChartsView 가 xMin<xMax 인지 체크하므로 여기서는 객체만 보존.
      const nextRange = {
        xMin: key === 'xMin' ? n : (otherVal ?? n),
        xMax: key === 'xMax' ? n : (otherVal ?? n),
      }
      nextDisplay.fitRange = nextRange
    }
    onChange({ ...block, display: nextDisplay })
  }

  // P2 — 시리즈 reorder/delete (E4 시리즈 정리 panel). 인덱스 기반.
  const moveSeries = (sIdx: number, dir: -1 | 1) => {
    const target = sIdx + dir
    const len = block.data.series.length
    if (target < 0 || target >= len) return
    const next = [...block.data.series]
    const tmp = next[sIdx]!
    next[sIdx] = next[target]!
    next[target] = tmp
    onChange({ ...block, data: { ...block.data, series: next } })
  }
  const removeSeries = (sIdx: number) => {
    const next = block.data.series.filter((_, i) => i !== sIdx)
    onChange({ ...block, data: { ...block.data, series: next } })
  }

  // P3 — dual-y 토글 상태. 시리즈 중 yAxisIndex=1 가 하나라도 있으면 켜진 것으로 간주.
  const dualYEnabled = block.data.series.some((s) => s.yAxisIndex === 1)
  const toggleDualY = () => {
    if (dualYEnabled) {
      // 끄기 — 모든 시리즈의 yAxisIndex 를 제거 (정규화).
      const series = block.data.series.map((s) => {
        const { yAxisIndex: _drop, ...rest } = s
        return rest
      })
      onChange({ ...block, data: { ...block.data, series } })
    } else {
      // 켜기 — 마지막 시리즈를 R 축으로 옮긴다 (사용자가 더 옮기고 싶으면 panel 에서).
      const last = block.data.series.length - 1
      if (last < 0) return // 시리즈 0 이면 no-op
      const series = block.data.series.map((s, i) =>
        i === last ? { ...s, yAxisIndex: 1 as const } : s,
      )
      onChange({ ...block, data: { ...block.data, series } })
    }
  }
  const setSeriesYAxis = (sIdx: number, axis: 0 | 1) => {
    const series = block.data.series.map((s, i) => {
      if (i !== sIdx) return s
      if (axis === 0) {
        const { yAxisIndex: _drop, ...rest } = s
        return rest
      }
      return { ...s, yAxisIndex: 1 as const }
    })
    onChange({ ...block, data: { ...block.data, series } })
  }

  // P3 — annotation 추가 (kind 별 중앙 좌표). bbox 가 비어있으면 (0,0).
  // crypto.randomUUID 가 vitest 환경에서 없을 수 있어 fallback.
  const genAnnId = (): string => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      try {
        return (crypto as { randomUUID: () => string }).randomUUID()
      } catch {
        /* ignore */
      }
    }
    return `ann_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
  }
  const seriesBBox = (): { x: number; y: number; spanX: number; spanY: number } => {
    let xMin = Infinity
    let xMax = -Infinity
    let yMin = Infinity
    let yMax = -Infinity
    for (const s of block.data.series) {
      for (const p of s.points ?? []) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
        if (p.x < xMin) xMin = p.x
        if (p.x > xMax) xMax = p.x
        if (p.y < yMin) yMin = p.y
        if (p.y > yMax) yMax = p.y
      }
    }
    if (!Number.isFinite(xMin) || !Number.isFinite(xMax)) {
      return { x: 0, y: 0, spanX: 1, spanY: 1 }
    }
    const spanX = Math.max(xMax - xMin, 1)
    const spanY = Math.max(yMax - yMin, 1)
    return { x: (xMin + xMax) / 2, y: (yMin + yMax) / 2, spanX, spanY }
  }
  const addAnnotation = (kind: AnnotationKind) => {
    const bbox = seriesBBox()
    const id = genAnnId()
    let next: ChartAnnotation
    if (kind === 'marker') {
      next = { kind: 'marker', id, x: bbox.x, y: bbox.y, label: 'Marker' }
    } else if (kind === 'arrow') {
      const dx = bbox.spanX * 0.1
      const dy = bbox.spanY * 0.1
      next = {
        kind: 'arrow',
        id,
        fromX: bbox.x - dx,
        fromY: bbox.y - dy,
        toX: bbox.x + dx,
        toY: bbox.y + dy,
        label: 'Arrow',
      }
    } else {
      const dx = bbox.spanX * 0.1
      const dy = bbox.spanY * 0.1
      next = {
        kind: 'box',
        id,
        xMin: bbox.x - dx,
        xMax: bbox.x + dx,
        yMin: bbox.y - dy,
        yMax: bbox.y + dy,
        label: 'Box',
      }
    }
    const annotations = [...(block.annotations ?? []), next]
    onChange({ ...block, annotations })
  }
  const updateAnnotation = (id: string, patch: Partial<ChartAnnotation>) => {
    const annotations = (block.annotations ?? []).map((a) =>
      a.id === id ? ({ ...a, ...patch } as ChartAnnotation) : a,
    )
    onChange({ ...block, annotations })
  }
  const removeAnnotation = (id: string) => {
    const annotations = (block.annotations ?? []).filter((a) => a.id !== id)
    onChange({ ...block, annotations })
  }

  // P3 — derived 시리즈/annotation 추가. value 형식: "<op>:<arg>"
  const applyDerived = (raw: string) => {
    const [op, arg] = raw.split(':') as [DerivedOp, string]
    if (!op || arg === undefined) return
    if (op === 'subtract') {
      const [aStr, bStr] = arg.split('-')
      const aIdx = Number(aStr)
      const bIdx = Number(bStr)
      const a = block.data.series[aIdx]
      const b = block.data.series[bIdx]
      if (!a || !b) return
      const points = diffSeries(a.points ?? [], b.points ?? [])
      if (points.length === 0) return
      const series = [
        ...block.data.series,
        { name: `${a.name}-${b.name}`, points },
      ]
      onChange({ ...block, data: { ...block.data, series } })
      return
    }
    const sIdx = Number(arg)
    const src = block.data.series[sIdx]
    if (!src) return
    if (op === 'peaks') {
      const peaks = findPeaks(src.points ?? [])
      if (peaks.length === 0) return
      const newAnns: ChartAnnotation[] = peaks.map((p) => ({
        kind: 'marker',
        id: genAnnId(),
        x: p.x,
        y: p.y,
        label: p.kind, // 'peak' 또는 'valley'
      }))
      const annotations = [...(block.annotations ?? []), ...newAnns]
      onChange({ ...block, annotations })
      return
    }
    const points =
      op === 'diff'
        ? differentiate(src.points ?? [])
        : op === 'integrate'
          ? integrate(src.points ?? [])
          : []
    if (points.length === 0) return
    const name =
      op === 'diff' ? `d(${src.name})/dx` : `∫${src.name}dx`
    const series = [...block.data.series, { name, points }]
    onChange({ ...block, data: { ...block.data, series } })
  }

  // P2 — PNG / CSV export. PNG 는 hidden EChartsView 에 부착된 ref 로 dataURL
  // 을 받아 a[download] 클릭. CSV 는 buildCsvExport 결과를 Blob 으로 변환.
  // 빈 차트 (series 0) 면 버튼 비활성.
  const chartRef = useRef<EChartsViewHandle | null>(null)
  const hasSeries = block.data.series.length > 0
  const downloadName = (block.title?.trim() || 'chart').replace(/[^\w.-]+/g, '_')

  const exportPng = () => {
    const url = chartRef.current?.getPng()
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = `${downloadName}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  const exportCsv = () => {
    if (!hasSeries) return
    const csv = buildCsvExport(
      block.data.series.map((s) => ({ name: s.name, points: s.points })),
    )
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${downloadName}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  // 통계 panel 데이터. 항상 계산 (가벼움). showStats 일 때만 렌더.
  const stats = isXyLine ? computeSeriesStats(block.data.series) : []
  // fitRange 유효성 — UI 경고용. 둘 다 finite 이고 xMin < xMax 가 아니면 invalid.
  const fitRangeInvalid =
    display.fitRange !== undefined &&
    Number.isFinite(display.fitRange.xMin) &&
    Number.isFinite(display.fitRange.xMax) &&
    !(display.fitRange.xMin < display.fitRange.xMax)

  return (
    <div
      className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3"
      onPaste={onWrapperPaste}
    >
      {isXyLine && (
        <div
          role="toolbar"
          aria-label={t('editor.chart.toolbar')}
          className="flex flex-wrap items-center gap-1 text-[11px]"
        >
          <button
            type="button"
            aria-pressed={gridOn}
            data-toolbar="grid"
            onClick={() => setDisplay({ gridOn: !gridOn })}
            className={`rounded border px-2 py-0.5 ${
              gridOn
                ? 'border-smsg-500 bg-smsg-50 text-smsg-900'
                : 'border-gray-300 bg-white text-gray-600'
            }`}
          >
            # {t('editor.chart.gridOn')}
          </button>
          <button
            type="button"
            aria-pressed={!!display.xLog}
            data-toolbar="xlog"
            onClick={() => setDisplay({ xLog: !display.xLog })}
            className={`rounded border px-2 py-0.5 ${
              display.xLog
                ? 'border-smsg-500 bg-smsg-50 text-smsg-900'
                : 'border-gray-300 bg-white text-gray-600'
            }`}
          >
            {t('editor.chart.xLog')}
          </button>
          <button
            type="button"
            aria-pressed={!!display.yLog}
            data-toolbar="ylog"
            onClick={() => setDisplay({ yLog: !display.yLog })}
            className={`rounded border px-2 py-0.5 ${
              display.yLog
                ? 'border-smsg-500 bg-smsg-50 text-smsg-900'
                : 'border-gray-300 bg-white text-gray-600'
            }`}
          >
            {t('editor.chart.yLog')}
          </button>
          {/* P3 — fit type select. '' = 없음 (= showFit off), 그 외 5 가지 모델. */}
          <label className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700">
            <span className="text-gray-500">{t('editor.chart.fit.label')}</span>
            <select
              data-toolbar="fit-type"
              value={display.showFit ? (display.fitType ?? 'linear') : ''}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') {
                  setDisplay({ showFit: false })
                } else {
                  setDisplay({ showFit: true, fitType: v as FitType })
                }
              }}
              className="bg-transparent text-[11px] outline-none"
            >
              <option value="">{t('editor.chart.fit.none')}</option>
              <option value="linear">{t('editor.chart.fit.linear')}</option>
              <option value="poly2">{t('editor.chart.fit.poly2')}</option>
              <option value="poly3">{t('editor.chart.fit.poly3')}</option>
              <option value="exp">{t('editor.chart.fit.exp')}</option>
              <option value="power">{t('editor.chart.fit.power')}</option>
            </select>
          </label>
          {/* P3 — dual-y 토글. 켜면 series-panel 에 L/R 라디오가 나타남. */}
          <button
            type="button"
            aria-pressed={dualYEnabled}
            data-toolbar="dual-y"
            onClick={toggleDualY}
            className={`rounded border px-2 py-0.5 ${
              dualYEnabled
                ? 'border-smsg-500 bg-smsg-50 text-smsg-900'
                : 'border-gray-300 bg-white text-gray-600'
            }`}
          >
            {t('editor.chart.dualY')}
          </button>
          {/* P3 — annotation 추가 dropdown. 선택 즉시 차트 중앙 좌표에 추가. */}
          <label className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700">
            <span className="text-gray-500">{t('editor.chart.annotation.add')}</span>
            <select
              data-toolbar="add-annotation"
              value=""
              onChange={(e) => {
                const v = e.target.value as AnnotationKind | ''
                if (v === '') return
                addAnnotation(v)
                // select 를 즉시 reset — controlled component 이므로 value=''
                // 가 다시 적용되어 select 가 placeholder 로 돌아간다.
              }}
              className="bg-transparent text-[11px] outline-none"
            >
              <option value="">—</option>
              <option value="marker">{t('editor.chart.annotation.kind.marker')}</option>
              <option value="arrow">{t('editor.chart.annotation.kind.arrow')}</option>
              <option value="box">{t('editor.chart.annotation.kind.box')}</option>
            </select>
          </label>
          {/* P3 — derived 시리즈 메뉴. 시리즈 1 개 골라 즉시 적용. peaks 만 annotation 으로. */}
          <label className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700">
            <span className="text-gray-500">{t('editor.chart.derived.add')}</span>
            <select
              data-toolbar="add-derived"
              value=""
              onChange={(e) => {
                const v = e.target.value
                if (!v) return
                // value 형식: "<op>:<sIdx>" 또는 "subtract:<a>-<b>" (두 시리즈 선택은
                // 단순화를 위해 a=0, b=1 fix — 사용자가 시리즈 정리 panel 에서
                // reorder 한 뒤 호출하는 것을 권장. 시리즈 2 개 미만이면 옵션 자체 없음).
                applyDerived(v)
              }}
              className="bg-transparent text-[11px] outline-none"
            >
              <option value="">—</option>
              {block.data.series.map((s, i) => (
                <option key={`diff-${i}`} value={`diff:${i}`}>
                  d/dx {s.name}
                </option>
              ))}
              {block.data.series.map((s, i) => (
                <option key={`int-${i}`} value={`integrate:${i}`}>
                  ∫ {s.name} dx
                </option>
              ))}
              {block.data.series.map((s, i) => (
                <option key={`pk-${i}`} value={`peaks:${i}`}>
                  Peaks {s.name}
                </option>
              ))}
              {block.data.series.length >= 2 && (
                <option value={`subtract:0-1`}>
                  {block.data.series[0]?.name} - {block.data.series[1]?.name}
                </option>
              )}
            </select>
          </label>
          {/* P3 — timestamp x 축 hint chip. xAxisType='time' 일 때만. 클릭하면 'value' 로. */}
          {block.data.xAxisType === 'time' && (
            <button
              type="button"
              data-toolbar="x-axis-time"
              onClick={() =>
                onChange({
                  ...block,
                  data: { ...block.data, xAxisType: 'value' },
                })
              }
              className="rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-blue-800"
              title={t('editor.chart.xAxisType.timeHint')}
            >
              {t('editor.chart.xAxisType.time')}
            </button>
          )}
          <button
            type="button"
            data-toolbar="reset-zoom"
            // P1 단계에서는 placeholder — 실제 dataZoom reset 은 P3 에서
            // EChartsView 의 instance handle 을 통해 수행한다.
            onClick={() => {
              /* no-op placeholder */
            }}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-600"
          >
            {t('editor.chart.resetZoom')}
          </button>
          <button
            type="button"
            aria-pressed={!!display.showStats}
            data-toolbar="stats"
            onClick={() => setDisplay({ showStats: !display.showStats })}
            className={`rounded border px-2 py-0.5 ${
              display.showStats
                ? 'border-smsg-500 bg-smsg-50 text-smsg-900'
                : 'border-gray-300 bg-white text-gray-600'
            }`}
          >
            {t('editor.chart.stats')}
          </button>
          <button
            type="button"
            data-toolbar="export-png"
            disabled={!hasSeries}
            onClick={exportPng}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 disabled:opacity-40"
          >
            {t('editor.chart.exportPng')}
          </button>
          <button
            type="button"
            data-toolbar="export-csv"
            disabled={!hasSeries}
            onClick={exportCsv}
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-gray-700 disabled:opacity-40"
          >
            {t('editor.chart.exportCsv')}
          </button>
        </div>
      )}

      {/* P2 — 축 범위 popover. xy-line 일 때만. 빈 값 = auto. P3 — dual-y 가 켜져
          있으면 오른쪽 y 축 라벨 input 도 함께 노출. */}
      {isXyLine && (
        <details data-section="axis-range" className="rounded border border-gray-200 bg-white p-2 text-xs">
          <summary className="cursor-pointer text-gray-700">{t('editor.chart.axisRange')}</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['xMin', 'xMax', 'yMin', 'yMax'] as const).map((k) => (
              <label key={k} className="block">
                <span className="mb-1 block text-[10px] text-gray-500">
                  {t(`editor.chart.axisRange.${k}`)}
                </span>
                <input
                  type="number"
                  data-axis-range={k}
                  value={display[k] === undefined ? '' : String(display[k])}
                  onChange={(e) => setAxisRange(k, e.target.value)}
                  placeholder={t('editor.chart.axisRange.autoHint')}
                  className="w-full rounded border border-gray-300 px-1.5 py-0.5"
                />
              </label>
            ))}
          </div>
          {dualYEnabled && (
            <label className="mt-2 block">
              <span className="mb-1 block text-[10px] text-gray-500">
                {t('editor.chart.yAxisLabel2')}
              </span>
              <input
                type="text"
                data-axis-label="y2"
                value={block.data.yAxisLabel2 ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  const data = { ...block.data }
                  if (v === '') delete data.yAxisLabel2
                  else data.yAxisLabel2 = v
                  onChange({ ...block, data })
                }}
                className="w-full rounded border border-gray-300 px-1.5 py-0.5"
              />
            </label>
          )}
        </details>
      )}

      {/* P2 — 피팅 범위. showFit 가 켜져 있을 때만 노출. 두 값 모두 채워야
          실제로 적용되며 (xMin < xMax 검증), 한쪽이라도 비면 전체 점 회귀. */}
      {isXyLine && display.showFit && (
        <details data-section="fit-range" className="rounded border border-gray-200 bg-white p-2 text-xs">
          <summary className="cursor-pointer text-gray-700">{t('editor.chart.fitRange')}</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[10px] text-gray-500">
                {t('editor.chart.fitRange.xMin')}
              </span>
              <input
                type="number"
                data-fit-range="xMin"
                value={display.fitRange?.xMin === undefined ? '' : String(display.fitRange.xMin)}
                onChange={(e) => setFitRange('xMin', e.target.value)}
                className="w-full rounded border border-gray-300 px-1.5 py-0.5"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] text-gray-500">
                {t('editor.chart.fitRange.xMax')}
              </span>
              <input
                type="number"
                data-fit-range="xMax"
                value={display.fitRange?.xMax === undefined ? '' : String(display.fitRange.xMax)}
                onChange={(e) => setFitRange('xMax', e.target.value)}
                className="w-full rounded border border-gray-300 px-1.5 py-0.5"
              />
            </label>
          </div>
          {fitRangeInvalid && (
            <p role="alert" className="mt-1 text-[11px] text-red-600">
              {t('editor.chart.fitRange.invalid')}
            </p>
          )}
        </details>
      )}

      {/* P2 — 시리즈 정리 panel (E4). reorder + delete. */}
      {isXyLine && (
        <details data-section="series-panel" className="rounded border border-gray-200 bg-white p-2 text-xs">
          <summary className="cursor-pointer text-gray-700">{t('editor.chart.seriesPanel')}</summary>
          <div className="mt-2 space-y-1">
            {block.data.series.length === 0 ? (
              <p className="text-gray-500">{t('editor.chart.seriesPanel.empty')}</p>
            ) : (
              block.data.series.map((s, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="text-[10px] text-gray-500">{(s.points ?? []).length} pts</span>
                  {/* P3 — dual-y 가 켜져 있으면 L/R 라디오. 끄면 안 보임. */}
                  {dualYEnabled && (
                    <span
                      role="radiogroup"
                      aria-label={t('editor.chart.seriesPanel.axisLabel')}
                      className="inline-flex rounded border border-gray-300 bg-white text-[10px]"
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={(s.yAxisIndex ?? 0) === 0}
                        data-series-axis="L"
                        data-series-index={i}
                        onClick={() => setSeriesYAxis(i, 0)}
                        className={`px-1.5 py-0.5 ${
                          (s.yAxisIndex ?? 0) === 0
                            ? 'bg-smsg-700 text-white'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        L
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={s.yAxisIndex === 1}
                        data-series-axis="R"
                        data-series-index={i}
                        onClick={() => setSeriesYAxis(i, 1)}
                        className={`px-1.5 py-0.5 ${
                          s.yAxisIndex === 1
                            ? 'bg-smsg-700 text-white'
                            : 'text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        R
                      </button>
                    </span>
                  )}
                  <button
                    type="button"
                    data-series-action="up"
                    data-series-index={i}
                    aria-label={t('editor.chart.seriesPanel.up')}
                    disabled={i === 0}
                    onClick={() => moveSeries(i, -1)}
                    className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-700 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    data-series-action="down"
                    data-series-index={i}
                    aria-label={t('editor.chart.seriesPanel.down')}
                    disabled={i === block.data.series.length - 1}
                    onClick={() => moveSeries(i, 1)}
                    className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-gray-700 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    data-series-action="remove"
                    data-series-index={i}
                    aria-label={t('editor.chart.seriesPanel.remove')}
                    onClick={() => removeSeries(i)}
                    className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-red-600 hover:bg-red-50"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </details>
      )}

      {/* P3 — annotation panel. xy-line + annotations 가 1 개 이상일 때만 보임.
          (추가는 toolbar dropdown 으로만 가능 — 빈 상태로 panel 띄우는 건 잡음.) */}
      {isXyLine && (block.annotations?.length ?? 0) > 0 && (
        <details
          data-section="annotations-panel"
          className="rounded border border-gray-200 bg-white p-2 text-xs"
          open
        >
          <summary className="cursor-pointer text-gray-700">
            {t('editor.chart.annotation.panel')} ({block.annotations!.length})
          </summary>
          <div className="mt-2 space-y-1">
            {block.annotations!.map((a) => (
              <div
                key={a.id}
                data-annotation-id={a.id}
                className="flex flex-wrap items-center gap-1 rounded border border-gray-100 bg-gray-50 px-1.5 py-1"
              >
                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-700">
                  {a.kind}
                </span>
                <input
                  type="text"
                  data-annotation-field="label"
                  value={a.kind === 'marker' ? a.label : (a.label ?? '')}
                  onChange={(e) =>
                    updateAnnotation(a.id, { label: e.target.value } as Partial<ChartAnnotation>)
                  }
                  placeholder="label"
                  className="flex-1 min-w-[80px] rounded border border-gray-300 px-1.5 py-0.5"
                />
                {a.kind === 'marker' && (
                  <>
                    <input
                      type="number"
                      data-annotation-field="x"
                      value={a.x}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (!Number.isFinite(n)) return
                        updateAnnotation(a.id, { x: n } as Partial<ChartAnnotation>)
                      }}
                      className="w-16 rounded border border-gray-300 px-1.5 py-0.5"
                    />
                    <input
                      type="number"
                      data-annotation-field="y"
                      value={a.y}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (!Number.isFinite(n)) return
                        updateAnnotation(a.id, { y: n } as Partial<ChartAnnotation>)
                      }}
                      className="w-16 rounded border border-gray-300 px-1.5 py-0.5"
                    />
                  </>
                )}
                {a.kind === 'arrow' && (
                  <>
                    {(['fromX', 'fromY', 'toX', 'toY'] as const).map((k) => (
                      <input
                        key={k}
                        type="number"
                        data-annotation-field={k}
                        value={a[k]}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (!Number.isFinite(n)) return
                          updateAnnotation(a.id, { [k]: n } as Partial<ChartAnnotation>)
                        }}
                        className="w-14 rounded border border-gray-300 px-1.5 py-0.5"
                        title={k}
                      />
                    ))}
                  </>
                )}
                {a.kind === 'box' && (
                  <>
                    {(['xMin', 'xMax', 'yMin', 'yMax'] as const).map((k) => (
                      <input
                        key={k}
                        type="number"
                        data-annotation-field={k}
                        value={a[k]}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          if (!Number.isFinite(n)) return
                          updateAnnotation(a.id, { [k]: n } as Partial<ChartAnnotation>)
                        }}
                        className="w-14 rounded border border-gray-300 px-1.5 py-0.5"
                        title={k}
                      />
                    ))}
                  </>
                )}
                {/* 색 swatch — 5 개 고정. clear (= color undefined) 도 1 칸. */}
                <span className="inline-flex gap-0.5">
                  {(['', '#dc2626', '#2563eb', '#16a34a', '#f59e0b'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      data-annotation-color={c || 'none'}
                      onClick={() => {
                        const patch = c === '' ? { color: undefined } : { color: c }
                        updateAnnotation(a.id, patch as Partial<ChartAnnotation>)
                      }}
                      aria-label={c || 'none'}
                      className={`h-4 w-4 rounded border ${
                        (a.color ?? '') === c
                          ? 'border-gray-900'
                          : 'border-gray-300'
                      }`}
                      style={{
                        background: c || 'transparent',
                        backgroundImage:
                          c === ''
                            ? 'linear-gradient(45deg, transparent 45%, #ccc 45% 55%, transparent 55%)'
                            : undefined,
                      }}
                    />
                  ))}
                </span>
                <button
                  type="button"
                  data-annotation-action="remove"
                  data-annotation-id={a.id}
                  aria-label={t('editor.chart.annotation.remove')}
                  onClick={() => removeAnnotation(a.id)}
                  className="rounded border border-red-200 bg-white px-1.5 py-0.5 text-red-600 hover:bg-red-50"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* P2 — 통계 panel. showStats 토글이 켜진 경우에만 노출. */}
      {isXyLine && display.showStats && (
        <div data-section="stats-panel" className="overflow-x-auto rounded border border-gray-200 bg-white p-2 text-xs">
          {stats.length === 0 ? (
            <p className="text-gray-500">{t('editor.chart.stats.empty')}</p>
          ) : (
            <table className="w-full text-[11px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">{t('editor.chart.stats.col.series')}</th>
                  <th className="px-2 py-1 text-right font-semibold">{t('editor.chart.stats.col.n')}</th>
                  <th className="px-2 py-1 text-left font-semibold">{t('editor.chart.stats.col.xRange')}</th>
                  <th className="px-2 py-1 text-left font-semibold">{t('editor.chart.stats.col.yMean')}</th>
                  <th className="px-2 py-1 text-right font-semibold">{t('editor.chart.stats.col.slope')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((st, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-2 py-1">{st.name}</td>
                    <td className="px-2 py-1 text-right">{st.n}</td>
                    <td className="px-2 py-1">
                      [{formatStatNum(st.xMin)}, {formatStatNum(st.xMax)}]
                    </td>
                    <td className="px-2 py-1">
                      {formatStatNum(st.yMean)} ± {formatStatNum(st.yStd)}
                    </td>
                    <td className="px-2 py-1 text-right">{formatStatNum(st.slope)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="block">
          <span className="mb-1 block text-gray-600">{t('editor.chart.title')}</span>
          <input
            value={block.title ?? ''}
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            aria-label={t('editor.chart.title')}
            className="w-full rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-gray-600">{t('editor.chart.type')}</span>
          <select
            value={block.chartType}
            onChange={(e) =>
              onChange({ ...block, chartType: e.target.value as ChartBlock['chartType'] })
            }
            aria-label={t('editor.chart.type')}
            className="w-full rounded border border-gray-300 px-2 py-1"
          >
            {CHART_TYPES.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Engine picker — selects between the lightweight Recharts surface
          and the rich ECharts surface (zoom, brush, markPoint annotations,
          markArea regions). Switching is non-destructive: the data shape
          is identical so a chart can flip between engines without losing
          values. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-600">{t('editor.chart.engine')}:</span>
        <div className="inline-flex rounded border border-gray-300 bg-white p-0.5">
          <button
            type="button"
            onClick={() => onChange({ ...block, engine: 'recharts' })}
            aria-pressed={(block.engine ?? 'recharts') === 'recharts'}
            className={`rounded px-2 py-0.5 ${
              (block.engine ?? 'recharts') === 'recharts'
                ? 'bg-smsg-700 text-white'
                : 'text-gray-700 hover:bg-smsg-50'
            }`}
          >
            {t('editor.chart.engineRecharts')}
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...block, engine: 'echarts' })}
            aria-pressed={block.engine === 'echarts'}
            className={`rounded px-2 py-0.5 ${
              block.engine === 'echarts'
                ? 'bg-smsg-700 text-white'
                : 'text-gray-700 hover:bg-smsg-50'
            }`}
          >
            {t('editor.chart.engineEcharts')}
          </button>
        </div>
        {block.engine === 'echarts' && (
          <span className="text-amber-700">
            {t('editor.chart.echartsHint')}
          </span>
        )}
      </div>

      {block.engine === 'echarts' && (
        <InteractionsPanel block={block} onChange={onChange} />
      )}

      {/* Type previews — quick visual switcher. */}
      <div role="radiogroup" aria-label={t('editor.chart.typePreviewLabel')} className="flex flex-wrap gap-1">
        {CHART_TYPE_META.map((meta) => {
          const isOn = block.chartType === meta.type
          return (
            <button
              key={meta.type}
              type="button"
              role="radio"
              aria-checked={isOn}
              data-chart-thumb={meta.type}
              onClick={() => onChange({ ...block, chartType: meta.type })}
              className={`flex flex-col items-center rounded border px-2 py-1 text-[10px] transition-all ${
                isOn
                  ? 'border-smsg-500 bg-smsg-50 text-smsg-900'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-smsg-300'
              }`}
            >
              <span aria-hidden="true" className="text-[14px] leading-none">{meta.thumb}</span>
              <span>{t(meta.labelKey)}</span>
            </button>
          )
        })}
      </div>

      {/* xy-line 은 labels/values 가 아닌 series.points 기반 — 시리즈마다
          별도 (X, Y) 두 컬럼 미니 테이블. 다른 chartType 은 기존 labels +
          시리즈별 values 그리드. paste 가 자동으로 데이터를 넣어주므로 이
          편집 UI 는 검토/미세 조정용. */}
      {isXyLine ? (
        <div className="space-y-3">
          {block.data.series.length === 0 ? (
            <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-center text-xs text-gray-500">
              엑셀에서 두 컬럼 (또는 헤더 + 데이터) 을 복사해 차트 위에
              붙여넣으면 시리즈가 자동 추가됩니다.
            </div>
          ) : (
            block.data.series.map((s, sIdx) => (
              <div
                key={sIdx}
                className="overflow-x-auto rounded border border-gray-200 bg-white"
              >
                <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-2 py-1">
                  <input
                    value={s.name}
                    onChange={(e) => setSeriesName(sIdx, e.target.value)}
                    placeholder={`Series ${sIdx + 1}`}
                    className="flex-1 bg-transparent text-xs font-semibold outline-none"
                  />
                  <span className="text-[10px] text-gray-500">
                    {(s.points ?? []).length} pts
                  </span>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left font-semibold">x</th>
                      <th className="px-2 py-1 text-left font-semibold">y</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(s.points ?? []).map((p, pIdx) => (
                      <tr key={pIdx} className="border-t border-gray-100">
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={p.x}
                            onChange={(e) => {
                              const nx = Number(e.target.value)
                              if (!Number.isFinite(nx)) return
                              const points = (s.points ?? []).map((q, i) =>
                                i === pIdx ? { ...q, x: nx } : q,
                              )
                              const series = block.data.series.map((ss, i) =>
                                i === sIdx ? { ...ss, points } : ss,
                              )
                              onChange({ ...block, data: { ...block.data, series } })
                            }}
                            className="w-24 bg-transparent outline-none"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            value={p.y}
                            onChange={(e) => {
                              const ny = Number(e.target.value)
                              if (!Number.isFinite(ny)) return
                              const points = (s.points ?? []).map((q, i) =>
                                i === pIdx ? { ...q, y: ny } : q,
                              )
                              const series = block.data.series.map((ss, i) =>
                                i === sIdx ? { ...ss, points } : ss,
                              )
                              onChange({ ...block, data: { ...block.data, series } })
                            }}
                            className="w-24 bg-transparent outline-none"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-1 text-left font-semibold">label</th>
                {block.data.series.map((s, i) => (
                  <th key={i} className="px-2 py-1 text-left font-semibold">
                    <input
                      value={s.name}
                      onChange={(e) => setSeriesName(i, e.target.value)}
                      className="w-full bg-transparent outline-none"
                    />
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {block.data.labels.map((label, lIdx) => (
                <tr key={lIdx} className="border-t border-gray-100">
                  <td className="px-2 py-1">
                    <input
                      value={label}
                      onChange={(e) => setLabel(lIdx, e.target.value)}
                      className="w-full bg-transparent outline-none"
                    />
                  </td>
                  {block.data.series.map((s, sIdx) => (
                    <td key={sIdx} className="px-2 py-1">
                      <input
                        type="number"
                        value={s.values?.[lIdx] ?? 0}
                        onChange={(e) => setValue(sIdx, lIdx, e.target.value)}
                        className="w-20 bg-transparent outline-none"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-1">
                    <button
                      type="button"
                      aria-label={t('editor.chart.removeRow', { n: lIdx + 1 })}
                      onClick={() => removeRow(lIdx)}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-smsg-100"
        >
          {t('editor.chart.addRow')}
        </button>
        <button
          type="button"
          onClick={addSeries}
          className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-smsg-100"
        >
          {t('editor.chart.addSeries')}
        </button>
        <button
          type="button"
          onClick={convertFromTable}
          className="rounded border border-smsg-500 bg-white px-2 py-1 text-smsg-700 hover:bg-smsg-100"
        >
          {t('editor.chart.fromTable')}
        </button>
        <button
          type="button"
          onClick={seedSample}
          className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-smsg-100"
        >
          {t('editor.chart.useSample')}
        </button>
        {convertHint && (
          <span role="status" aria-live="polite" className="self-center text-[11px] text-gray-500">
            {convertHint}
          </span>
        )}
      </div>

      <details className="rounded border border-gray-200 bg-white p-2 text-xs" open>
        <summary className="cursor-pointer text-gray-600">{t('editor.chart.csvSection')}</summary>
        <div className="mt-2 space-y-2">
          <p className="rounded bg-gray-50 p-2 text-[11px] leading-relaxed text-gray-600">
            {t('editor.chart.csvHint')}
            <br />
            <span className="font-mono text-[10px] text-gray-500">
              월,매출,비용{'\n'}1월,120,80{'\n'}2월,150,90
            </span>
          </p>
          <textarea
            aria-label="csv-paste"
            rows={5}
            value={csvDraft}
            onChange={(e) => setCsvDraft(e.target.value)}
            placeholder={'월,매출,비용\n1월,120,80\n2월,150,90\n3월,180,110'}
            onPaste={onCsvPaste}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-[11px] focus:border-smsg-500 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onApplyClick}
              data-action="apply-csv"
              className="rounded bg-smsg-700 px-3 py-1 text-[11px] font-semibold text-white hover:bg-smsg-900 disabled:opacity-50"
            >
              {t('editor.chart.apply')}
            </button>
            <button
              type="button"
              onClick={onLoadExample}
              data-action="load-csv-example"
              className="rounded border border-gray-300 px-3 py-1 text-[11px] text-gray-700 hover:border-smsg-500 hover:text-smsg-900"
            >
              {t('editor.chart.loadExample')}
            </button>
            <button
              type="button"
              onClick={() => {
                setCsvDraft('')
                setConvertHint(null)
              }}
              className="rounded border border-gray-300 px-3 py-1 text-[11px] text-gray-500 hover:border-red-300 hover:text-red-600"
            >
              {t('editor.chart.clear')}
            </button>
          </div>
        </div>
      </details>

      <ChartBlockView block={block} />

      {/* P2 — PNG export 용 hidden EChartsView. ChartBlockView 는 engine
          분기 (recharts/echarts) 에 따라 다른 렌더러를 쓰는데, 사용자가
          recharts 엔진을 골라도 PNG 받을 때만큼은 ECharts 캔버스가 필요하다.
          off-screen 위치에 작게 그려두고 chartRef.getPng() 만 호출.
          xy-line 차트일 때만 마운트 (다른 chartType 은 export 가 의미 없음). */}
      {isXyLine && (
        <div
          aria-hidden="true"
          data-section="png-source"
          style={{
            position: 'absolute',
            left: '-99999px',
            top: 0,
            width: 600,
            height: 360,
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <EChartsView ref={chartRef} block={{ ...block, engine: 'echarts' }} />
        </div>
      )}
    </div>
  )
}

/** Walk the document tree and return the first table block, if any. */
function findFirstTable(
  doc: import('@/types/document').DocumentJSONV10 | null,
): TableBlock | null {
  if (!doc) return null
  for (const s1 of doc.sections) {
    const t = scanBlocks(s1.blocks)
    if (t) return t
    for (const s2 of s1.subsections ?? []) {
      const t2 = scanBlocks(s2.blocks)
      if (t2) return t2
      for (const s3 of s2.subsections ?? []) {
        const t3 = scanBlocks(s3.blocks)
        if (t3) return t3
      }
    }
  }
  return null
}

function scanBlocks(blocks: import('@/types/document').Block[]): TableBlock | null {
  for (const b of blocks) {
    if (b.type === 'table') return b
  }
  return null
}


/* ── Interactions panel (ECharts only) ──────────────────────────────────
   Surface for the friendly markPoint / markArea / dataZoom knobs that the
   schema captures under `interactions`. Power users still get the raw
   `options` escape hatch through the JSON textarea below. */
function InteractionsPanel({
  block,
  onChange,
}: {
  block: ChartBlock
  onChange: (next: ChartBlock) => void
}) {
  const interactions = block.interactions ?? {}
  const keyPoints = interactions.keyPoints ?? []
  const regions = interactions.regions ?? []
  const setI = (patch: Partial<NonNullable<ChartBlock['interactions']>>) => {
    const next = { ...interactions, ...patch }
    onChange({ ...block, interactions: next as ChartBlock['interactions'] })
  }
  const addKp = () => {
    const next = [...keyPoints, { label: 'Point', xIndex: 0 }]
    setI({ keyPoints: next as NonNullable<ChartBlock['interactions']>['keyPoints'] })
  }
  const removeKp = (idx: number) => {
    setI({
      keyPoints: keyPoints.filter((_, i) => i !== idx) as NonNullable<
        ChartBlock['interactions']
      >['keyPoints'],
    })
  }
  const updateKp = (
    idx: number,
    patch: Partial<NonNullable<NonNullable<ChartBlock['interactions']>['keyPoints']>[number]>,
  ) => {
    const next = keyPoints.map((kp, i) => (i === idx ? { ...kp, ...patch } : kp))
    setI({ keyPoints: next as NonNullable<ChartBlock['interactions']>['keyPoints'] })
  }
  const addRegion = () => {
    const next = [
      ...regions,
      { label: 'Region', xFromIndex: 0, xToIndex: 1 },
    ]
    setI({ regions: next as NonNullable<ChartBlock['interactions']>['regions'] })
  }
  const removeRegion = (idx: number) => {
    setI({
      regions: regions.filter((_, i) => i !== idx) as NonNullable<
        ChartBlock['interactions']
      >['regions'],
    })
  }
  const updateRegion = (
    idx: number,
    patch: Partial<NonNullable<NonNullable<ChartBlock['interactions']>['regions']>[number]>,
  ) => {
    const next = regions.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    setI({ regions: next as NonNullable<ChartBlock['interactions']>['regions'] })
  }
  return (
    <div className="space-y-2 rounded border border-amber-200 bg-amber-50/40 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!interactions.showZoom}
            onChange={(e) => setI({ showZoom: e.target.checked })}
          />
          줌 슬라이더
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!interactions.showCrosshair}
            onChange={(e) => setI({ showCrosshair: e.target.checked })}
          />
          크로스헤어
        </label>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-amber-900">키포인트 (markPoint)</span>
          <button
            type="button"
            onClick={addKp}
            className="rounded border border-amber-300 px-1.5 py-0.5 text-amber-900 hover:bg-amber-100"
          >
            + 추가
          </button>
        </div>
        {keyPoints.map((kp, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type="text"
              value={kp.label}
              onChange={(e) => updateKp(i, { label: e.target.value })}
              placeholder="라벨"
              className="flex-1 rounded border border-gray-300 px-1.5 py-0.5"
            />
            <input
              type="number"
              value={kp.xIndex}
              onChange={(e) => updateKp(i, { xIndex: Number(e.target.value) || 0 })}
              min={0}
              max={Math.max(0, (block.data.labels?.length ?? 1) - 1)}
              className="w-16 rounded border border-gray-300 px-1.5 py-0.5"
              title="x-축 라벨 인덱스"
            />
            <input
              type="color"
              value={kp.color ?? '#dc2626'}
              onChange={(e) => updateKp(i, { color: e.target.value })}
              className="h-6 w-8 rounded border border-gray-300"
            />
            <button
              type="button"
              onClick={() => removeKp(i)}
              aria-label="삭제"
              className="rounded px-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-amber-900">영역 하이라이트 (markArea)</span>
          <button
            type="button"
            onClick={addRegion}
            className="rounded border border-amber-300 px-1.5 py-0.5 text-amber-900 hover:bg-amber-100"
          >
            + 추가
          </button>
        </div>
        {regions.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              type="text"
              value={r.label}
              onChange={(e) => updateRegion(i, { label: e.target.value })}
              placeholder="라벨"
              className="flex-1 rounded border border-gray-300 px-1.5 py-0.5"
            />
            <input
              type="number"
              value={r.xFromIndex}
              onChange={(e) => updateRegion(i, { xFromIndex: Number(e.target.value) || 0 })}
              min={0}
              className="w-14 rounded border border-gray-300 px-1.5 py-0.5"
              title="시작 인덱스"
            />
            <span className="text-gray-400">~</span>
            <input
              type="number"
              value={r.xToIndex}
              onChange={(e) => updateRegion(i, { xToIndex: Number(e.target.value) || 0 })}
              min={0}
              className="w-14 rounded border border-gray-300 px-1.5 py-0.5"
              title="끝 인덱스 (포함)"
            />
            <input
              type="color"
              value={r.color ?? '#10b981'}
              onChange={(e) => updateRegion(i, { color: e.target.value })}
              className="h-6 w-8 rounded border border-gray-300"
            />
            <button
              type="button"
              onClick={() => removeRegion(i)}
              aria-label="삭제"
              className="rounded px-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

