import { useEffect, useRef } from 'react'
import type { Block } from '@/types/document'
import { ulid } from '../ulid'

/**
 * BlockInsertPalette — small inline popover with the 12 most-used block
 * builders. Anchored to the `+` rail above/below a block, it returns the
 * picked block to the caller (which fires `insertBlock` with the right
 * `index`). Mouse + keyboard accessible:
 *   - ArrowLeft/ArrowRight or ArrowUp/ArrowDown moves focus through tiles.
 *   - Enter / Space picks the focused tile.
 *   - Esc closes without picking.
 *
 * Designed to feel like Notion's "/+" bubble — no chrome, very low friction.
 */

export interface PaletteItem {
  kind: string
  label: string
  /** Single-glyph icon. Stick to one char so the grid stays tidy. */
  icon: string
  /** Build the block payload; return null when the action delegates (image picker). */
  build: () => Block | null
}

export const PALETTE_ITEMS: PaletteItem[] = [
  { kind: 'paragraph', label: '글', icon: '¶', build: () => ({ type: 'paragraph', id: ulid(), text: '' }) },
  // Heading levels 2 / 3 / 4 — schema stores them all as heading-4 blocks
  // with `meta.level` distinguishing the visual size. The renderer picks
  // the right CSS based on level (text-2xl / text-xl / text-lg).
  {
    kind: 'heading-2',
    label: '큰 제목',
    icon: 'H₂',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', meta: { level: 2 } }),
  },
  {
    kind: 'heading-3',
    label: '중간 제목',
    icon: 'H₃',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', meta: { level: 3 } }),
  },
  {
    kind: 'heading-4',
    label: '작은 제목',
    icon: 'H₄',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', meta: { level: 4 } }),
  },
  // Lists — split per style so users pick up-front instead of cycling later.
  {
    kind: 'bullet-list',
    label: '글머리 목록',
    icon: '•',
    build: () => ({ type: 'list', id: ulid(), style: 'bullet', items: [''] }),
  },
  {
    kind: 'numbered-list',
    label: '번호 목록',
    icon: '1.',
    build: () => ({ type: 'list', id: ulid(), style: 'number', items: [''] }),
  },
  {
    kind: 'check-list',
    label: '체크리스트',
    icon: '☑',
    build: () => ({ type: 'list', id: ulid(), style: 'check', items: [''] }),
  },
  { kind: 'callout', label: '콜아웃', icon: '!', build: () => ({ type: 'callout', id: ulid(), variant: 'info', text: '' }) },
  { kind: 'quote', label: '인용', icon: '“', build: () => ({ type: 'quote', id: ulid(), text: '' }) },
  { kind: 'code', label: '코드', icon: '<>', build: () => ({ type: 'code', id: ulid(), code: '', language: 'text' }) },
  {
    kind: 'table', label: '표', icon: '▦',
    build: () => ({ type: 'table', id: ulid(), headers: ['열 1', '열 2'], rows: [['', '']] }),
  },
  {
    kind: 'chart', label: '차트', icon: '📊',
    build: () => ({ type: 'chart', id: ulid(), chartType: 'line', data: { labels: [], series: [] } }),
  },
  { kind: 'image', label: '이미지', icon: '🖼', build: () => null },
  { kind: 'math', label: '수식', icon: '∑', build: () => ({ type: 'math', id: ulid(), expression: '' }) },
  { kind: 'video', label: '영상', icon: '▶', build: () => ({ type: 'video', id: ulid(), url: '' }) },
  { kind: 'file', label: '파일', icon: '📎', build: () => ({ type: 'file', id: ulid(), fileId: '', name: '' }) },
]

interface Props {
  /** Position the palette opens at; usually the click coordinates. */
  anchor: { x: number; y: number }
  onPick: (item: PaletteItem) => void
  onClose: () => void
}

export function BlockInsertPalette({ anchor, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  // Click outside / Esc to close.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Focus the first tile when the palette mounts so keyboard users can pick
  // immediately without an extra Tab.
  useEffect(() => {
    const first = ref.current?.querySelector('button') as HTMLButtonElement | null
    first?.focus()
  }, [])

  // Clamp the popover so it never spills off the right edge of the viewport.
  // Keeps the layout sane even when the user clicks near the right rail.
  const left = Math.max(8, Math.min(window.innerWidth - 296, anchor.x - 12))
  const top = Math.max(8, anchor.y + 4)

  const onTileKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const tiles = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('button[data-tile]') ?? [],
    )
    const idx = tiles.indexOf(e.currentTarget)
    if (idx < 0) return
    const cols = 4
    let next = idx
    if (e.key === 'ArrowRight') next = idx + 1
    else if (e.key === 'ArrowLeft') next = idx - 1
    else if (e.key === 'ArrowDown') next = idx + cols
    else if (e.key === 'ArrowUp') next = idx - cols
    else return
    e.preventDefault()
    next = Math.max(0, Math.min(tiles.length - 1, next))
    tiles[next]?.focus()
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="블록 추가"
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 'var(--z-popover)' as unknown as number,
      }}
      className="grid w-72 grid-cols-4 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      {PALETTE_ITEMS.map((it) => (
        <button
          key={it.kind}
          type="button"
          data-tile
          data-kind={it.kind}
          onClick={() => onPick(it)}
          onKeyDown={onTileKeyDown}
          className="flex flex-col items-center gap-1 rounded-md border border-transparent px-1 py-2 text-[11px] text-gray-700 transition-colors hover:border-smsg-300 hover:bg-smsg-50 hover:text-smsg-900 focus-visible:border-smsg-500 focus-visible:bg-smsg-50 focus-visible:outline-none dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <span aria-hidden className="text-base leading-none">{it.icon}</span>
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  )
}
