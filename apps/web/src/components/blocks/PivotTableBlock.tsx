import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { WidgetExportMenu } from './WidgetExportMenu'
import { buildPivot, drillRows, dimField, dimLabel, sourceRows } from './pivotEngine'
import { fetchDataSource } from './DataSourceBlock'
import { Modal } from '@/components/ui/Modal'
import { useEditorStore } from '@/features/editor/state'
import type {
  Block,
  DataSourceBlock as DataSourceBlockType,
  PivotTableBlock,
} from '@/types/document'

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
/** Drill-down modal state — set when a data cell is clicked. */
interface DrillState {
  rowTuple: string[]
  colTuple: string[]
  rows: ReturnType<typeof sourceRows>
}

export function PivotTableBlockView({ block }: { block: PivotTableBlock }) {
  // Sprint 6 — when `source.kind === 'data-source'`, the pivot defers to a
  // sibling DataSourceBlock for raw rows. We resolve that block from the
  // editor draft (read-mode reuses the same store), fire the same
  // useQuery key as DataSourceBlockView so TanStack dedupes the request,
  // and inject the fetched rows into a synthetic clone that buildPivot
  // can consume unchanged.
  const hydrated = useHydratedPivotBlock(block)
  const result = useMemo(() => buildPivot(hydrated.block), [hydrated.block])
  const empty = block.options?.emptyCell ?? '-'
  const measures = block.values
  const showMeasureRow = measures.length > 1
  const colDimDepth = block.cols.length
  const rowDimDepth = block.rows.length
  const showRowTotals = !!block.totals?.row && !!result.rowTotals
  const showColTotals = !!block.totals?.col && !!result.colTotals
  const showGrandTotal = !!block.totals?.grand && !!result.grandTotals
  const [drill, setDrill] = useState<DrillState | null>(null)

  const openDrill = (rowTuple: string[], colTuple: string[]) => {
    const rows = drillRows(block, rowTuple, colTuple)
    setDrill({ rowTuple, colTuple, rows })
  }

  // csvText derived early — must be defined before any early return to keep
  // hook order stable across hydration state changes (rules of hooks).
  const csvText = useMemo(() => buildCsv(result, measures, empty), [result, measures, empty])

  if (hydrated.status === 'loading') {
    return (
      <div
        className="my-2 rounded border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300"
        data-block-type="pivot-table"
        data-pivot-source-state="loading"
      >
        Pivot Table · data-source 로딩 중…
      </div>
    )
  }
  if (hydrated.status === 'error') {
    return (
      <div
        className="my-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        data-block-type="pivot-table"
        data-pivot-source-state="error"
      >
        Pivot Table · data-source 오류: {hydrated.error}
      </div>
    )
  }

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
          source rows={sourceRows(block.source).length} · rows=[{block.rows.map(dimLabel).join(', ') || '∅'}] ·
          cols=[{block.cols.map(dimLabel).join(', ') || '∅'}] · values={measures.length}
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          데이터 또는 row/col 축이 비어있어 표가 없습니다.
        </p>
      </div>
    )
  }

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
                {showRowTotals && (
                  <th
                    colSpan={measures.length}
                    className="border-b border-l border-gray-200 bg-amber-50 px-2 py-1.5 text-center font-semibold text-amber-900 dark:border-gray-700 dark:bg-amber-900/30 dark:text-amber-100"
                    data-testid="pivot-total-col-header"
                  >
                    {colDimIdx === 0 ? 'Total' : ' '}
                  </th>
                )}
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
                      {measureDisplayLabel(m)}
                    </th>
                  )),
                )}
                {showRowTotals &&
                  measures.map((m, mi) => (
                    <th
                      key={`total-measure-${mi}`}
                      className="border-b border-l border-gray-200 bg-amber-50 px-2 py-1 text-center text-[11px] font-medium text-amber-800 dark:border-gray-700 dark:bg-amber-900/30 dark:text-amber-200"
                    >
                      {measureDisplayLabel(m)}
                    </th>
                  ))}
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
                    {measureDisplayLabel(m)}
                  </th>
                ))}
                {showRowTotals && (
                  <th
                    colSpan={measures.length}
                    className="border-b border-l border-gray-200 bg-amber-50 px-2 py-1.5 text-center font-semibold text-amber-900 dark:border-gray-700 dark:bg-amber-900/30 dark:text-amber-100"
                    data-testid="pivot-total-col-header"
                  >
                    Total
                  </th>
                )}
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
                {/* data cells — flatten [col][measure]; click → drill-down modal */}
                {result.values[ri]?.flatMap((cell, ci) =>
                  cell.map((v, mi) => {
                    const rowTuple = result.rowHeaders[ri] ?? []
                    const colTuple = result.colHeaders[ci] ?? []
                    return (
                      <td
                        key={`cell-${ri}-${ci}-${mi}`}
                        data-testid={`pivot-cell-${ri}-${ci}-${mi}`}
                        data-drill="cell"
                        role="button"
                        tabIndex={0}
                        title="Click to view raw rows"
                        onClick={() => openDrill(rowTuple, colTuple)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openDrill(rowTuple, colTuple)
                          }
                        }}
                        className="cursor-pointer border-l border-gray-100 px-2 py-1.5 text-right tabular-nums text-gray-800 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400 dark:border-gray-800 dark:text-gray-100 dark:hover:bg-blue-900/20"
                      >
                        {v === null ? (
                          <span className="text-gray-400 dark:text-gray-500">{empty}</span>
                        ) : (
                          formatNumber(v, measures[mi])
                        )}
                      </td>
                    )
                  }),
                )}
                {showRowTotals &&
                  result.rowTotals?.[ri]?.map((v, mi) => (
                    <td
                      key={`row-total-${ri}-${mi}`}
                      className="border-l border-gray-200 bg-amber-50 px-2 py-1.5 text-right font-semibold tabular-nums text-amber-900 dark:border-gray-700 dark:bg-amber-900/30 dark:text-amber-100"
                      data-testid={`pivot-row-total-${ri}-${mi}`}
                    >
                      {v === null ? (
                        <span className="text-amber-400 dark:text-amber-500/70">{empty}</span>
                      ) : (
                        formatNumber(v, measures[mi])
                      )}
                    </td>
                  ))}
              </tr>
            ))}
            {showColTotals && (
              <tr
                className="border-t-2 border-amber-300 dark:border-amber-700"
                data-testid="pivot-col-total-row"
              >
                <th
                  colSpan={rowDimDepth || 1}
                  scope="row"
                  className="sticky left-0 z-[1] border-r border-amber-300 bg-amber-50 px-2 py-1.5 text-left font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-100"
                >
                  Total
                </th>
                {result.colTotals?.flatMap((cell, ci) =>
                  cell.map((v, mi) => (
                    <td
                      key={`col-total-${ci}-${mi}`}
                      className="border-l border-amber-200 bg-amber-50 px-2 py-1.5 text-right font-semibold tabular-nums text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100"
                      data-testid={`pivot-col-total-${ci}-${mi}`}
                    >
                      {v === null ? (
                        <span className="text-amber-400 dark:text-amber-500/70">{empty}</span>
                      ) : (
                        formatNumber(v, measures[mi])
                      )}
                    </td>
                  )),
                )}
                {showGrandTotal &&
                  result.grandTotals?.map((v, mi) => (
                    <td
                      key={`grand-total-${mi}`}
                      className="border-l border-amber-300 bg-amber-100 px-2 py-1.5 text-right font-bold tabular-nums text-amber-900 dark:border-amber-700 dark:bg-amber-800/40 dark:text-amber-50"
                      data-testid={`pivot-grand-total-${mi}`}
                    >
                      {v === null ? (
                        <span className="text-amber-500 dark:text-amber-300/70">{empty}</span>
                      ) : (
                        formatNumber(v, measures[mi])
                      )}
                    </td>
                  ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {drill && (
        <PivotDrillModal
          block={block}
          drill={drill}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  )
}

/**
 * Drill-down modal — shows the raw rows that contributed to a single pivot
 * cell. Columns are the union of fields used by row/col dims + measure
 * sources + any other fields actually present in the rows (first-seen
 * order). Uses the shared `Modal` (Esc closes, backdrop click closes,
 * focus trap on first focusable child).
 *
 * Exported for testing — call sites use it through `PivotTableBlockView`
 * via the cell click handler.
 */
export function PivotDrillModal({
  block,
  drill,
  onClose,
}: {
  block: PivotTableBlock
  drill: DrillState
  onClose: () => void
}) {
  const fields = useMemo(() => collectDrillFields(block, drill.rows), [block, drill.rows])
  const headerLabel = buildDrillTitle(block, drill)
  return (
    <Modal open onClose={onClose} title={headerLabel} size="xl">
      <div data-testid="pivot-drill-modal" className="px-5 py-3">
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
          {drill.rows.length === 0
            ? '해당 셀에 속한 raw row 가 없습니다.'
            : `${drill.rows.length} row${drill.rows.length === 1 ? '' : 's'}`}
        </p>
        {drill.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {fields.map((f) => (
                    <th
                      key={`drill-h-${f}`}
                      className="border-b border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                    >
                      {f}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drill.rows.map((r, ri) => (
                  <tr
                    key={`drill-r-${ri}`}
                    className="border-b border-gray-100 dark:border-gray-800"
                  >
                    {fields.map((f) => {
                      const v = r[f]
                      return (
                        <td
                          key={`drill-c-${ri}-${f}`}
                          className="px-2 py-1 text-gray-800 dark:text-gray-100"
                        >
                          {v == null ? (
                            <span className="text-gray-400 dark:text-gray-500">-</span>
                          ) : (
                            String(v)
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}

function buildDrillTitle(block: PivotTableBlock, drill: DrillState): string {
  const rowPart = block.rows
    .map((d, i) => `${dimLabel(d)}=${drill.rowTuple[i] ?? ''}`)
    .join(' / ')
  const colPart = block.cols
    .map((d, i) => `${dimLabel(d)}=${drill.colTuple[i] ?? ''}`)
    .join(' / ')
  const parts = [rowPart, colPart].filter(Boolean)
  return parts.length > 0 ? `Drill-down · ${parts.join(' × ')}` : 'Drill-down'
}

/**
 * Determine which fields to show as columns in the drill table. Order:
 * row dims → col dims → measure sources (field only — `expr` skipped since
 * it's derived) → any extra fields present on rows (first-seen).
 */
function collectDrillFields(
  block: PivotTableBlock,
  rows: ReturnType<typeof sourceRows>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (f: string) => {
    if (!seen.has(f)) {
      seen.add(f)
      out.push(f)
    }
  }
  for (const d of block.rows) push(dimField(d))
  for (const d of block.cols) push(dimField(d))
  for (const m of block.values) {
    if (m.field) push(m.field)
  }
  for (const r of rows) {
    for (const k of Object.keys(r)) push(k)
  }
  return out
}

type Measure = PivotTableBlock['values'][number]

/**
 * Display label for one measure. Sprint 4 — falls back to `{AGG}({expr})`
 * when the measure is calculated-field; uses `{AGG}({field})` otherwise.
 * Honours explicit `label` first (matches engine's measureLabel for sort).
 */
function measureDisplayLabel(m: Measure): string {
  if (m.label) return m.label
  const source = m.expr ?? m.field ?? ''
  return `${m.agg.toUpperCase()}(${source})`
}

/**
 * Format a numeric cell. When `measure.numberFormat` is set we honour a small
 * Excel-style pattern subset; otherwise (default) up to 4 decimals with
 * trailing zeros stripped and comma thousands.
 *
 * Supported patterns (auto-detected from the string):
 *   - ends with '%'   → percent (multiply by 100); fraction-digits from the
 *                       count of '0' chars after the decimal point in pattern.
 *   - contains ','    → thousands grouping on.
 *   - count of '0' after the '.' → fixed minimum/maximum fraction digits.
 *   - no '.'          → 0 fraction digits.
 */
export function formatNumber(n: number, measure?: Measure): string {
  if (!Number.isFinite(n)) return String(n)
  const pattern = measure?.numberFormat
  if (pattern) return formatPattern(n, pattern)
  // Default — up to 4 decimals, trailing zeros stripped. Comma thousands.
  const rounded = Math.round(n * 1e4) / 1e4
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function formatPattern(n: number, pattern: string): string {
  const isPercent = pattern.trim().endsWith('%')
  const useGrouping = pattern.includes(',')
  const dotIdx = pattern.indexOf('.')
  let fracDigits = 0
  if (dotIdx >= 0) {
    // Count consecutive '0' after the '.', stopping at any non-0/non-# char.
    for (let i = dotIdx + 1; i < pattern.length; i++) {
      const c = pattern[i]
      if (c === '0' || c === '#') fracDigits++
      else break
    }
  }
  const value = isPercent ? n * 100 : n
  const body = value.toLocaleString(undefined, {
    minimumFractionDigits: fracDigits,
    maximumFractionDigits: fracDigits,
    useGrouping,
  })
  return isPercent ? `${body}%` : body
}

function buildCsv(
  result: ReturnType<typeof buildPivot>,
  measures: PivotTableBlock['values'],
  empty: string,
): string {
  const lines: string[] = []
  const headers: string[] = result.rowDims.map(dimLabel)
  for (const colTuple of result.colHeaders) {
    const colLabel = colTuple.join('/') || '_'
    for (const m of measures) {
      const measureLabel = measureDisplayLabel(m)
      headers.push(`${colLabel} | ${measureLabel}`)
    }
  }
  if (result.rowTotals) {
    for (const m of measures) {
      const measureLabel = measureDisplayLabel(m)
      headers.push(`Total | ${measureLabel}`)
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
    if (result.rowTotals) {
      for (const v of result.rowTotals[ri] ?? []) {
        cells.push(v === null ? empty : String(v))
      }
    }
    lines.push(cells.map(csvEscape).join(','))
  }
  if (result.colTotals) {
    const cells: string[] = ['Total']
    // pad row-dim cols beyond first
    for (let i = 1; i < (result.rowDims.length || 1); i++) cells.push('')
    for (const cell of result.colTotals) {
      for (const v of cell) {
        cells.push(v === null ? empty : String(v))
      }
    }
    if (result.grandTotals) {
      for (const v of result.grandTotals) {
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

// ── Sprint 6 — data-source hydration ────────────────────────────────────
type HydrationStatus = 'inline' | 'loading' | 'error' | 'ready'
interface HydrationResult {
  block: PivotTableBlock
  status: HydrationStatus
  error?: string
}

/**
 * Resolve a sibling DataSourceBlock by id from the current editor draft.
 * Returns null when the draft is unavailable (rare — read-only viewers
 * still mount the editor store) or the id is missing / not a DataSource.
 */
function findDataSourceBlock(
  draftSections: ReadonlyArray<{ blocks?: Array<Block> }>,
  id: string,
): DataSourceBlockType | null {
  for (const section of draftSections) {
    for (const b of section.blocks ?? []) {
      if (b.id === id && b.type === 'data-source') return b as DataSourceBlockType
    }
  }
  return null
}

/**
 * Coerce a DataSource payload into the flat `Record<field, value>[]` that
 * pivotEngine consumes. Two shapes accepted:
 *   - `{rows: [{...}]}` (already shaped like an array of objects)
 *   - `{headers: [...], rows: [[...]]}` (tabular — zip headers with cells)
 * Anything else → `[]` (caller renders empty state).
 */
export function payloadToRows(
  payload: unknown,
): Array<Record<string, string | number | null>> {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as Record<string, unknown>
  if (Array.isArray(p.rows) && p.rows.length > 0) {
    const first = p.rows[0]
    // Already flat objects.
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      return p.rows as Array<Record<string, string | number | null>>
    }
    // Tabular — combine with `headers`.
    if (Array.isArray(first) && Array.isArray(p.headers)) {
      const headers = p.headers as string[]
      return (p.rows as unknown[][]).map((row) => {
        const out: Record<string, string | number | null> = {}
        for (let i = 0; i < headers.length; i++) {
          const v = row[i]
          out[headers[i] ?? `col_${i}`] =
            typeof v === 'string' || typeof v === 'number' || v === null
              ? v
              : v == null
                ? null
                : String(v)
        }
        return out
      })
    }
  }
  return []
}

function useHydratedPivotBlock(block: PivotTableBlock): HydrationResult {
  const draft = useEditorStore((s) => s.draft)
  const inline = block.source?.kind !== 'data-source'

  const dataSourceBlock = useMemo(() => {
    if (inline) return null
    const id = (block.source as { dataSourceId?: string }).dataSourceId
    if (!id || !draft) return null
    return findDataSourceBlock(draft.sections ?? [], id)
  }, [inline, block.source, draft])

  const endpoint = dataSourceBlock?.endpoint ?? ''
  const params = dataSourceBlock?.params ?? null
  // Share the cache key with DataSourceBlockView — TanStack dedupes the
  // request so a doc with both a DataSource viewer AND a Pivot referencing
  // it fires the network call once.
  const { data, error, isLoading } = useQuery({
    queryKey: ['data-source', endpoint, JSON.stringify(params)],
    queryFn: () => fetchDataSource(endpoint, params),
    enabled: !inline && Boolean(endpoint),
    retry: false,
  })

  if (inline) return { block, status: 'inline' }
  if (!dataSourceBlock) {
    return { block, status: 'error', error: 'dataSourceId not found in document' }
  }
  if (isLoading) return { block, status: 'loading' }
  if (error) {
    return { block, status: 'error', error: (error as Error).message }
  }

  const rows = payloadToRows(data?.data ?? null)
  const hydrated: PivotTableBlock = {
    ...block,
    source: { kind: 'inline', rows },
  }
  return { block: hydrated, status: 'ready' }
}
