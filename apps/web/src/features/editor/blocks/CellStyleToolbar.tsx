import { useEffect, useRef, useState } from 'react'
import type { TableBlock } from '@/types/document'

type SparseCell = NonNullable<TableBlock['cells']>[number]

interface Props {
  cell: SparseCell
  onChange: (patch: Partial<SparseCell>) => void
}

/**
 * Per-cell style popover surfaced from the cell-mode hover menu. Lets the
 * user set:
 *   - Alignment (left / center / right) — overrides column default
 *   - Background (preset chips for highlight colors + hex input)
 *   - Bold toggle
 *   - Text color (chips + hex input)
 *
 * Intentionally lives only in cells-mode: per-cell styling in flat mode
 * would either bloat the schema with a parallel grid or force every flat
 * table to track sparse coords just for color. Auto-converting the table
 * to sparse on the first style click is handled by the parent editor.
 */
export function CellStyleToolbar({ cell, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

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

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label="셀 서식"
        title="셀 서식 (정렬·색·굵게)"
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto rounded px-1 text-[11px] text-gray-600 hover:bg-smsg-100 hover:text-smsg-700"
        data-action="open-cell-style"
      >
        <span aria-hidden="true">🎨</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-60 space-y-2 rounded border border-gray-200 bg-white p-3 text-xs shadow-lg"
        >
          <div>
            <div className="mb-1 font-semibold text-gray-700">정렬</div>
            <div className="flex gap-1">
              {(['left', 'center', 'right'] as const).map((a) => {
                const active = cell.align === a
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange({ align: a })}
                    className={`flex-1 rounded border px-2 py-1 ${active ? 'border-smsg-500 bg-smsg-50 text-smsg-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {a === 'left' ? '⬅' : a === 'center' ? '⇔' : '➡'}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => onChange({ align: undefined })}
                className="rounded border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50"
                title="기본"
              >
                기본
              </button>
            </div>
          </div>
          <div>
            <div className="mb-1 font-semibold text-gray-700">배경</div>
            <ColorChips
              value={cell.bg}
              onChange={(v) => onChange({ bg: v })}
              presets={BG_PRESETS}
            />
          </div>
          <div>
            <div className="mb-1 font-semibold text-gray-700">텍스트 색</div>
            <ColorChips
              value={cell.color}
              onChange={(v) => onChange({ color: v })}
              presets={FG_PRESETS}
            />
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!cell.bold}
              onChange={(e) => onChange({ bold: e.target.checked || undefined })}
            />
            <span>굵게</span>
          </label>
          <div className="flex justify-end">
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

const BG_PRESETS = [
  { value: undefined, label: '기본', swatch: 'bg-white border border-gray-300' },
  { value: '#FEF3C7', label: '노랑', swatch: 'bg-amber-100' },
  { value: '#DBEAFE', label: '파랑', swatch: 'bg-blue-100' },
  { value: '#DCFCE7', label: '초록', swatch: 'bg-green-100' },
  { value: '#FEE2E2', label: '빨강', swatch: 'bg-red-100' },
  { value: '#F3E8FF', label: '보라', swatch: 'bg-purple-100' },
  { value: '#F3F4F6', label: '회색', swatch: 'bg-gray-100' },
]

const FG_PRESETS = [
  { value: undefined, label: '기본', swatch: 'bg-white border border-gray-300' },
  { value: '#1F2937', label: '진회', swatch: 'bg-gray-800' },
  { value: '#DC2626', label: '빨강', swatch: 'bg-red-600' },
  { value: '#16A34A', label: '초록', swatch: 'bg-green-600' },
  { value: '#1D4ED8', label: '파랑', swatch: 'bg-blue-700' },
  { value: '#A16207', label: '갈색', swatch: 'bg-amber-700' },
]

function ColorChips({
  value,
  onChange,
  presets,
}: {
  value: string | undefined
  onChange: (v: string | undefined) => void
  presets: { value: string | undefined; label: string; swatch: string }[]
}) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => {
          const active = (value ?? '') === (p.value ?? '')
          return (
            <button
              key={p.label}
              type="button"
              title={p.label}
              aria-label={p.label}
              aria-pressed={active}
              onClick={() => onChange(p.value)}
              className={`h-5 w-5 rounded ${p.swatch} ${active ? 'ring-2 ring-smsg-500' : ''}`}
            />
          )
        })}
      </div>
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value.trim()
          if (!v) {
            onChange(undefined)
            return
          }
          // Permit valid hex only — invalid input is ignored to keep the
          // schema's pattern constraint happy.
          if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) onChange(v)
        }}
        placeholder="#RRGGBB"
        className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-[11px] focus:border-smsg-500 focus:outline-none"
      />
    </div>
  )
}
