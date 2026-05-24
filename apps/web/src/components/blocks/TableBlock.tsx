import { Fragment, useMemo, useState } from 'react'
import type { TableBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'
import { useEditorStore, editorSelectors } from '@/features/editor/state'
import { Modal } from '@/components/ui/Modal'
import { ChartBlockEditor } from '@/features/editor/blocks/ChartBlockEditor'
import { buildChartFromTable } from '@/features/editor/tableToChart'
import { insertBlock, isPreconditionFailed } from '@/features/editor/api'
import { findParentSection } from '@/features/editor/findSection'
import {
  alignClass,
  borderClass,
  densityCellClass,
  effectiveAlign,
  formatCellByDtype,
  parseNumericForAggregate,
  resolveColumn,
  rowAggregate,
  type ColumnSpec,
} from './tableFormat'

type SparseCell = NonNullable<TableBlock['cells']>[number]

type SortState = { col: number; dir: 'asc' | 'desc' } | null

/**
 * Render a sparse cell's content. Mixed-content cells (with `blocks`) lay
 * out paragraph/image/list inline; plain cells fall back to the existing
 * inline-markup renderer. Restricted to the three block types allowed by
 * the `CellBlock` union — anything else is silently skipped.
 */
function renderCellContent(cell: SparseCell) {
  if (cell.blocks && cell.blocks.length > 0) {
    return (
      <div className="cell-blocks space-y-1">
        {cell.blocks.map((b, idx) => {
          if (b.type === 'paragraph') return <p key={idx}>{b.text}</p>
          if (b.type === 'image')
            return (
              <img
                key={idx}
                src={`/api/v1/images/${b.imageId}/view`}
                alt={b.alt ?? ''}
                className="h-auto max-w-full"
              />
            )
          if (b.type === 'list') {
            const Tag = b.style === 'number' ? 'ol' : 'ul'
            return (
              <Tag key={idx} className="ml-4">
                {b.items.map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </Tag>
            )
          }
          return null
        })}
      </div>
    )
  }
  return <Inline text={cell.text ?? ''} />
}

/**
 * Compose Tailwind classes for a single body/header cell, accounting for
 * column defaults (align/dtype) and per-cell sparse overrides (align/bg/
 * bold/color). Returns both className and inline style — `style` is only
 * present when a hex color is set, since Tailwind can't express arbitrary
 * user-picked colors.
 */
function cellClass(
  col: ColumnSpec | undefined,
  cell: { align?: 'left' | 'center' | 'right'; bold?: boolean } | undefined,
  density: 'compact' | 'normal' | 'comfortable',
  border: 'none' | 'horizontal' | 'all',
  isHeader: boolean,
): string {
  const align = effectiveAlign(col, cell?.align)
  return [
    densityCellClass(density),
    alignClass(align),
    borderClass(border),
    cell?.bold || isHeader ? 'font-semibold' : '',
    isHeader ? 'text-smsg-900' : 'text-gray-800',
  ]
    .filter(Boolean)
    .join(' ')
}

function cellStyle(
  bg?: string,
  color?: string,
): React.CSSProperties | undefined {
  if (!bg && !color) return undefined
  const out: React.CSSProperties = {}
  if (bg) out.backgroundColor = bg
  if (color) out.color = color
  return out
}

interface FlatViewProps {
  block: TableBlock
  density: 'compact' | 'normal' | 'comfortable'
  border: 'none' | 'horizontal' | 'all'
  stripe: boolean
  stickyFirstCol: boolean
  rowNumbers: boolean
  columns: ColumnSpec[]
  // Filtered + sorted rows. Each row also carries its original index for
  // looking up unsorted data when needed (e.g. footer aggregates always
  // operate on the unfiltered set).
  visibleRows: { row: string[]; origIndex: number }[]
  sortState: SortState
  onSort: (col: number) => void
  sortable: boolean
}

/**
 * Render a flat table — the common case. Column defaults drive alignment
 * and number formatting; the per-cell sparse style fields are not used in
 * flat mode (the editor auto-converts to sparse when the user picks a
 * cell-level style).
 */
function FlatTableBody({
  block,
  density,
  border,
  stripe,
  stickyFirstCol,
  rowNumbers,
  columns,
  visibleRows,
  sortState,
  onSort,
  sortable,
}: FlatViewProps) {
  const headers = block.headers
  return (
    <>
      <thead className="sticky top-0 z-content bg-smsg-50 text-smsg-900">
        <tr>
          {rowNumbers && (
            <th
              scope="col"
              className={`${densityCellClass(density)} ${borderClass(border)} w-10 text-right text-xs text-gray-500`}
            >
              #
            </th>
          )}
          {headers.map((h, i) => {
            const col = columns[i]
            const cls = cellClass(col, undefined, density, border, true)
            const isSorted = sortState?.col === i
            const sortGlyph = !sortable
              ? ''
              : isSorted
                ? sortState.dir === 'asc'
                  ? ' ▲'
                  : ' ▼'
                : ' ⇅'
            return (
              <th
                key={i}
                scope="col"
                className={`${cls} ${stickyFirstCol && i === 0 ? 'sticky left-0 z-content bg-smsg-50' : ''} ${sortable ? 'cursor-pointer select-none hover:bg-smsg-100' : ''} whitespace-nowrap`}
                style={col?.width ? { width: col.width } : undefined}
                onClick={sortable ? () => onSort(i) : undefined}
                aria-sort={
                  sortable
                    ? isSorted
                      ? sortState.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                    : undefined
                }
              >
                {h}
                {sortable && (
                  <span aria-hidden="true" className="ml-1 text-[10px] text-gray-400">
                    {sortGlyph.trim()}
                  </span>
                )}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {visibleRows.map(({ row, origIndex }, rIdx) => (
          <tr
            key={origIndex}
            className={`${stripe ? 'odd:bg-white even:bg-gray-50 dark:odd:bg-gray-900 dark:even:bg-gray-800' : 'bg-white dark:bg-gray-900'} transition-colors hover:bg-smsg-50/50 dark:hover:bg-gray-700/50`}
          >
            {rowNumbers && (
              <td
                className={`${densityCellClass(density)} ${borderClass(border)} text-right text-xs text-gray-500`}
              >
                {rIdx + 1}
              </td>
            )}
            {row.map((cell, c) => {
              const col = columns[c]
              const formatted = formatCellByDtype(cell, col)
              const cls = cellClass(col, undefined, density, border, false)
              return (
                <td
                  key={c}
                  className={`${cls} align-top ${stickyFirstCol && c === 0 ? 'sticky left-0 z-content bg-inherit' : ''}`}
                >
                  {col?.dtype && col.dtype !== 'text' && col.dtype !== 'date' ? (
                    <span>{formatted}</span>
                  ) : (
                    <Inline text={formatted} />
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </>
  )
}

/**
 * Render the sparse `cells` shape — used for tables with merged cells OR
 * any per-cell style overrides. Sortable / searchable / footer don't apply
 * here (merged-cell semantics make column-wise ops ambiguous).
 */
function SparseTableBody({
  cells,
  columns,
  density,
  border,
  stripe,
}: {
  cells: SparseCell[]
  columns: ColumnSpec[]
  density: 'compact' | 'normal' | 'comfortable'
  border: 'none' | 'horizontal' | 'all'
  stripe: boolean
}) {
  const byRow = new Map<number, SparseCell[]>()
  for (const cell of cells) {
    const list = byRow.get(cell.r) ?? []
    list.push(cell)
    byRow.set(cell.r, list)
  }
  for (const list of byRow.values()) list.sort((a, b) => a.c - b.c)
  const rowKeys = [...byRow.keys()].sort((a, b) => a - b)
  const isHeaderRow = (r: number) =>
    (byRow.get(r) ?? []).length > 0 &&
    (byRow.get(r) ?? []).every((c) => c.header === true)
  const headerRows = rowKeys.filter(isHeaderRow)
  const bodyRows = rowKeys.filter((r) => !isHeaderRow(r))

  return (
    <>
      {headerRows.length > 0 && (
        <thead className="sticky top-0 z-content bg-smsg-50 text-smsg-900">
          {headerRows.map((r) => (
            <tr key={r}>
              {(byRow.get(r) ?? []).map((cell, i) => {
                const col = columns[cell.c]
                const cls = cellClass(col, cell, density, border, true)
                return (
                  <th
                    key={i}
                    scope="col"
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan}
                    className={`${cls} whitespace-nowrap`}
                    style={cellStyle(cell.bg, cell.color)}
                  >
                    {renderCellContent(cell)}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
      )}
      <tbody>
        {bodyRows.map((r, idx) => (
          <Fragment key={r}>
            <tr
              className={
                stripe
                  ? idx % 2 === 0
                    ? 'bg-white dark:bg-gray-900'
                    : 'bg-gray-50 dark:bg-gray-800'
                  : 'bg-white dark:bg-gray-900'
              }
            >
              {(byRow.get(r) ?? []).map((cell, i) => {
                const col = columns[cell.c]
                const formatted = formatCellByDtype(cell.text ?? '', col)
                const cls = cellClass(col, cell, density, border, false)
                return (
                  <td
                    key={i}
                    colSpan={cell.colSpan}
                    rowSpan={cell.rowSpan}
                    className={`${cls} align-top`}
                    style={cellStyle(cell.bg, cell.color)}
                  >
                    {cell.blocks ? (
                      renderCellContent(cell)
                    ) : col?.dtype && col.dtype !== 'text' && col.dtype !== 'date' ? (
                      <span>{formatted}</span>
                    ) : (
                      <Inline text={formatted} />
                    )}
                  </td>
                )
              })}
            </tr>
          </Fragment>
        ))}
      </tbody>
    </>
  )
}

/**
 * Table block — sticky header, zebra rows, horizontal scroll on small
 * screens. Supports rich column metadata (width / align / dtype / format)
 * and per-cell style overrides in sparse mode.
 *
 * Interactive options (flat mode only):
 *   - `options.searchable` adds a search box that filters rows.
 *   - `options.sortable`   makes header clicks toggle asc/desc.
 *   - `footer.show`        renders a per-column aggregate row.
 *
 * In full-edit mode a hover affordance ("📊 차트로") opens a modal
 * prefilled with the table's data converted to chart series.
 */
export function TableBlockView({ block }: { block: TableBlock }) {
  const isFullEditing = useEditorStore(editorSelectors.isFullEditing)
  const slug = useEditorStore((s) => s.slug)
  const etag = useEditorStore((s) => s.etag)
  const draft = useEditorStore((s) => s.draft)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [modalOpen, setModalOpen] = useState(false)
  const [pending, setPending] = useState(() => buildChartFromTable(block))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortState, setSortState] = useState<SortState>(null)

  const opts = block.options ?? {}
  const density = (opts.density ?? 'normal') as
    | 'compact'
    | 'normal'
    | 'comfortable'
  const border = (opts.borderStyle ?? 'horizontal') as
    | 'none'
    | 'horizontal'
    | 'all'
  const stripe = opts.stripe !== false
  const stickyFirstCol = !!opts.stickyFirstCol
  const rowNumbers = !!opts.rowNumbers
  const searchable = !!opts.searchable
  const sortable = !!opts.sortable

  const isSparse = !!(block.cells && block.cells.length > 0)
  const colCount = isSparse
    ? Math.max(
        0,
        ...((block.cells ?? []).map((c) => c.c + (c.colSpan ?? 1))),
      )
    : block.headers.length
  const columns: ColumnSpec[] = useMemo(() => {
    const out: ColumnSpec[] = []
    for (let i = 0; i < colCount; i++) {
      out.push(resolveColumn(block.columns?.[i]))
    }
    return out
  }, [block.columns, colCount])

  // Search + sort apply only to flat mode (sparse rows have merge spans
  // that filtering would break visually).
  const indexedRows = useMemo(
    () => block.rows.map((row, origIndex) => ({ row, origIndex })),
    [block.rows],
  )
  const filteredRows = useMemo(() => {
    if (!searchable || !query.trim()) return indexedRows
    const needle = query.trim().toLowerCase()
    return indexedRows.filter(({ row }) =>
      row.some((cell) => cell.toLowerCase().includes(needle)),
    )
  }, [indexedRows, query, searchable])
  const sortedRows = useMemo(() => {
    if (!sortable || !sortState) return filteredRows
    const { col, dir } = sortState
    const dtype = columns[col]?.dtype
    const numeric = dtype === 'number' || dtype === 'percent' || dtype === 'currency'
    const arr = [...filteredRows]
    arr.sort((a, b) => {
      const av = a.row[col] ?? ''
      const bv = b.row[col] ?? ''
      if (numeric) {
        const an = parseNumericForAggregate(av)
        const bn = parseNumericForAggregate(bv)
        const aHas = an != null
        const bHas = bn != null
        if (!aHas && !bHas) return 0
        if (!aHas) return 1 // empty rows sink
        if (!bHas) return -1
        return dir === 'asc' ? (an as number) - (bn as number) : (bn as number) - (an as number)
      }
      return dir === 'asc'
        ? av.localeCompare(bv, 'ko')
        : bv.localeCompare(av, 'ko')
    })
    return arr
  }, [filteredRows, sortState, sortable, columns])

  const onSort = (col: number) => {
    setSortState((prev) => {
      if (!prev || prev.col !== col) return { col, dir: 'asc' }
      if (prev.dir === 'asc') return { col, dir: 'desc' }
      return null // third click resets
    })
  }

  const footer = block.footer
  const footerRow = useMemo(() => {
    if (isSparse) return null
    if (!footer?.show) return null
    const aggs = footer.aggregates ?? []
    return columns.map((col, c) => {
      const kind = aggs[c]
      if (!kind) return null
      const values = block.rows.map((row) => row[c] ?? '')
      return rowAggregate(values, kind, col)
    })
  }, [block.rows, columns, footer, isSparse])

  const openModal = () => {
    setPending(buildChartFromTable(block))
    setError(null)
    setModalOpen(true)
  }

  const onInsert = async () => {
    if (!slug || !etag) return
    setBusy(true)
    setError(null)
    try {
      const parent = findParentSection(draft, block.id)
      const sectionId = parent?.id ?? draft?.sections[0]?.id
      if (!sectionId) throw new Error('대상 섹션을 찾지 못했습니다.')
      const result = await insertBlock(
        slug,
        { section_id: sectionId, block: pending },
        etag,
        '표 → 차트 삽입',
      )
      apply(result.document, result.etag)
      setModalOpen(false)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('충돌 — 새로고침 필요')
      } else {
        setError((err as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="group relative">
      {searchable && !isSparse && (
        <div className="mb-2 flex items-center gap-2 text-xs">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="표 안에서 검색…"
            aria-label="표 행 검색"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
          />
          {query && (
            <span className="whitespace-nowrap text-gray-500">
              {sortedRows.length}/{indexedRows.length}건
            </span>
          )}
        </div>
      )}

      {/* `max-h-[60vh]` 로 자체 스크롤 컨테이너를 만들어서 sticky thead 가 표
          컨테이너 안에서만 부착되도록 한다. */}
      <div data-no-swipe className="max-h-[60vh] overflow-x-auto overflow-y-auto rounded-md border border-gray-200 shadow-sm dark:border-gray-700">
        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
          {isSparse ? (
            <SparseTableBody
              cells={block.cells ?? []}
              columns={columns}
              density={density}
              border={border}
              stripe={stripe}
            />
          ) : (
            <FlatTableBody
              block={block}
              density={density}
              border={border}
              stripe={stripe}
              stickyFirstCol={stickyFirstCol}
              rowNumbers={rowNumbers}
              columns={columns}
              visibleRows={sortedRows}
              sortState={sortState}
              onSort={onSort}
              sortable={sortable}
            />
          )}
          {footerRow && !isSparse && (
            <tfoot className="border-t-2 border-smsg-200 bg-smsg-50/60 text-smsg-900">
              <tr>
                {rowNumbers && (
                  <td
                    className={`${densityCellClass(density)} ${borderClass(border)}`}
                  />
                )}
                {footerRow.map((value, c) => {
                  const col = columns[c]
                  const cls = cellClass(col, undefined, density, border, false)
                  const isLabelCell = c === 0 && value == null && footer?.label
                  return (
                    <td
                      key={c}
                      className={`${cls} font-semibold ${stickyFirstCol && c === 0 ? 'sticky left-0 z-content bg-smsg-50' : ''}`}
                    >
                      {isLabelCell ? footer.label : (value ?? '')}
                    </td>
                  )
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {isFullEditing && slug && (
        <button
          type="button"
          aria-label="표를 차트로 변환"
          data-table-to-chart
          onClick={openModal}
          className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full border border-smsg-200 bg-white/95 px-2 py-1 text-[11px] font-medium text-smsg-700 opacity-0 shadow-sm transition-opacity duration-base hover:bg-smsg-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-gray-800/95"
        >
          <span aria-hidden>📊</span>
          <span>차트로</span>
        </button>
      )}

      {modalOpen && (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="표 → 차트"
          size="full"
          footer={
            <div className="flex items-center justify-end gap-2">
              {error && (
                <span className="mr-auto rounded bg-red-50 px-2 py-1 text-xs text-red-700">
                  {error}
                </span>
              )}
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={busy}
                className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void onInsert()}
                disabled={busy}
                data-action="insert-chart"
                className="rounded bg-smsg-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-smsg-900 disabled:opacity-60"
              >
                {busy ? '추가 중…' : '차트 삽입'}
              </button>
            </div>
          }
        >
          <div className="p-4">
            <ChartBlockEditor block={pending} onChange={setPending} />
          </div>
        </Modal>
      )}
    </div>
  )
}
