import { useMemo } from 'react'
import { WidgetExportMenu } from './WidgetExportMenu'
import { buildPivot } from './pivotEngine'
import type { PivotTableBlock } from '@/types/document'

/**
 * PivotTableBlock viewer — Sprint 1 real cross-tab.
 *
 * Layout: left-side row-tuple header cells (one column per rowDim) + top
 * col-tuple header cells (one row per colDim) + measure label row when
 * multiple measures. Empty bucket renders `options.emptyCell` (default '-').
 *
 * Widget export: CSV only (cycle 3 matrix — wraps with WidgetExportMenu).
 * Dark mode + horizontal scroll-fade (cycle 2 reuse).
 */
export function PivotTableBlockView({ block }: { block: PivotTableBlock }) {
  const result = useMemo(() => buildPivot(block), [block])
  const empty = block.options?.emptyCell ?? '-'
  const measures = block.values
  const showMeasureRow = measures.length > 1
  const colDimDepth = block.cols.length
  const rowDimDepth = block.rows.length

  const isEmpty = result.rowHeaders.length === 0 || result.colHeaders.length === 0

  if (isEmpty) {
    return (
      <div
        className="my-2 rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"
        data-block-type="pivot-table"
        data-export-root="pivot-table"
      >
        <p className="font-semibold">Pivot Table</p>
        <p className="mt-1">
          source rows={block.source.rows.length} · rows=[{block.rows.join(', ') || '∅'}] ·
          cols=[{block.cols.join(', ') || '∅'}] · values={measures.length}
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          데이터 또는 row/col 축이 비어있어 표가 없습니다.
        </p>
      </div>
    )
  }

  const csvText = useMemo(() => buildCsv(result, measures, empty), [result, measures, empty])

  return (
    <div className="group relative my-2" data-export-root="pivot-table">
      <WidgetExportMenu formats={['csv']} getCsv={() => csvText} filename="pivot-table" />
      <div className="scroll-fade-x overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 dark:bg-gray-800">
            {/* col-tuple header rows — one row per colDim */}
            {Array.from({ length: colDimDepth }).map((_, colDimIdx) => (
              <tr key={`coldim-${colDimIdx}`}>
                {/* top-left spacer — span row dim columns */}
                <th
                  colSpan={rowDimDepth || 1}
                  className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                >
                  {colDimIdx === 0 ? block.cols.join(' / ') || ' ' : ' '}
                </th>
                {result.colHeaders.map((tuple, ci) => (
                  <th
                    key={`coldim-${colDimIdx}-${ci}`}
                    colSpan={measures.length}
                    className="border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-center font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    {tuple[colDimIdx] ?? ''}
                  </th>
                ))}
              </tr>
            ))}
            {/* measure label row — only when >1 measure */}
            {showMeasureRow && (
              <tr>
                <th
                  colSpan={rowDimDepth || 1}
                  className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  {block.rows.join(' / ') || ' '}
                </th>
                {result.colHeaders.flatMap((_tuple, ci) =>
                  measures.map((m, mi) => (
                    <th
                      key={`measure-${ci}-${mi}`}
                      className="border-b border-l border-gray-200 bg-gray-50 px-2 py-1 text-center text-[11px] font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                      {m.label ?? `${m.agg.toUpperCase()}(${m.field})`}
                    </th>
                  )),
                )}
              </tr>
            )}
            {/* row-dim label row when no col dims & no measure row to take that slot */}
            {!showMeasureRow && colDimDepth === 0 && (
              <tr>
                <th
                  colSpan={rowDimDepth || 1}
                  className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5 text-left font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                >
                  {block.rows.join(' / ') || ' '}
                </th>
                {measures.map((m, mi) => (
                  <th
                    key={`m-only-${mi}`}
                    className="border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-center font-semibold text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                  >
                    {m.label ?? `${m.agg.toUpperCase()}(${m.field})`}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {result.rowHeaders.map((rowTuple, ri) => (
              <tr key={`row-${ri}`} className="border-b border-gray-100 dark:border-gray-800">
                {/* row-tuple header cells — one td per rowDim */}
                {(rowDimDepth > 0 ? rowTuple : ['']).map((part, di) => (
                  <th
                    key={`row-${ri}-dim-${di}`}
                    scope="row"
                    className="sticky left-0 z-[1] border-r border-gray-200 bg-white px-2 py-1.5 text-left font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  >
                    {part || ' '}
                  </th>
                ))}
                {/* data cells — flatten [col][measure] */}
                {result.values[ri]?.flatMap((cell, ci) =>
                  cell.map((v, mi) => (
                    <td
                      key={`cell-${ri}-${ci}-${mi}`}
                      className="border-l border-gray-100 px-2 py-1.5 text-right tabular-nums text-gray-800 dark:border-gray-800 dark:text-gray-100"
                    >
                      {v === null ? (
                        <span className="text-gray-400 dark:text-gray-500">{empty}</span>
                      ) : (
                        formatNumber(v)
                      )}
                    </td>
                  )),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  // Up to 4 decimals, trailing zeros stripped. Comma thousands.
  const rounded = Math.round(n * 1e4) / 1e4
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function buildCsv(
  result: ReturnType<typeof buildPivot>,
  measures: PivotTableBlock['values'],
  empty: string,
): string {
  const lines: string[] = []
  const headers: string[] = [...result.rowDims]
  for (const colTuple of result.colHeaders) {
    const colLabel = colTuple.join('/') || '_'
    for (const m of measures) {
      const measureLabel = m.label ?? `${m.agg.toUpperCase()}(${m.field})`
      headers.push(`${colLabel} | ${measureLabel}`)
    }
  }
  lines.push(headers.map(csvEscape).join(','))
  for (let ri = 0; ri < result.rowHeaders.length; ri++) {
    const rowTuple = result.rowHeaders[ri] ?? []
    const cells: string[] = [...rowTuple]
    const rowValues = result.values[ri] ?? []
    for (const cell of rowValues) {
      for (const v of cell) {
        cells.push(v === null ? empty : String(v))
      }
    }
    lines.push(cells.map(csvEscape).join(','))
  }
  return lines.join('\r\n')
}

function csvEscape(v: string): string {
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}
