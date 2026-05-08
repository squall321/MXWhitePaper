import { useState } from 'react'
import type { ChartBlock, TableBlock } from '@/types/document'
import { ChartBlockView } from '@/components/blocks/ChartBlock'
import { useEditorStore } from '@/features/editor/state'

interface ChartBlockEditorProps {
  block: ChartBlock
  onChange: (next: ChartBlock) => void
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
      const values = [...s.values]
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
    const series = block.data.series.map((s) => ({ ...s, values: [...s.values, 0] }))
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
      values: s.values.filter((_, i) => i !== idx),
    }))
    onChange({ ...block, data: { ...block.data, labels, series } })
  }

  const convertFromTable = () => {
    const table = findFirstTable(draft)
    if (!table) {
      setConvertHint('변환 가능한 표가 없습니다.')
      return
    }
    const next = tableToChartData(table)
    onChange({ ...block, data: next })
    setConvertHint(`${table.headers.length - 1}개 시리즈 변환됨`)
  }

  return (
    <div className="space-y-3 rounded border border-smsg-100 bg-smsg-100/40 p-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="block">
          <span className="mb-1 block text-gray-600">제목</span>
          <input
            value={block.title ?? ''}
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            className="w-full rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-gray-600">차트 종류</span>
          <select
            value={block.chartType}
            onChange={(e) =>
              onChange({ ...block, chartType: e.target.value as ChartBlock['chartType'] })
            }
            className="w-full rounded border border-gray-300 px-2 py-1"
          >
            {CHART_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
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
                      value={s.values[lIdx] ?? 0}
                      onChange={(e) => setValue(sIdx, lIdx, e.target.value)}
                      className="w-20 bg-transparent outline-none"
                    />
                  </td>
                ))}
                <td className="px-2 py-1">
                  <button
                    type="button"
                    aria-label={`row ${lIdx + 1} remove`}
                    onClick={() => removeRow(lIdx)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    ×
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
          + 행
        </button>
        <button
          type="button"
          onClick={addSeries}
          className="rounded border border-gray-300 bg-white px-2 py-1 hover:bg-smsg-100"
        >
          + 시리즈
        </button>
        <button
          type="button"
          onClick={convertFromTable}
          className="rounded border border-smsg-500 bg-white px-2 py-1 text-smsg-700 hover:bg-smsg-100"
        >
          표 → 차트 변환
        </button>
        {convertHint && (
          <span className="self-center text-[11px] text-gray-500">{convertHint}</span>
        )}
      </div>

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
    for (const s2 of s1.subsections) {
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

/** First column = labels; remaining columns = series. Non-numeric cells → 0. */
function tableToChartData(table: TableBlock): ChartBlock['data'] {
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
