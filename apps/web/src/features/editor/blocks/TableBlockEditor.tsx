import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { CellBlock, TableBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { BoundSlicersPicker } from './PivotTableBlockEditor'
import { useT } from '@/lib/i18n'
import {
  cellsToFlat,
  csOf,
  demoteToText,
  demoteWouldLoseData,
  findNeighbor,
  flatToCells,
  isAllUnitCells,
  mergeWith,
  promoteToBlocks,
  rsOf,
  splitMerge,
  type SparseCell,
} from './tableCells'
import { CellBlockEditor } from './CellBlockEditor'
import { TableOptionsPanel } from './TableOptionsPanel'
import { ConditionalFormattingPresetsPanel } from './ConditionalFormattingPresetsPanel'
import { ColumnHeaderMenu } from './ColumnHeaderMenu'
import { CellStyleToolbar } from './CellStyleToolbar'
import { ColumnResizer } from './ColumnResizer'
import { getZebraClass } from './zebra'
import {
  applyTabularPasteToFlat,
  looksLikeTabular,
  parseTabular,
} from './tsvPaste'

type ColumnEntry = NonNullable<TableBlock['columns']>[number]

/**
 * Patch a single column entry into `block.columns`, padding the array out
 * to `colCount` so column-N edits don't accidentally shift later columns.
 */
function patchColumn(
  block: TableBlock,
  colCount: number,
  c: number,
  next: ColumnEntry,
): TableBlock {
  const cur = block.columns ?? []
  const out: ColumnEntry[] = []
  for (let i = 0; i < colCount; i++) out.push(cur[i] ?? {})
  out[c] = next
  // Drop trailing empty entries to keep the JSON tidy.
  while (out.length > 0 && isEmptyColumn(out[out.length - 1])) out.pop()
  return { ...block, columns: out.length > 0 ? out : undefined }
}

function isEmptyColumn(e: ColumnEntry | undefined): boolean {
  if (!e) return true
  return !e.width && !e.align && !e.dtype && !e.format
}

interface Props {
  slug: Slug
  block: TableBlock
}

/**
 * TableBlockEditor — Word-style spreadsheet UX for `table` blocks.
 *
 *   - Header / data cells edit inline (click → focus → type).
 *   - Add / remove row + column buttons sit in the toolbar.
 *   - Row up / down move buttons live on each row hover.
 *   - All edits debounce-save via `patchBlock` (800 ms idle).
 *
 * Scope notes:
 *   - We intentionally don't touch `<TableBlockView>` — its hover-only
 *     "차트로" CTA still works on the read view, and full-edit goes through
 *     this editor instead.
 *   - The schema requires `headers: string[]` and `rows: string[][]` — we
 *     keep both arrays in lockstep so a row never has more cells than the
 *     header row.
 */
export function TableBlockEditor({ slug, block }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  // Local working copy. `block` is the source-of-truth from the doc store
  // and rewinds local edits when the server snapshot changes.
  const [local, setLocal] = useState<TableBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  // Sync down-stream when the server snapshot replaces the block (e.g.
  // because someone else saved). We compare by id so unrelated re-renders
  // don't clobber the user's in-flight edits.
  useEffect(() => {
    setLocal(block)
  }, [block])

  const schedule = (next: TableBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: TableBlock) => {
    if (!etag) return
    try {
      // Send cells when present so the BE keeps the merge layout, otherwise
      // legacy headers/rows. Sending `cells: null` explicitly clears the
      // field — used by the "표 평탄화" action.
      const patchBody: Record<string, unknown> = {
        headers: next.headers,
        rows: next.rows,
      }
      if (next.cells) patchBody.cells = next.cells
      else if (block.cells) patchBody.cells = null
      // Send the new structured fields whenever they're present OR when the
      // user has just cleared one (we need to send `null` so the BE drops the
      // field rather than keeping the stale value).
      if (next.columns) patchBody.columns = next.columns
      else if (block.columns) patchBody.columns = null
      if (next.footer) patchBody.footer = next.footer
      else if (block.footer) patchBody.footer = null
      if (next.options) patchBody.options = next.options
      else if (block.options) patchBody.options = null
      const result = await patchBlock(
        slug,
        block.id,
        patchBody as Partial<TableBlock>,
        etag,
        t('editor.table.changeLog'),
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError(t('editor.common.conflict'))
      } else {
        setError((err as Error).message)
      }
    }
  }

  // Cancel pending debounce on unmount so we don't fire after teardown.
  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const setHeader = (col: number, value: string) => {
    const headers = local.headers.map((h, i) => (i === col ? value : h))
    schedule({ ...local, headers })
  }
  const setCell = (row: number, col: number, value: string) => {
    const rows = local.rows.map((r, i) =>
      i === row ? r.map((c, j) => (j === col ? value : c)) : r,
    )
    schedule({ ...local, rows })
  }
  const addRow = () => {
    const rows = [...local.rows, local.headers.map(() => '')]
    schedule({ ...local, rows })
  }
  const removeRow = (idx: number) => {
    if (local.rows.length === 0) return
    const rows = local.rows.filter((_, i) => i !== idx)
    schedule({ ...local, rows })
  }
  const moveRow = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= local.rows.length) return
    const rows = [...local.rows]
    const [r] = rows.splice(idx, 1)
    if (!r) return
    rows.splice(target, 0, r)
    schedule({ ...local, rows })
  }
  const addColumn = () => {
    const headers = [
      ...local.headers,
      t('editor.table.newColumnName', { n: local.headers.length + 1 }),
    ]
    const rows = local.rows.map((r) => [...r, ''])
    schedule({ ...local, headers, rows })
  }
  const removeColumn = (idx: number) => {
    if (local.headers.length <= 1) return
    const headers = local.headers.filter((_, i) => i !== idx)
    const rows = local.rows.map((r) => r.filter((_, i) => i !== idx))
    schedule({ ...local, headers, rows })
  }

  /**
   * Resize the flat table to exactly `nRows × nCols`. Existing data inside
   * the new bounds is preserved; cells outside are dropped (truncate); new
   * cells are filled with empty strings (pad). Headers receive auto-named
   * placeholders ("열 N") for columns added beyond the current header count.
   */
  const resizeFlat = (nRows: number, nCols: number) => {
    const cols = Math.max(1, Math.min(50, Math.floor(nCols)))
    const rows = Math.max(0, Math.min(500, Math.floor(nRows)))
    const headers: string[] = []
    for (let c = 0; c < cols; c++) {
      headers.push(
        local.headers[c] ?? t('editor.table.newColumnName', { n: c + 1 }),
      )
    }
    const nextRows: string[][] = []
    for (let r = 0; r < rows; r++) {
      const src = local.rows[r] ?? []
      const row: string[] = []
      for (let c = 0; c < cols; c++) row.push(src[c] ?? '')
      nextRows.push(row)
    }
    schedule({ ...local, headers, rows: nextRows })
  }

  // ── Cells (merged) mode ──────────────────────────────────────────────
  // Tables imported from DOCX with merged cells, or any flat table the
  // user has already merged into, land here. The editor renders the
  // sparse layout faithfully, lets the user edit each cell's text in
  // place, and exposes a small hover menu on every cell with merge /
  // split / split-into-grid actions powered by `tableCells.ts`.
  if (local.cells && local.cells.length > 0) {
    const cells = local.cells
    // Compute the column count for the sparse table — needed by the column
    // header menu and the options panel's footer-aggregate row.
    const sparseColCount = cells.reduce(
      (max, c) => Math.max(max, c.c + csOf(c)),
      0,
    )
    const setCellText = (idx: number, value: string) => {
      const next = cells.map((cell, i) => (i === idx ? { ...cell, text: value } : cell))
      schedule({ ...local, cells: next })
    }
    const setCellStyle = (idx: number, patch: Partial<SparseCell>) => {
      const next = cells.map((cell, i) => {
        if (i !== idx) return cell
        const merged = { ...cell, ...patch }
        // Drop falsy style fields so the JSON stays minimal — the schema
        // expects either a real value or no key at all.
        if (merged.bg === undefined) delete merged.bg
        if (merged.color === undefined) delete merged.color
        if (merged.bold === undefined) delete merged.bold
        if (merged.align === undefined) delete merged.align
        return merged
      })
      schedule({ ...local, cells: next })
    }
    // Mixed-content writes from <CellBlockEditor>. When the user empties
    // the blocks array we flip back to a text cell (text='') so the cell
    // stays well-formed (schema requires exactly one of text / blocks).
    const setCellBlocks = (idx: number, blocks: CellBlock[]) => {
      const next = cells.map((cell, i) => {
        if (i !== idx) return cell
        if (blocks.length === 0) {
          const { blocks: _b, ...rest } = cell
          void _b
          return { ...rest, text: '' }
        }
        const { text: _t, ...rest } = cell
        void _t
        return { ...rest, blocks: blocks as NonNullable<SparseCell['blocks']> }
      })
      schedule({ ...local, cells: next })
    }
    // Per-cell toggle between text and blocks modes. Demoting a cell that
    // contains an image asks the user to confirm because the image ref is
    // lost (text demote drops image blocks).
    const toggleCellMode = (idx: number) => {
      const target = cells[idx]
      if (!target) return
      let nextCell: SparseCell
      if (target.blocks && target.blocks.length > 0) {
        if (demoteWouldLoseData(target)) {
          if (!window.confirm('이 셀의 이미지가 사라집니다. 진행할까요?')) return
        }
        nextCell = demoteToText(target)
      } else {
        nextCell = promoteToBlocks(target)
      }
      const next = cells.map((c, i) => (i === idx ? nextCell : c))
      schedule({ ...local, cells: next })
    }
    const onMerge = (anchor: SparseCell, side: 'left' | 'right' | 'up' | 'down') => {
      const next = mergeWith(cells, anchor, side)
      if (!next) return // no neighbour available
      schedule({ ...local, cells: next })
    }
    const onSplit = (anchor: SparseCell) => {
      const next = splitMerge(cells, anchor)
      // If every cell is back to 1×1, drop to the simpler flat representation
      // so the user gets the row/col add/remove toolbar back. Otherwise
      // stay in cells mode.
      if (isAllUnitCells(next)) {
        const { headers, rows } = cellsToFlat(next)
        schedule({ ...local, headers, rows, cells: undefined })
      } else {
        schedule({ ...local, cells: next })
      }
    }
    const flatten = () => {
      const { headers, rows } = cellsToFlat(cells)
      schedule({ ...local, headers, rows, cells: undefined })
    }

    // Group cells by row for ordered rendering.
    const cellsByRow = new Map<number, { cell: SparseCell; idx: number }[]>()
    cells.forEach((cell, idx) => {
      const list = cellsByRow.get(cell.r) ?? []
      list.push({ cell, idx })
      cellsByRow.set(cell.r, list)
    })
    for (const list of cellsByRow.values()) list.sort((a, b) => a.cell.c - b.cell.c)
    const rowKeys = [...cellsByRow.keys()].sort((a, b) => a - b)
    const isHeaderRow = (r: number) => {
      const list = cellsByRow.get(r) ?? []
      return list.length > 0 && list.every((entry) => entry.cell.header === true)
    }

    return (
      <div data-table-block-editor data-block-id={block.id} className="my-3 space-y-2">
        <div className="overflow-x-auto rounded border border-smsg-100 bg-white shadow-sm">
          <table className="w-full min-w-[480px] border-collapse text-left text-sm">
            <tbody>
              {(() => {
                let bodyCounter = 0
                return rowKeys.map((r, rIdx) => {
                const rowEntries = cellsByRow.get(r) ?? []
                const Tag = isHeaderRow(r) ? 'th' : 'td'
                // TBL-01 — viewer 의 SparseTableBody 는 bodyRows (header 제외)
                // 에서만 idx 를 세서 zebra phase 를 정한다. 이전 구현은
                // header 포함 rIdx 를 그대로 넘겨 header 행 수에 따라
                // editor 와 viewer 의 zebra 가 한 칸씩 어긋났다. 별도
                // bodyCounter 로 viewer 와 동일하게 indexing.
                const zebra = isHeaderRow(r)
                  ? ''
                  : getZebraClass('table', local.options, bodyCounter++)
                const rowCls = isHeaderRow(r)
                  ? 'bg-smsg-50 text-smsg-900'
                  : `bg-white ${zebra}`
                return (
                  <Fragment key={r}>
                    <tr className={rowCls}>
                      {rowEntries.map(({ cell, idx }) => (
                        <Tag
                          key={idx}
                          colSpan={cell.colSpan}
                          rowSpan={cell.rowSpan}
                          className={`group/cell relative border-b border-gray-100 px-1 py-0.5 align-top ${
                            isHeaderRow(r) ? 'font-semibold border-smsg-100' : ''
                          }`}
                          scope={isHeaderRow(r) ? 'col' : undefined}
                        >
                          {cell.blocks && cell.blocks.length > 0 ? (
                            <CellBlockEditor
                              blocks={cell.blocks}
                              onChange={(next) => setCellBlocks(idx, next)}
                            />
                          ) : (
                            <input
                              type="text"
                              value={cell.text ?? ''}
                              onChange={(e) => setCellText(idx, e.target.value)}
                              aria-label={t('editor.table.cellLabel', { r: cell.r + 1, c: cell.c + 1 })}
                              className={`w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none ${
                                isHeaderRow(r) ? 'font-semibold text-smsg-900' : ''
                              }`}
                            />
                          )}
                          {(csOf(cell) > 1 || rsOf(cell) > 1) && (
                            <span
                              aria-hidden="true"
                              className="ml-1 text-[10px] text-gray-400"
                              title={t('editor.table.mergedHint', {
                                rs: rsOf(cell),
                                cs: csOf(cell),
                              })}
                            >
                              ⛶
                            </span>
                          )}
                          <CellActions
                            cell={cell}
                            cells={cells}
                            onMerge={onMerge}
                            onSplit={onSplit}
                            onStyle={(patch) => setCellStyle(idx, patch)}
                            onToggleMode={() => toggleCellMode(idx)}
                            t={t}
                          />
                        </Tag>
                      ))}
                    </tr>
                  </Fragment>
                )
              })
              })()}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-amber-50 px-2 py-1 text-amber-800">
            {t('editor.table.mergedNotice')}
          </span>
          <button
            type="button"
            onClick={flatten}
            data-action="flatten-table"
            className="rounded border border-dashed border-amber-300 px-2 py-1 text-amber-800 hover:bg-amber-100"
          >
            {t('editor.table.flatten')}
          </button>
          {error && <span role="status" aria-live="polite" className="text-red-600">{error}</span>}
        </div>

        {/* Per-column metadata + table-level options also apply to sparse mode.
            Footer aggregates are rendered only in flat mode (the renderer
            skips them for sparse layouts), but the rest is fair game. */}
        {sparseColCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-gray-500">열 옵션:</span>
            {Array.from({ length: sparseColCount }).map((_, c) => (
              <span key={c} className="inline-flex items-center gap-1 rounded border border-gray-200 px-1">
                <span className="text-[11px] text-gray-500">{c + 1}열</span>
                <ColumnHeaderMenu
                  column={local.columns?.[c]}
                  onChange={(next) => schedule(patchColumn(local, sparseColCount, c, next))}
                />
              </span>
            ))}
          </div>
        )}
        <TableOptionsPanel
          block={local}
          colCount={sparseColCount}
          onChange={(patch) => schedule({ ...local, ...patch })}
        />
        <ConditionalFormattingPresetsPanel
          block={local}
          // Sparse mode lifts header text from cells flagged `header: true`
          // so the column picker mirrors the visible header row.
          headerNames={(() => {
            const names: string[] = []
            for (let c = 0; c < sparseColCount; c++) names.push('')
            for (const cell of cells) {
              if (cell.header && typeof cell.text === 'string') {
                names[cell.c] = cell.text
              }
            }
            return names
          })()}
          onChange={(patch) => schedule({ ...local, ...patch })}
        />
        <TableSourcePanel
          block={local}
          onChange={(next) => schedule(next)}
        />
        <BoundSlicersPicker
          block={local}
          onChange={(next) => schedule(next)}
          testIdPrefix="table-bound-slicer"
        />
      </div>
    )
  }

  // Helper used by the flat-mode hover menu — converts the current legacy
  // shape to cells and applies the merge in one step.
  const beginMergeFromFlat = (
    fromR: number,
    fromC: number,
    side: 'left' | 'right' | 'up' | 'down',
  ) => {
    const cells = flatToCells(local.headers, local.rows)
    const anchor = cells.find((c) => c.r === fromR && c.c === fromC)
    if (!anchor) return
    const next = mergeWith(cells, anchor, side)
    if (!next) return
    schedule({ ...local, cells: next })
  }

  /**
   * Apply a cell-style override (align/bg/bold/color) to a flat-mode cell.
   * Cell-level styling is only representable in sparse mode (the schema
   * keeps `headers` + `rows` as plain strings), so the first paint
   * promotes the entire table to `cells`. Subsequent edits stay in sparse
   * mode; the user can collapse back via "표 평탄화" later.
   *
   * `(fromR, fromC)` uses cells-mode coords: row 0 is the header row,
   * row 1+ are body rows. So callers pass `r + 1` for body cells.
   */
  const applyCellStyleFromFlat = (
    fromR: number,
    fromC: number,
    patch: Partial<SparseCell>,
  ) => {
    const cells = flatToCells(local.headers, local.rows)
    const idx = cells.findIndex((c) => c.r === fromR && c.c === fromC)
    if (idx < 0) return
    const target = cells[idx]
    if (!target) return
    const merged: SparseCell = { ...target, ...patch }
    if (merged.bg === undefined) delete merged.bg
    if (merged.color === undefined) delete merged.color
    if (merged.bold === undefined) delete merged.bold
    if (merged.align === undefined) delete merged.align
    const next = cells.map((c, i) => (i === idx ? merged : c))
    schedule({ ...local, cells: next })
  }

  return (
    <div data-table-block-editor data-block-id={block.id} className="my-3 space-y-2">
      <div className="overflow-x-auto rounded border border-smsg-100 bg-white shadow-sm">
        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
          <thead className="bg-smsg-50 text-smsg-900">
            <tr>
              <th className="w-8 border-b border-smsg-100" aria-hidden />
              {local.headers.map((h, c) => (
                <ResizableHeaderCell
                  key={c}
                  index={c}
                  header={h}
                  width={local.columns?.[c]?.width}
                  totalCols={local.headers.length}
                  setHeader={setHeader}
                  setColumn={(next) =>
                    schedule(patchColumn(local, local.headers.length, c, next))
                  }
                  removeColumn={removeColumn}
                  setWidthPx={(px) =>
                    schedule(
                      patchColumn(local, local.headers.length, c, {
                        ...(local.columns?.[c] ?? {}),
                        width: `${Math.round(px)}px`,
                      }),
                    )
                  }
                  column={local.columns?.[c]}
                  t={t}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {local.rows.map((row, r) => (
              <tr
                key={r}
                className={`group/row bg-white ${getZebraClass('table', local.options, r)}`}
              >
                <td className="border-b border-gray-100 px-1 align-top text-[10px] text-gray-400">
                  <div className="flex flex-col items-center gap-0.5 py-1 opacity-0 transition-opacity group-hover/row:opacity-100">
                    <button
                      type="button"
                      aria-label={t('editor.table.moveRowUp', { n: r + 1 })}
                      onClick={() => moveRow(r, -1)}
                      disabled={r === 0}
                      className="rounded px-1 hover:bg-smsg-100 disabled:opacity-30"
                    >
                      <span aria-hidden="true">▲</span>
                    </button>
                    <button
                      type="button"
                      aria-label={t('editor.table.moveRowDown', { n: r + 1 })}
                      onClick={() => moveRow(r, 1)}
                      disabled={r === local.rows.length - 1}
                      className="rounded px-1 hover:bg-smsg-100 disabled:opacity-30"
                    >
                      <span aria-hidden="true">▼</span>
                    </button>
                    <button
                      type="button"
                      aria-label={t('editor.table.removeRow', { n: r + 1 })}
                      onClick={() => removeRow(r)}
                      className="rounded px-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <span aria-hidden="true">✕</span>
                    </button>
                  </div>
                </td>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="group/cell relative border-b border-gray-100 px-1 py-0.5 align-top"
                  >
                    <input
                      type="text"
                      value={cell}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onPaste={(e) => {
                        const text = e.clipboardData.getData('text/plain')
                        if (!looksLikeTabular(text)) return
                        e.preventDefault()
                        const parsed = parseTabular(text)
                        const { headers, rows } = applyTabularPasteToFlat(
                          local,
                          r,
                          c,
                          parsed,
                        )
                        schedule({ ...local, headers, rows })
                      }}
                      aria-label={t('editor.table.cellLabel', { r: r + 1, c: c + 1 })}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
                    />
                    <FlatCellActions
                      r={r + 1}
                      c={c}
                      maxR={local.rows.length}
                      maxC={local.headers.length}
                      onMerge={(side) => beginMergeFromFlat(r + 1, c, side)}
                      onStyle={(patch) => applyCellStyleFromFlat(r + 1, c, patch)}
                      t={t}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={addRow}
          className="rounded border border-dashed border-smsg-300 px-2 py-1 text-smsg-700 hover:bg-smsg-100"
        >
          {t('editor.table.addRow')}
        </button>
        <button
          type="button"
          onClick={addColumn}
          className="rounded border border-dashed border-smsg-300 px-2 py-1 text-smsg-700 hover:bg-smsg-100"
        >
          {t('editor.table.addColumn')}
        </button>
        <SizeInput
          rows={local.rows.length}
          cols={local.headers.length}
          onApply={resizeFlat}
        />
        {error && <span role="status" aria-live="polite" className="text-red-600">{error}</span>}
      </div>

      <TableOptionsPanel
        block={local}
        colCount={local.headers.length}
        onChange={(patch) => schedule({ ...local, ...patch })}
      />
      <ConditionalFormattingPresetsPanel
        block={local}
        headerNames={local.headers}
        onChange={(patch) => schedule({ ...local, ...patch })}
      />
      <TableSourcePanel
        block={local}
        onChange={(next) => schedule(next)}
      />
      <BoundSlicersPicker
        block={local}
        onChange={(next) => schedule(next)}
        testIdPrefix="table-bound-slicer"
      />
    </div>
  )
}

/**
 * Hover menu rendered inside each cell of a *cells-mode* table. Surfaces
 * four merge directions and a split action; each action gets disabled
 * automatically when it doesn't make sense (no neighbour / cell already
 * 1×1). The menu sits absolutely-positioned in the cell's top-right
 * corner and only fades in while the cell is hovered/focused so it
 * doesn't compete with the cell's text input.
 */
function CellActions({
  cell,
  cells,
  onMerge,
  onSplit,
  onStyle,
  onToggleMode,
  t,
}: {
  cell: SparseCell
  cells: readonly SparseCell[]
  onMerge: (cell: SparseCell, side: 'left' | 'right' | 'up' | 'down') => void
  onSplit: (cell: SparseCell) => void
  onStyle: (patch: Partial<SparseCell>) => void
  onToggleMode: () => void
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  const canLeft = !!findNeighbor(cells, cell, 'left')
  const canRight = !!findNeighbor(cells, cell, 'right')
  const canUp = !!findNeighbor(cells, cell, 'up')
  const canDown = !!findNeighbor(cells, cell, 'down')
  const canSplit = csOf(cell) > 1 || rsOf(cell) > 1
  const isBlocksMode = !!(cell.blocks && cell.blocks.length > 0)
  return (
    <div
      data-cell-actions
      className="pointer-events-none absolute right-0 top-0 z-20 hidden gap-0.5 rounded border border-gray-200 bg-white/95 p-0.5 shadow-sm group-hover/cell:flex group-focus-within/cell:flex"
    >
      <ArrowBtn
        label={t('editor.table.mergeLeft')}
        glyph="◀"
        disabled={!canLeft}
        onClick={() => onMerge(cell, 'left')}
      />
      <ArrowBtn
        label={t('editor.table.mergeRight')}
        glyph="▶"
        disabled={!canRight}
        onClick={() => onMerge(cell, 'right')}
      />
      <ArrowBtn
        label={t('editor.table.mergeUp')}
        glyph="▲"
        disabled={!canUp}
        onClick={() => onMerge(cell, 'up')}
      />
      <ArrowBtn
        label={t('editor.table.mergeDown')}
        glyph="▼"
        disabled={!canDown}
        onClick={() => onMerge(cell, 'down')}
      />
      <ArrowBtn
        label={t('editor.table.split')}
        glyph="⊟"
        disabled={!canSplit}
        onClick={() => onSplit(cell)}
      />
      <button
        type="button"
        onClick={onToggleMode}
        title={isBlocksMode ? '텍스트로 변환' : '풍부한 편집으로'}
        aria-label={isBlocksMode ? '텍스트로 변환' : '풍부한 편집으로'}
        className="pointer-events-auto text-xs px-1 hover:bg-gray-100 rounded"
      >
        {isBlocksMode ? '¶' : '¶+'}
      </button>
      <CellStyleToolbar cell={cell} onChange={onStyle} />
    </div>
  )
}

/**
 * Hover menu for *flat-mode* cells. Behaviour is identical to
 * `CellActions` but adjacency is computed from the simple `(r, c)` grid:
 * a cell can merge left if `c > 0`, right if `c < maxC - 1`, etc. The
 * first merge converts the table into cells mode under the hood.
 */
function FlatCellActions({
  r,
  c,
  maxR,
  maxC,
  onMerge,
  onStyle,
  t,
}: {
  r: number
  c: number
  maxR: number
  maxC: number
  onMerge: (side: 'left' | 'right' | 'up' | 'down') => void
  /** Apply a per-cell style — promotes the table to sparse mode on first use. */
  onStyle: (patch: Partial<SparseCell>) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  return (
    <div
      data-cell-actions
      className="pointer-events-none absolute right-0 top-0 z-20 hidden gap-0.5 rounded border border-gray-200 bg-white/95 p-0.5 shadow-sm group-hover/cell:flex group-focus-within/cell:flex"
    >
      <ArrowBtn
        label={t('editor.table.mergeLeft')}
        glyph="◀"
        disabled={c === 0}
        onClick={() => onMerge('left')}
      />
      <ArrowBtn
        label={t('editor.table.mergeRight')}
        glyph="▶"
        disabled={c >= maxC - 1}
        onClick={() => onMerge('right')}
      />
      <ArrowBtn
        label={t('editor.table.mergeUp')}
        glyph="▲"
        disabled={r === 0}
        onClick={() => onMerge('up')}
      />
      <ArrowBtn
        label={t('editor.table.mergeDown')}
        glyph="▼"
        disabled={r >= maxR}
        onClick={() => onMerge('down')}
      />
      {/* Cell-level style. The first style action auto-promotes the
          table to sparse mode under the hood (see applyCellStyleFromFlat). */}
      <CellStyleToolbar
        cell={{ r: 0, c: 0, text: '' }}
        onChange={onStyle}
      />
    </div>
  )
}

/**
 * One column header cell with: title input + ⋮ column-options menu +
 * remove button + drag-resize grip on the right edge. Lives in its own
 * component so the resize handle can read `getBoundingClientRect` off the
 * cell ref without leaking refs to the editor's main render path.
 */
function ResizableHeaderCell({
  index,
  header,
  width,
  totalCols,
  column,
  setHeader,
  setColumn,
  removeColumn,
  setWidthPx,
  t,
}: {
  index: number
  header: string
  width: string | undefined
  totalCols: number
  column: NonNullable<TableBlock['columns']>[number] | undefined
  setHeader: (col: number, value: string) => void
  setColumn: (next: NonNullable<TableBlock['columns']>[number]) => void
  removeColumn: (col: number) => void
  setWidthPx: (px: number) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  const thRef = useRef<HTMLTableCellElement | null>(null)
  return (
    <th
      ref={thRef}
      className="group/col relative border-b border-smsg-100 px-2 py-1 font-semibold"
      scope="col"
      style={width ? { width } : undefined}
    >
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={header}
          onChange={(e) => setHeader(index, e.target.value)}
          aria-label={t('editor.table.headerLabel', { n: index + 1 })}
          className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-smsg-900 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
        />
        <ColumnHeaderMenu column={column} onChange={setColumn} />
      </div>
      <button
        type="button"
        aria-label={t('editor.table.removeColumn', { n: index + 1 })}
        onClick={() => removeColumn(index)}
        disabled={totalCols <= 1}
        className="absolute right-2 top-0 hidden rounded px-1 text-[10px] text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 group-hover/col:block"
      >
        <span aria-hidden="true">✕</span>
      </button>
      <ColumnResizer
        col={index}
        getCurrentWidth={() => thRef.current?.getBoundingClientRect().width ?? 100}
        onResize={setWidthPx}
      />
    </th>
  )
}

/**
 * Compact "행 × 열" input shown in the table editor toolbar. Applies a
 * resize on Enter or button click; the inputs accept any positive integer
 * up to a sane cap (rows ≤ 500, cols ≤ 50). Empty / invalid input is
 * silently ignored so the user can mid-type without losing focus.
 */
function SizeInput({
  rows,
  cols,
  onApply,
}: {
  rows: number
  cols: number
  onApply: (rows: number, cols: number) => void
}) {
  const [r, setR] = useState(String(rows))
  const [c, setC] = useState(String(cols))
  // Re-sync when the parent table grows/shrinks via other actions.
  useEffect(() => {
    setR(String(rows))
  }, [rows])
  useEffect(() => {
    setC(String(cols))
  }, [cols])

  const apply = () => {
    const nr = Number(r)
    const nc = Number(c)
    if (!Number.isFinite(nr) || !Number.isFinite(nc) || nr < 1 || nc < 1) return
    if (nr === rows && nc === cols) return
    onApply(nr, nc)
  }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      apply()
    }
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-gray-200 px-1.5 py-0.5">
      <span className="text-gray-500">크기</span>
      <input
        type="number"
        min={1}
        max={500}
        value={r}
        onChange={(e) => setR(e.target.value)}
        onKeyDown={onKey}
        aria-label="행 수"
        className="w-12 rounded border border-gray-200 px-1 text-center focus:border-smsg-500 focus:outline-none"
      />
      <span aria-hidden="true">×</span>
      <input
        type="number"
        min={1}
        max={50}
        value={c}
        onChange={(e) => setC(e.target.value)}
        onKeyDown={onKey}
        aria-label="열 수"
        className="w-10 rounded border border-gray-200 px-1 text-center focus:border-smsg-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={apply}
        disabled={Number(r) === rows && Number(c) === cols}
        className="rounded bg-smsg-700 px-1.5 text-white hover:bg-smsg-900 disabled:opacity-40"
      >
        적용
      </button>
    </span>
  )
}

function ArrowBtn({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="pointer-events-auto rounded px-1 text-[11px] text-gray-600 hover:bg-smsg-100 hover:text-smsg-700 disabled:cursor-not-allowed disabled:opacity-30"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  )
}

/**
 * L-1 — TableBlock 의 `source` / `filters` 편집 패널.
 *
 * ChartSourcePanel 과 형태는 같지만 `labelField` / `aggregations` 가 없다.
 * TableBlock 은 viewer 가 raw rows 를 `block.headers` 의 컬럼명으로 projection
 * 하므로 별도 label/aggregation 입력이 필요 없다 (참고: docs/lat/documents.md
 * TableBlock 의 ★ K 노트).
 *
 * 노출하는 컨트롤:
 *   - source kind 라디오: none / inline / data-source
 *   - data-source 일 때 같은 문서 안 DataSourceBlock 선택 `<select>`
 *   - inline rows 의 첫 행 키를 datalist 로 자동완성 힌트 (현재는 filter
 *     editor 가 JSON-only 라 직접 쓰이진 않지만 ChartSourcePanel 과 일관)
 *
 * filters[] 편집 UI 는 본 사이클 범위 밖 (JSON 직접 편집).
 */
function TableSourcePanel({
  block,
  onChange,
}: {
  block: TableBlock
  onChange: (next: TableBlock) => void
}) {
  const draft = useEditorStore((s) => s.draft)
  const source = block.source
  const sourceKind: 'none' | 'inline' | 'data-source' = source?.kind ?? 'none'

  const dataSources = useMemo(() => {
    const out: Array<{ id: string; endpoint: string }> = []
    for (const section of draft?.sections ?? []) {
      for (const b of section.blocks ?? []) {
        if (b.type === 'data-source') {
          out.push({ id: b.id, endpoint: (b as { endpoint?: string }).endpoint ?? '' })
        }
      }
    }
    return out
  }, [draft])

  const fieldHints = useMemo<string[]>(() => {
    if (source?.kind !== 'inline') return []
    const first = source.rows[0]
    return first ? Object.keys(first) : []
  }, [source])

  const setSourceKind = (next: 'none' | 'inline' | 'data-source') => {
    if (next === sourceKind) return
    const rest = { ...block } as TableBlock
    if (next === 'none') {
      delete (rest as { source?: unknown }).source
      onChange(rest)
      return
    }
    if (next === 'inline') {
      ;(rest as { source?: unknown }).source = { kind: 'inline', rows: [] }
    } else {
      ;(rest as { source?: unknown }).source = {
        kind: 'data-source',
        dataSourceId: dataSources[0]?.id ?? '',
      }
    }
    onChange(rest)
  }

  const sourceMissing = sourceKind === 'none'

  return (
    <section
      className="mt-2 rounded border border-dashed border-gray-300 p-2 dark:border-gray-700"
      data-testid="table-source-panel"
    >
      <p className="mb-2 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
        Data source (slicer / timeline 연동)
        <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
          ({sourceMissing
            ? 'none — 정적 표 (block.rows 그대로 사용)'
            : 'projected — boundSlicers / filters 가 행을 다시 계산'})
        </span>
      </p>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="font-semibold text-gray-700 dark:text-gray-200">Source kind:</span>
        {(['none', 'inline', 'data-source'] as const).map((k) => (
          <label key={k} className="flex items-center gap-1">
            <input
              type="radio"
              name={`table-source-kind-${block.id}`}
              checked={sourceKind === k}
              onChange={() => setSourceKind(k)}
              data-testid={`table-source-kind-${k}`}
            />
            {k}
          </label>
        ))}
        {sourceKind === 'data-source' && (
          <select
            value={(source as { dataSourceId?: string }).dataSourceId ?? ''}
            onChange={(e) => {
              const rest = { ...block } as TableBlock
              ;(rest as { source?: unknown }).source = {
                kind: 'data-source',
                dataSourceId: e.target.value,
              }
              onChange(rest)
            }}
            aria-label="DataSource id"
            data-testid="table-data-source-id"
            className="rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
          >
            {dataSources.length === 0 && <option value="">(no DataSourceBlock)</option>}
            {dataSources.map((ds) => (
              <option key={ds.id} value={ds.id}>
                {ds.id.slice(0, 8)}… · {ds.endpoint || '(no endpoint)'}
              </option>
            ))}
          </select>
        )}
      </div>

      {fieldHints.length > 0 && (
        <datalist id={`table-fields-${block.id}`}>
          {fieldHints.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      )}
    </section>
  )
}
