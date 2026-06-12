import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react'
import type { SpreadsheetBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import {
  evaluateAll,
  refOf,
  parseRef,
  FN_NAMES,
  DOTTED_ALIASES,
} from './spreadsheet/formulaEngine'
import { remapCells } from './spreadsheet/referenceShift'
import { spreadsheetToDelimited, type CsvDialect } from './spreadsheet/csvExport'
import { parseSpreadsheetPaste } from './spreadsheet/pasteParse'
import { getZebraClass } from './zebra'

/** '=' 뒤 함수명 자동완성 후보 — 기본 함수 + 도트 별칭, 알파벳순. */
const FN_CANDIDATES = [
  ...FN_NAMES,
  ...DOTTED_ALIASES.map(([alias]) => alias),
].sort()

/** 입력 끝의 "함수명 타이핑 중" 토큰 (예: '=SUM(ST' → 'ST'). */
const FN_PREFIX_RE = /[A-Z.]+$/i

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
  // Formula 자동완성 dropdown 상태. acDismissed 는 Escape 로 닫은 뒤 다음
  // 입력 변경까지 다시 열리지 않게 하는 latch.
  const [acIndex, setAcIndex] = useState(0)
  const [acDismissed, setAcDismissed] = useState(false)
  const [acPos, setAcPos] = useState<{ left: number; top: number } | null>(null)
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

  // 후보 목록 — focused 셀의 raw 가 '=' 로 시작하고 마지막 토큰이 함수명
  // prefix 일 때만 (최대 8개). 빈 배열이면 dropdown 닫힘.
  const acCandidates = useMemo<string[]>(() => {
    if (!focused || acDismissed) return []
    const raw = cells[focused] ?? ''
    if (!raw.startsWith('=')) return []
    const m = FN_PREFIX_RE.exec(raw)
    if (!m) return []
    const prefix = m[0].toUpperCase()
    return FN_CANDIDATES.filter((n) => n.startsWith(prefix)).slice(0, 8)
  }, [focused, acDismissed, cells])
  const acSelected = Math.min(acIndex, acCandidates.length - 1)

  // Dropdown 을 input 바로 아래에 fixed 로 anchoring — 표가 overflow-x-auto
  // 컨테이너 안이라 absolute 로는 클리핑되기 때문. (useLayoutEffect 는 SSR
  // smoke 테스트에서 경고를 내므로 useEffect — 한 프레임 지연은 무시 가능.)
  useEffect(() => {
    if (!focused || acCandidates.length === 0) {
      setAcPos(null)
      return
    }
    const el = inputRefs.current.get(focused)
    if (!el) {
      setAcPos(null)
      return
    }
    const r = el.getBoundingClientRect()
    setAcPos({ left: r.left, top: r.bottom })
  }, [focused, acCandidates])

  const acceptCandidate = (name: string) => {
    if (!focused) return
    const raw = cells[focused] ?? ''
    const m = FN_PREFIX_RE.exec(raw)
    if (!m) return
    setCell(focused, raw.slice(0, m.index) + name + '(')
    setAcIndex(0)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, ref: string) => {
    // 자동완성 dropdown 열림 상태 — 셀 이동보다 먼저 가로챈다. 닫힘 상태에선
    // 아래 기존 Tab/Enter/방향키 이동이 그대로 동작.
    if (focused === ref && acCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAcIndex((i) => Math.min(acCandidates.length - 1, i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAcIndex((i) => Math.max(0, i - 1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptCandidate(acCandidates[acSelected] as string)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAcDismissed(true)
        return
      }
    }
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
   * 엑셀/Sheets 멀티셀 paste — 클립보드에 탭/개행이 있으면 기본 동작을
   * 막고 focused 셀을 anchor 로 그리드를 채운다. 경계를 넘으면 rows/cols 를
   * cap (26x200) 까지 자동 확장. 단일 토큰은 null → 기본 paste 유지.
   */
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, ref: string) => {
    const grid = parseSpreadsheetPaste(e.clipboardData.getData('text/plain'))
    if (!grid) return
    e.preventDefault()
    const pos = parseRef(ref)
    if (!pos) return
    const nextCells = { ...(local.cells ?? {}) }
    let nextRows = rows
    let nextCols = cols
    for (let r = 0; r < grid.length; r++) {
      const tr = pos.row + r
      if (tr >= 200) break
      if (tr + 1 > nextRows) nextRows = tr + 1
      const row = grid[r] ?? []
      for (let c = 0; c < row.length; c++) {
        const tc = pos.col + c
        if (tc >= 26) break
        if (tc + 1 > nextCols) nextCols = tc + 1
        const target = refOf(tc, tr)
        const value = row[c] ?? ''
        if (value === '') delete nextCells[target]
        else nextCells[target] = value
      }
    }
    schedule({ ...local, rows: nextRows, cols: nextCols, cells: nextCells })
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

  /**
   * Browser-side download. CSV/TSV 는 *평가된 값* (formula 결과) 으로 내보내서
   * Excel/Google Sheets 가 그대로 paste 받을 수 있게 한다 (raw formula 가
   * 아니라 사람이 보는 값).
   */
  const downloadDelimited = (dialect: CsvDialect) => {
    if (typeof window === 'undefined') return
    const text = spreadsheetToDelimited({
      cols,
      rows,
      cells,
      computed,
      dialect,
    })
    const ext = dialect === 'tsv' ? 'tsv' : 'csv'
    // CSV/TSV 는 charset utf-8 + BOM 으로 Excel 의 mojibake 회피.
    const blob = new Blob(['﻿', text], {
      type: dialect === 'tsv'
        ? 'text/tab-separated-values;charset=utf-8'
        : 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const title = (local.title ?? 'spreadsheet').replace(/[^\w가-힣.-]+/g, '_')
    a.download = `${title}.${ext}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // 다음 tick 에 revoke — 일부 브라우저에서 click 이 비동기로 url 을 fetch.
    setTimeout(() => URL.revokeObjectURL(url), 0)
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
        <button
          type="button"
          onClick={() => downloadDelimited('csv')}
          data-spreadsheet-export-csv
          aria-label="CSV 내보내기"
          title="CSV (값) — Excel/Google Sheets paste 가능"
          className="rounded border border-smsg-300 bg-white px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100"
        >
          ⬇ CSV
        </button>
        <button
          type="button"
          onClick={() => downloadDelimited('tsv')}
          data-spreadsheet-export-tsv
          aria-label="TSV 내보내기"
          title="TSV (값) — Excel/Google Sheets paste 가능"
          className="rounded border border-smsg-300 bg-white px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100"
        >
          ⬇ TSV
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
                    {cols < 26 && (
                      <span className="absolute right-6 top-1/2 flex -translate-y-1/2 gap-0.5">
                        <button
                          type="button"
                          onClick={() => insertCol(c)}
                          aria-label={`열 ${colLabel} 왼쪽에 삽입`}
                          title="왼쪽에 열 삽입"
                          data-spreadsheet-insert-col-left={colLabel}
                          className="rounded px-0.5 text-[10px] leading-none text-gray-400 opacity-0 hover:bg-smsg-100 hover:text-smsg-700 focus:opacity-100 group-hover:opacity-100"
                        >
                          +←
                        </button>
                        <button
                          type="button"
                          onClick={() => insertCol(c + 1)}
                          aria-label={`열 ${colLabel} 오른쪽에 삽입`}
                          title="오른쪽에 열 삽입"
                          data-spreadsheet-insert-col-right={colLabel}
                          className="rounded px-0.5 text-[10px] leading-none text-gray-400 opacity-0 hover:bg-smsg-100 hover:text-smsg-700 focus:opacity-100 group-hover:opacity-100"
                        >
                          +→
                        </button>
                      </span>
                    )}
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
                  {rows < 200 && (
                    <span className="absolute left-0 top-1/2 flex -translate-y-1/2 flex-col">
                      <button
                        type="button"
                        onClick={() => insertRow(r)}
                        aria-label={`행 ${r + 1} 위에 삽입`}
                        title="위에 행 삽입"
                        data-spreadsheet-insert-row-above={r + 1}
                        className="rounded px-0.5 text-[9px] leading-none text-gray-400 opacity-0 hover:bg-smsg-100 hover:text-smsg-700 focus:opacity-100 group-hover:opacity-100"
                      >
                        +↑
                      </button>
                      <button
                        type="button"
                        onClick={() => insertRow(r + 1)}
                        aria-label={`행 ${r + 1} 아래에 삽입`}
                        title="아래에 행 삽입"
                        data-spreadsheet-insert-row-below={r + 1}
                        className="rounded px-0.5 text-[9px] leading-none text-gray-400 opacity-0 hover:bg-smsg-100 hover:text-smsg-700 focus:opacity-100 group-hover:opacity-100"
                      >
                        +↓
                      </button>
                    </span>
                  )}
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
                        onFocus={() => {
                          setFocused(ref)
                          setAcIndex(0)
                          setAcDismissed(false)
                        }}
                        onBlur={() => {
                          setFocused((cur) => (cur === ref ? null : cur))
                        }}
                        onChange={(e) => {
                          setAcIndex(0)
                          setAcDismissed(false)
                          setCell(ref, e.target.value)
                        }}
                        onKeyDown={(e) => onKeyDown(e, ref)}
                        onPaste={(e) => onPaste(e, ref)}
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

      {acPos && acCandidates.length > 0 && (
        <ul
          role="listbox"
          aria-label="함수 자동완성"
          data-spreadsheet-fn-autocomplete
          style={{ position: 'fixed', left: acPos.left, top: acPos.top, zIndex: 50 }}
          className="max-h-48 w-44 overflow-y-auto rounded border border-gray-200 bg-white py-0.5 shadow-lg"
        >
          {acCandidates.map((name, i) => (
            <li key={name} role="option" aria-selected={i === acSelected}>
              <button
                type="button"
                // click 은 input blur 이후라 dropdown 이 먼저 닫힘 — mousedown
                // 에서 preventDefault 로 focus 를 유지한 채 선택한다.
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  acceptCandidate(name)
                }}
                className={`block w-full px-2 py-0.5 text-left font-mono text-xs hover:bg-smsg-100 ${
                  i === acSelected ? 'bg-smsg-100 text-smsg-700' : 'text-gray-700'
                }`}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
