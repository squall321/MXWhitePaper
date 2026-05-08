import { useEffect, useRef, useState } from 'react'
import type { TableBlock, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'

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
      const result = await patchBlock(
        slug,
        block.id,
        { headers: next.headers, rows: next.rows },
        etag,
        '표 편집',
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
    const headers = [...local.headers, `열 ${local.headers.length + 1}`]
    const rows = local.rows.map((r) => [...r, ''])
    schedule({ ...local, headers, rows })
  }
  const removeColumn = (idx: number) => {
    if (local.headers.length <= 1) return
    const headers = local.headers.filter((_, i) => i !== idx)
    const rows = local.rows.map((r) => r.filter((_, i) => i !== idx))
    schedule({ ...local, headers, rows })
  }

  return (
    <div data-table-block-editor data-block-id={block.id} className="my-3 space-y-2">
      <div className="overflow-x-auto rounded border border-smsg-100 bg-white shadow-sm">
        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
          <thead className="bg-smsg-50 text-smsg-900">
            <tr>
              <th className="w-8 border-b border-smsg-100" aria-hidden />
              {local.headers.map((h, c) => (
                <th
                  key={c}
                  className="group/col relative border-b border-smsg-100 px-2 py-1 font-semibold"
                  scope="col"
                >
                  <input
                    type="text"
                    value={h}
                    onChange={(e) => setHeader(c, e.target.value)}
                    aria-label={`헤더 ${c + 1}`}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-semibold text-smsg-900 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
                  />
                  <button
                    type="button"
                    aria-label={`열 ${c + 1} 삭제`}
                    onClick={() => removeColumn(c)}
                    disabled={local.headers.length <= 1}
                    className="absolute right-0 top-0 hidden rounded px-1 text-[10px] text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 group-hover/col:block"
                  >
                    ✕
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {local.rows.map((row, r) => (
              <tr key={r} className="group/row odd:bg-white even:bg-gray-50">
                <td className="border-b border-gray-100 px-1 align-top text-[10px] text-gray-400">
                  <div className="flex flex-col items-center gap-0.5 py-1 opacity-0 transition-opacity group-hover/row:opacity-100">
                    <button
                      type="button"
                      aria-label={`행 ${r + 1} 위로`}
                      onClick={() => moveRow(r, -1)}
                      disabled={r === 0}
                      className="rounded px-1 hover:bg-smsg-100 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`행 ${r + 1} 아래로`}
                      onClick={() => moveRow(r, 1)}
                      disabled={r === local.rows.length - 1}
                      className="rounded px-1 hover:bg-smsg-100 disabled:opacity-30"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      aria-label={`행 ${r + 1} 삭제`}
                      onClick={() => removeRow(r)}
                      className="rounded px-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </td>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className="border-b border-gray-100 px-1 py-0.5 align-top"
                  >
                    <input
                      type="text"
                      value={cell}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      aria-label={`${r + 1}행 ${c + 1}열`}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
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
          + 행
        </button>
        <button
          type="button"
          onClick={addColumn}
          className="rounded border border-dashed border-smsg-300 px-2 py-1 text-smsg-700 hover:bg-smsg-100"
        >
          + 열
        </button>
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </div>
  )
}
