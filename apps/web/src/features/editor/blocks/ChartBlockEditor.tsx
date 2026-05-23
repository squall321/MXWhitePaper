import { useState } from 'react'
import type { ChartBlock, TableBlock } from '@/types/document'
import { ChartBlockView } from '@/components/blocks/ChartBlock'
import { useEditorStore } from '@/features/editor/state'
import { parseCsv } from '@/features/editor/extensions/csv-paste'
import { tableToChartData } from '@/features/editor/tableToChart'
import { useT } from '@/lib/i18n'
import { parseChartPaste, type ChartPasteResult } from './_chartPaste'

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
    },
  }
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
  // input/textarea/contentEditable 이 target 이면 가로채지 않는다 (셀 편집 우선).
  const onWrapperPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null
    if (target) {
      const tag = (target.tagName ?? '').toLowerCase()
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        target.isContentEditable
      ) {
        return
      }
    }
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    const parsed = parseChartPaste(text)
    if (!parsed) return // non-csv: 기본 paste 동작 유지 (preventDefault 안 함)
    e.preventDefault()
    onChange(applyChartPasteToBlock(block, parsed))
    setConvertHint(
      t('editor.chart.csvApplied', {
        rows: parsed.series[0]?.points.length ?? 0,
        cols: parsed.series.length,
      }),
    )
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

  return (
    <div
      className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3"
      onPaste={onWrapperPaste}
    >
      {block.chartType === 'xy-line' && (
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
          <button
            type="button"
            aria-pressed={!!display.showFit}
            data-toolbar="fit"
            onClick={() => setDisplay({ showFit: !display.showFit })}
            className={`rounded border px-2 py-0.5 ${
              display.showFit
                ? 'border-smsg-500 bg-smsg-50 text-smsg-900'
                : 'border-gray-300 bg-white text-gray-600'
            }`}
          >
            {t('editor.chart.fitLinear')}
          </button>
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

