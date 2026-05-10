import { useEffect, useRef, useState } from 'react'
import type { TableBlock } from '@/types/document'

type ColumnEntry = NonNullable<TableBlock['columns']>[number]

interface Props {
  /** Current per-column metadata (may be undefined for default settings). */
  column: ColumnEntry | undefined
  /** Patches the column entry; the parent merges into `block.columns`. */
  onChange: (next: ColumnEntry) => void
}

/**
 * Per-column ⋮ popover surfaced from the column header in TableBlockEditor.
 *
 * Lets the user set width, default alignment, dtype, and a format hint
 * without leaving the table. The popover positions absolutely and closes
 * on outside-click / Escape so it doesn't block keyboard editing of cells.
 */
export function ColumnHeaderMenu({ column, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  // Close on outside click / Escape — same pattern used by other popovers.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return
      if (e.target instanceof Node && ref.current.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const cur = column ?? {}
  const set = (patch: Partial<ColumnEntry>) => {
    onChange({ ...cur, ...patch })
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label="열 옵션"
        title="열 옵션 (정렬·너비·데이터 타입·형식)"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 rounded px-1 text-[11px] text-gray-500 hover:bg-smsg-100 hover:text-smsg-700"
        data-action="open-column-menu"
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 space-y-2 rounded border border-gray-200 bg-white p-3 text-xs shadow-lg"
        >
          <div>
            <div className="mb-1 font-semibold text-gray-700">정렬</div>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map((a) => {
                const active = (cur.align ?? '') === a
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => set({ align: a })}
                    aria-pressed={active}
                    className={`flex-1 rounded border px-2 py-1 ${active ? 'border-smsg-500 bg-smsg-50 text-smsg-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {a === 'left' ? '⬅' : a === 'center' ? '⇔' : '➡'}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => set({ align: undefined })}
                className="rounded border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50"
                title="기본"
              >
                기본
              </button>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block font-semibold text-gray-700">너비</span>
            <input
              type="text"
              value={cur.width ?? ''}
              onChange={(e) => set({ width: e.target.value || undefined })}
              placeholder="auto / 120px / 20%"
              className="w-full rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold text-gray-700">데이터 타입</span>
            <select
              value={cur.dtype ?? ''}
              onChange={(e) => set({ dtype: (e.target.value || undefined) as ColumnEntry['dtype'] })}
              className="w-full rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
            >
              <option value="">텍스트(기본)</option>
              <option value="number">숫자</option>
              <option value="percent">퍼센트</option>
              <option value="currency">통화</option>
              <option value="date">날짜</option>
            </select>
          </label>
          {(cur.dtype === 'number' || cur.dtype === 'percent' || cur.dtype === 'currency') && (
            <label className="block">
              <span className="mb-1 block font-semibold text-gray-700">형식</span>
              <input
                type="text"
                value={cur.format ?? ''}
                onChange={(e) => set({ format: e.target.value || undefined })}
                placeholder={
                  cur.dtype === 'currency'
                    ? "통화: 'KRW' / '$' / '€'"
                    : '소수 자리수: 0, 2, 0.00'
                }
                className="w-full rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
              />
            </label>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onChange({})}
              className="rounded border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded bg-smsg-700 px-2 py-1 text-white hover:bg-smsg-900"
            >
              완료
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
