import { useEffect, useRef, useState } from 'react'
import { LAYOUT_OPTIONS, type SectionLayoutKind } from '@/components/SectionLayout'

interface Props {
  value: SectionLayoutKind | undefined
  onChange: (next: SectionLayoutKind) => void
}

/**
 * Section header dropdown for picking the section's `layout`. Surfaces
 * the 6 supported layouts (stack / two-col / image-left / image-right /
 * title-only / full-bleed) with an icon + Korean label. Closed-state
 * shows the current label so the user can see at a glance which layout
 * a section uses without opening the menu.
 */
export function SectionLayoutPicker({ value, onChange }: Props) {
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

  const cur = (value ?? 'stack') as SectionLayoutKind
  const curOpt = LAYOUT_OPTIONS.find((o) => o.value === cur) ?? LAYOUT_OPTIONS[0]!

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="섹션 레이아웃"
        title={`레이아웃: ${curOpt.label}`}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-smsg-300 hover:bg-smsg-50 hover:text-smsg-900"
        data-action="open-section-layout"
        data-current-layout={cur}
      >
        <span aria-hidden="true">{curOpt.emoji}</span>
        <span className="hidden md:inline">{curOpt.label}</span>
      </button>
      {open && (
        <ul
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 min-w-[180px] space-y-0.5 rounded border border-gray-200 bg-white p-1 text-sm shadow-lg"
        >
          {LAYOUT_OPTIONS.map((opt) => {
            const active = opt.value === cur
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${active ? 'bg-smsg-50 text-smsg-900' : 'text-gray-700 hover:bg-gray-50'}`}
                  data-layout-option={opt.value}
                >
                  <span aria-hidden="true" className="w-6 text-center">{opt.emoji}</span>
                  <span>{opt.label}</span>
                  {active && <span className="ml-auto text-smsg-500">✓</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
