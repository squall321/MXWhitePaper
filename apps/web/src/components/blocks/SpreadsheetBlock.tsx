import { useMemo } from 'react'
import type { SpreadsheetBlock } from '@/types/document'
import { evaluateAll, refOf } from '@/features/editor/blocks/spreadsheet/formulaEngine'
import { getZebraClass } from '@/features/editor/blocks/zebra'

/**
 * Read-mode renderer for the spreadsheet block. Computes every populated
 * cell once via `evaluateAll`, then paints a A..Z header row + numbered
 * left column + computed values. Strictly read-only — see
 * `SpreadsheetBlockEditor` for the interactive surface.
 */
export interface SpreadsheetBlockViewProps {
  block: SpreadsheetBlock
}

export function SpreadsheetBlockView({ block }: SpreadsheetBlockViewProps) {
  // JSON-schema regen types `additionalProperties: {type:string}` as
  // `{[k]: string | undefined}`; coerce to a defined-only Record so the
  // engine doesn't have to handle undefined values.
  const cells: Record<string, string> = {}
  for (const [k, v] of Object.entries(block.cells ?? {})) {
    if (typeof v === 'string') cells[k] = v
  }
  const cols = Math.min(26, Math.max(1, block.cols))
  const rows = Math.min(200, Math.max(1, block.rows))
  const computed = useMemo(() => evaluateAll(cells), [cells])
  const headers = block.headers ?? []

  return (
    <div
      data-spreadsheet-block
      data-block-id={block.id}
      className="scroll-fade-x my-3 overflow-x-auto rounded border border-gray-200 dark:border-gray-700"
    >
      {block.title && (
        <div className="border-b border-gray-200 bg-smsg-50 px-3 py-2 text-sm font-semibold text-smsg-900 dark:border-gray-700">
          {block.title}
        </div>
      )}
      <table className="w-full border-collapse text-left text-xs">
        <thead className="text-gray-600 dark:text-gray-400">
          <tr>
            {/* Top-left corner: freeze both top + left, highest z-index. */}
            <th className="sticky top-0 left-0 z-20 w-10 border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800 text-center font-medium" />
            {Array.from({ length: cols }).map((_, c) => {
              const letter = String.fromCharCode(65 + c)
              const label = headers[c] ?? letter
              return (
                <th
                  key={c}
                  scope="col"
                  className="sticky top-0 z-10 min-w-[80px] border border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800 font-medium"
                >
                  {label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => {
            // Zebra is applied at the row level so every cell in the same
            // row stays consistent — mirrors editor SpreadsheetBlockEditor.
            const zebra = getZebraClass('spreadsheet', block.options, r)
            return (
              <tr key={r} className={zebra}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1 text-center font-medium text-gray-500 dark:border-gray-700 dark:bg-gray-800"
                >
                  {r + 1}
                </th>
                {Array.from({ length: cols }).map((_, c) => {
                  const ref = refOf(c, r)
                  const result = computed[ref]
                  let display: string
                  // zebra가 켜진 행에서는 bg 를 row 가 칠하므로 cell 의
                  // bg-white 가 그것을 덮지 않게 분기.
                  const base = zebra
                    ? 'border border-gray-100 px-2 py-1 align-top text-gray-800 dark:border-gray-800 dark:text-gray-200'
                    : 'border border-gray-100 bg-white px-2 py-1 align-top text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200'
                  let cls = base
                  if (result?.error) {
                    display = result.error
                    cls += ' text-red-600 font-mono'
                  } else if (result == null || result.value === '') {
                    display = ''
                  } else {
                    display = String(result.value)
                    if (typeof result.value === 'number') cls += ' text-right tabular-nums'
                  }
                  return (
                    <td key={c} data-cell-ref={ref} className={cls}>
                      {display}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
