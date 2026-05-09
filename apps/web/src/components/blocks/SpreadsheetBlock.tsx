import { useMemo } from 'react'
import type { SpreadsheetBlock } from '@/types/document'
import { evaluateAll, refOf } from '@/features/editor/blocks/spreadsheet/formulaEngine'

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
      className="my-3 overflow-x-auto rounded border border-gray-200"
    >
      {block.title && (
        <div className="border-b border-gray-200 bg-smsg-50 px-3 py-2 text-sm font-semibold text-smsg-900">
          {block.title}
        </div>
      )}
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-gray-50 text-gray-600">
          <tr>
            <th className="w-10 border border-gray-200 px-2 py-1 text-center font-medium" />
            {Array.from({ length: cols }).map((_, c) => {
              const letter = String.fromCharCode(65 + c)
              const label = headers[c] ?? letter
              return (
                <th
                  key={c}
                  scope="col"
                  className="min-w-[80px] border border-gray-200 px-2 py-1 font-medium"
                >
                  {label}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              <th
                scope="row"
                className="border border-gray-200 bg-gray-50 px-2 py-1 text-center font-medium text-gray-500"
              >
                {r + 1}
              </th>
              {Array.from({ length: cols }).map((_, c) => {
                const ref = refOf(c, r)
                const result = computed[ref]
                let display: string
                let cls = 'border border-gray-100 px-2 py-1 align-top text-gray-800'
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
          ))}
        </tbody>
      </table>
    </div>
  )
}
