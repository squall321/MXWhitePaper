import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { SpreadsheetBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { evaluateAll, refOf, parseRef } from './spreadsheet/formulaEngine'
import { remapCells } from './spreadsheet/referenceShift'
import { getZebraClass } from './zebra'

interface Props {
  slug: Slug
  block: SpreadsheetBlock
}

/**
 * Edit-mode spreadsheet — same A..Z grid as the view, but every cell is an
 * `<input type="text">` bound to the sparse `cells` map. Recomputes via
 * `evaluateAll` on every render. Persistence is debounced 800 ms (matches
 * other block editors) via `patchBlock`.
 *
 * Keyboard navigation:
 *   - Tab / Shift+Tab — next / prev cell in row order
 *   - Enter — move down one row
 *   - Arrow keys — move within the grid (only when cursor is at the
 *     start/end of the input so we don't fight the OS text caret)
 *
 * The formula bar shows the *raw* text of the focused cell so users can
 * see/edit `=SUM(A1:A10)` instead of the computed value.
 */
export function SpreadsheetBlockEditor({ slug, block }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [local, setLocal] = useState<SpreadsheetBlock>(block)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  // Refs into each input so we can imperatively focus on Tab/Enter/Arrow.
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  useEffect(() => {
    setLocal(block)
  }, [block])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const cols = Math.min(26, Math.max(1, local.cols))
  const rows = Math.min(200, Math.max(1, local.rows))
  // Coerce `{[k]: string | undefined}` (JSON-schema regen quirk) to a
  // defined-only Record before handing to the formula engine.
  const cells = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(local.cells ?? {})) {
      if (typeof v === 'string') out[k] = v
    }
    return out
  }, [local.cells])
  const computed = useMemo(() => evaluateAll(cells), [cells])

  const schedule = (next: SpreadsheetBlock) => {
    setLocal(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: SpreadsheetBlock) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        block.id,
        {
          title: next.title,
          cols: next.cols,
          rows: next.rows,
          headers: next.headers,
          cells: next.cells,
          options: next.options,
        } as Partial<SpreadsheetBlock>,
        etag,
        '스프레드시트 편집',
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('충돌 — 새로고침 필요')
      } else {
        setError((err as Error).message)
      }
    }
  }

  const setCell = (ref: string, value: string) => {
    const next = { ...(local.cells ?? {}) }
    if (value === '') delete next[ref]
    else next[ref] = value
    schedule({ ...local, cells: next })
  }

  const updateOptions = (patch: Partial<NonNullable<SpreadsheetBlock['options']>>) => {
    const nextOpts = { ...(local.options ?? {}), ...patch }
    schedule({ ...local, options: nextOpts })
  }

  const focusRef = (ref: string) => {
    const el = inputRefs.current.get(ref)
    el?.focus()
    el?.select?.()
  }

  const moveFocus = (ref: string, dx: number, dy: number) => {
    const pos = parseRef(ref)
    if (!pos) return
    const nc = Math.min(cols - 1, Math.max(0, pos.col + dx))
    const nr = Math.min(rows - 1, Math.max(0, pos.row + dy))
    focusRef(refOf(nc, nr))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, ref: string) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      moveFocus(ref, e.shiftKey ? -1 : 1, 0)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      moveFocus(ref, 0, e.shiftKey ? -1 : 1)
      return
    }
    const el = e.currentTarget
    const atStart = el.selectionStart === 0 && el.selectionEnd === 0
    const atEnd =
      el.selectionStart === el.value.length && el.selectionEnd === el.value.length
    if (e.key === 'ArrowLeft' && atStart) {
      e.preventDefault()
      moveFocus(ref, -1, 0)
    } else if (e.key === 'ArrowRight' && atEnd) {
      e.preventDefault()
      moveFocus(ref, 1, 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(ref, 0, -1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(ref, 0, 1)
    }
  }

  /**
   * 행 삽입. idx 가 주어지면 그 위치에 새 행을 끼워넣고 (cells 키 + formula
   * 참조 shift), 생략하면 끝에 한 행만 append 한다 (기존 addRow 동작).
   */
  const insertRow = (idx?: number) => {
    if (rows >= 200) return
    if (idx == null || idx >= rows) {
      schedule({ ...local, rows: rows + 1 })
      return
    }
    const nextCells = remapCells(cells, 'row', idx, 'insert')
    schedule({ ...local, rows: rows + 1, cells: nextCells })
  }

  const insertCol = (idx?: number) => {
    if (cols >= 26) return
    if (idx == null || idx >= cols) {
      schedule({ ...local, cols: cols + 1 })
      return
    }
    const nextCells = remapCells(cells, 'col', idx, 'insert')
    schedule({ ...local, cols: cols + 1, cells: nextCells })
  }

  const deleteRow = (idx: number) => {
    if (rows <= 1) return
    if (idx < 0 || idx >= rows) return
    const nextCells = remapCells(cells, 'row', idx, 'delete')
    schedule({ ...local, rows: rows - 1, cells: nextCells })
  }

  const deleteCol = (idx: number) => {
    if (cols <= 1) return
    if (idx < 0 || idx >= cols) return
    const nextCells = remapCells(cells, 'col', idx, 'delete')
    schedule({ ...local, cols: cols - 1, cells: nextCells })
  }

  const focusedRaw = focused ? (local.cells?.[focused] ?? '') : ''

  return (
    <div
      data-spreadsheet-block-editor
      data-block-id={block.id}
      className="my-3 space-y-2 rounded border border-smsg-100 bg-smsg-100/40 p-3"
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={local.title ?? ''}
          placeholder="스프레드시트 제목 (선택)"
          aria-label="스프레드시트 제목"
          onChange={(e) => schedule({ ...local, title: e.target.value || undefined })}
          className="flex-1 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-smsg-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => insertRow()}
          disabled={rows >= 200}
          className="rounded border border-smsg-300 bg-white px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100 disabled:opacity-50"
        >
          + 행 추가
        </button>
        <button
          type="button"
          onClick={() => insertCol()}
          disabled={cols >= 26}
          className="rounded border border-smsg-300 bg-white px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100 disabled:opacity-50"
        >
          + 열 추가
        </button>
        <label
          className="flex items-center gap-1 text-xs text-gray-600"
          data-spreadsheet-stripe-toggle
        >
          <input
            type="checkbox"
            checked={local.options?.stripe !== false}
            onChange={(e) => updateOptions({ stripe: e.target.checked })}
            aria-label="줄무늬 표시"
          />
          줄무늬
        </label>
      </div>

      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded border border-gray-200 bg-white px-2 py-1 text-xs"
      >
        <span className="font-mono font-semibold text-smsg-700">
          {focused ?? '—'}
        </span>
        <span className="text-gray-300">|</span>
        <span className="flex-1 truncate font-mono text-gray-700">
          {focused ? focusedRaw || '(비어 있음)' : '셀을 선택하세요'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="w-10 border border-gray-200 px-2 py-1 text-center font-medium" />
              {Array.from({ length: cols }).map((_, c) => {
                const colLabel = String.fromCharCode(65 + c)
                return (
                  <th
                    key={c}
                    scope="col"
                    className="group relative min-w-[80px] border border-gray-200 px-2 py-1 font-medium"
                  >
                    <span>{colLabel}</span>
                    {cols > 1 && (
                      <button
                        type="button"
                        onClick={() => deleteCol(c)}
                        aria-label={`열 ${colLabel} 삭제`}
                        data-spreadsheet-delete-col={colLabel}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] leading-none text-gray-400 opacity-0 hover:bg-red-100 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr
                key={r}
                className={getZebraClass('spreadsheet', local.options, r)}
              >
                <th
                  scope="row"
                  className="group relative border border-gray-200 bg-gray-50 px-2 py-1 text-center font-medium text-gray-500"
                >
                  <span>{r + 1}</span>
                  {rows > 1 && (
                    <button
                      type="button"
                      onClick={() => deleteRow(r)}
                      aria-label={`행 ${r + 1} 삭제`}
                      data-spreadsheet-delete-row={r + 1}
                      className="absolute right-0 top-1/2 -translate-y-1/2 rounded px-1 text-[10px] leading-none text-gray-400 opacity-0 hover:bg-red-100 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  )}
                </th>
                {Array.from({ length: cols }).map((_, c) => {
                  const ref = refOf(c, r)
                  const raw = local.cells?.[ref] ?? ''
                  const result = computed[ref]
                  // When focused, show raw formula. Otherwise show computed.
                  const showRaw = focused === ref
                  const display = showRaw
                    ? raw
                    : result?.error
                      ? result.error
                      : result == null || result.value === ''
                        ? ''
                        : String(result.value)
                  return (
                    <td
                      key={c}
                      className="border border-gray-100 p-0 align-top"
                    >
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current.set(ref, el)
                          else inputRefs.current.delete(ref)
                        }}
                        type="text"
                        value={display}
                        data-cell-ref={ref}
                        aria-label={`셀 ${ref}`}
                        onFocus={() => setFocused(ref)}
                        onBlur={() => {
                          setFocused((cur) => (cur === ref ? null : cur))
                        }}
                        onChange={(e) => setCell(ref, e.target.value)}
                        onKeyDown={(e) => onKeyDown(e, ref)}
                        className={`w-full bg-transparent px-2 py-1 text-xs focus:bg-white focus:outline focus:outline-2 focus:outline-smsg-500 ${
                          result?.error ? 'text-red-600 font-mono' : ''
                        } ${typeof result?.value === 'number' && !showRaw ? 'text-right tabular-nums' : ''}`}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
