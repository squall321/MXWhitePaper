import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  DocumentJSONV10,
  SectionLevel1,
  SectionLevel2,
  SectionLevel3,
} from '@/types/document'

type AnySection = SectionLevel1 | SectionLevel2 | SectionLevel3

export interface SectionLinkPick {
  /** Empty string — same-document anchor. */
  slug: ''
  /** DOM-id form (`section-1.1`) so callers can drop it straight into a hash. */
  anchor: string
  display: string
}

interface SectionLinkPickerProps {
  /**
   * The current document tree to scan for sections. Pass the live editor
   * draft (`useEditorStore.getState().draft`) for fresh titles / numbers.
   */
  document: DocumentJSONV10
  /** Called with the chosen section. */
  onSelect: (pick: SectionLinkPick) => void
  /** Close without picking (Esc / backdrop). */
  onCancel: () => void
}

interface FlatItem {
  number: string
  title: string
  level: 1 | 2 | 3
}

/**
 * Modal that lists every section in the current document with a search
 * filter. Used by the link-insert flow ("현재 문서의 섹션") to produce a
 * `[[#section-X.Y|타이틀]]` wiki-link.
 *
 * Keyboard:
 *   - ↑ / ↓ navigate the highlighted row
 *   - Enter  selects the highlighted row
 *   - Esc    cancels
 *
 * Sections without a `number` are skipped — anchors only target numbered
 * headings.
 */
export function SectionLinkPicker({
  document,
  onSelect,
  onCancel,
}: SectionLinkPickerProps) {
  const items = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = []
    const walk = (s: AnySection) => {
      if (s.number) {
        out.push({ number: s.number, title: s.title, level: s.level })
      }
      if ('subsections' in s && s.subsections) {
        for (const sub of s.subsections) walk(sub as AnySection)
      }
    }
    for (const s of document.sections) walk(s)
    return out
  }, [document])

  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo<FlatItem[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.number.toLowerCase().includes(q),
    )
  }, [items, query])

  // Reset highlight when filter narrows past it.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0)
  }, [filtered.length, highlight])

  // Auto-focus the search input on mount.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const pick = (it: FlatItem) => {
    onSelect({
      slug: '',
      anchor: `section-${it.number}`,
      display: it.title,
    })
  }

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) =>
        filtered.length === 0 ? 0 : (h + 1) % filtered.length,
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) =>
        filtered.length === 0
          ? 0
          : (h - 1 + filtered.length) % filtered.length,
      )
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const it = filtered[highlight]
      if (it) pick(it)
      return
    }
  }

  return (
    <div
      className="fixed inset-0 z-modal flex items-start justify-center bg-black/30 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label="섹션 링크 선택"
      data-testid="section-link-picker"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={handleKey}
    >
      <div className="w-full max-w-lg rounded-md border border-gray-200 bg-white shadow-lg">
        <div className="border-b border-gray-200 p-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="섹션 번호 또는 제목으로 검색"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-smsg-500 focus:outline-none"
            aria-label="섹션 검색"
            data-testid="section-link-picker-search"
          />
        </div>
        <ul
          className="max-h-80 overflow-y-auto py-1"
          role="listbox"
          aria-label="섹션 목록"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-gray-500">
              일치하는 섹션이 없습니다.
            </li>
          ) : (
            filtered.map((it, idx) => {
              const indent =
                it.level === 1 ? 'pl-3' : it.level === 2 ? 'pl-6' : 'pl-9'
              const active = idx === highlight
              return (
                <li key={`${it.number}-${idx}`} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => pick(it)}
                    onMouseEnter={() => setHighlight(idx)}
                    className={
                      `flex w-full items-baseline gap-2 ${indent} pr-3 py-1.5 text-left text-sm ` +
                      (active
                        ? 'bg-smsg-100 text-smsg-900'
                        : 'text-gray-700 hover:bg-gray-50')
                    }
                    data-testid="section-link-picker-item"
                  >
                    <span className="font-mono text-xs text-gray-500">
                      {it.number}
                    </span>
                    <span className="truncate">{it.title}</span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-3 py-2 text-xs text-gray-500">
          <span>↑↓ 이동 · Enter 선택 · Esc 취소</span>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-gray-300 px-2 py-0.5 text-gray-700 hover:bg-gray-50"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
