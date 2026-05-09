import { useEffect, useRef, useState } from 'react'
import type { Block } from '@/types/document'
import { ulid } from '../ulid'

/**
 * BlockInsertPalette — small inline popover with the 16 most-used block
 * builders. Anchored to the `+` rail above/below a block, it returns the
 * picked block to the caller (which fires `insertBlock` with the right
 * `index`). Mouse + keyboard accessible:
 *   - ArrowLeft/ArrowRight or ArrowUp/ArrowDown moves focus through tiles.
 *   - Enter / Space picks the focused tile.
 *   - Esc closes without picking.
 *
 * Each tile carries a small tooltip with a 1-line description, a tiny visual
 * preview, and the slash-menu shortcut a keyboard user would type to insert
 * the same block from the `/` menu. Hover or focus the tile to surface it.
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
  /** One-liner shown on hover. */
  hint: string
  /** Slash-menu shortcut (e.g. `/표` or `/H2`). */
  slash: string
  /** Tiny preview swatch shown above the hint. ASCII / single-line UI. */
  preview: string
}

export const PALETTE_ITEMS: PaletteItem[] = [
  {
    kind: 'paragraph',
    label: '글',
    icon: '¶',
    build: () => ({ type: 'paragraph', id: ulid(), text: '' }),
    hint: '일반 본문 단락. 마크다운으로 **굵게** *기울임* `코드` 가능.',
    slash: '/글',
    preview: '본문 한 줄을 자유롭게 작성해요.',
  },
  // Heading levels 2 / 3 / 4 — schema stores them all as heading-4 blocks
  // with `meta.level` distinguishing the visual size. The renderer picks
  // the right CSS based on level (text-2xl / text-xl / text-lg).
  {
    kind: 'heading-2',
    label: '큰 제목',
    icon: 'H₂',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', meta: { level: 2 } }),
    hint: 'level 2 큰 제목. 섹션 분기점에 사용하세요.',
    slash: '/H2',
    preview: 'H₂ 큰 제목',
  },
  {
    kind: 'heading-3',
    label: '중간 제목',
    icon: 'H₃',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', meta: { level: 3 } }),
    hint: 'level 3 중간 제목. 큰 제목의 하위 분류.',
    slash: '/H3',
    preview: 'H₃ 중간 제목',
  },
  {
    kind: 'heading-4',
    label: '작은 제목',
    icon: 'H₄',
    build: () => ({ type: 'heading-4', id: ulid(), title: '', meta: { level: 4 } }),
    hint: 'level 4 작은 제목. 가장 가벼운 강조.',
    slash: '/H4',
    preview: 'H₄ 작은 제목',
  },
  // Lists — split per style so users pick up-front instead of cycling later.
  {
    kind: 'bullet-list',
    label: '글머리 목록',
    icon: '•',
    build: () => ({ type: 'list', id: ulid(), style: 'bullet', items: [''] }),
    hint: '점(•)으로 시작하는 비순서 목록.',
    slash: '/목록',
    preview: '• 항목 1\n• 항목 2',
  },
  {
    kind: 'numbered-list',
    label: '번호 목록',
    icon: '1.',
    build: () => ({ type: 'list', id: ulid(), style: 'number', items: [''] }),
    hint: '1, 2, 3 … 자동 번호가 붙는 목록.',
    slash: '/번호',
    preview: '1. 첫째\n2. 둘째',
  },
  {
    kind: 'check-list',
    label: '체크리스트',
    icon: '☑',
    build: () => ({ type: 'list', id: ulid(), style: 'check', items: [''] }),
    hint: '체크박스로 진행 상태를 관리.',
    slash: '/체크',
    preview: '☐ 할 일\n☑ 완료',
  },
  {
    kind: 'callout',
    label: '콜아웃',
    icon: '!',
    build: () => ({ type: 'callout', id: ulid(), variant: 'info', text: '' }),
    hint: 'info / warn / danger / tip 강조 박스.',
    slash: '/콜아웃',
    preview: 'ℹ 정보 알림',
  },
  {
    kind: 'quote',
    label: '인용',
    icon: '“',
    build: () => ({ type: 'quote', id: ulid(), text: '' }),
    hint: '인용문. 출처(`cite`)도 함께 보관.',
    slash: '/인용',
    preview: '“ 인용 한 줄 ”',
  },
  {
    kind: 'code',
    label: '코드',
    icon: '<>',
    build: () => ({ type: 'code', id: ulid(), code: '', language: 'text' }),
    hint: '언어별 하이라이팅 코드 블록.',
    slash: '/코드',
    preview: '`const x = 1`',
  },
  {
    kind: 'table',
    label: '표',
    icon: '▦',
    build: () => ({ type: 'table', id: ulid(), headers: ['열 1', '열 2'], rows: [['', '']] }),
    hint: '행/열 표. CSV 붙여넣기로 빠르게 채울 수 있어요.',
    slash: '/표',
    preview: '┌─┬─┐\n├─┼─┤',
  },
  {
    kind: 'chart',
    label: '차트',
    icon: '📊',
    build: () => ({ type: 'chart', id: ulid(), chartType: 'line', data: { labels: [], series: [] } }),
    hint: '막대/선/원/면적/레이더/산점. CSV 붙여넣기 지원.',
    slash: '/차트',
    preview: '▁▂▃▅▇',
  },
  {
    kind: 'image',
    label: '이미지',
    icon: '🖼',
    build: () => null,
    hint: '업로드 또는 URL 첨부. 캡션 / alt 텍스트 지원.',
    slash: '/이미지',
    preview: '🖼 (image)',
  },
  {
    kind: 'math',
    label: '수식',
    icon: '∑',
    build: () => ({ type: 'math', id: ulid(), expression: '' }),
    hint: 'LaTeX 수식 (KaTeX 렌더). 인라인/블록 모두 지원.',
    slash: '/수식',
    preview: '∫ f(x) dx',
  },
  {
    kind: 'video',
    label: '영상',
    icon: '▶',
    build: () => ({ type: 'video', id: ulid(), url: '' }),
    hint: '사내/유튜브/비메오 영상 임베드.',
    slash: '/영상',
    preview: '▶ video',
  },
  {
    kind: 'file',
    label: '파일',
    icon: '📎',
    build: () => ({ type: 'file', id: ulid(), fileId: '', name: '' }),
    hint: '첨부 파일. 다운로드 카드로 표시됩니다.',
    slash: '/파일',
    preview: '📎 file.pdf',
  },
  {
    kind: 'snippet',
    label: '스니펫',
    icon: '📚',
    // build() returns null — caller opens SnippetPicker and inserts the resolved
    // blocks itself (similar to how the 'image' tile opens the image picker).
    build: () => null,
    hint: '저장된 블록 묶음을 현재 위치에 삽입.',
    slash: '/스니펫',
    preview: '📚 saved blocks',
  },
]

interface Props {
  /** Position the palette opens at; usually the click coordinates. */
  anchor: { x: number; y: number }
  onPick: (item: PaletteItem) => void
  onClose: () => void
}

export function BlockInsertPalette({ anchor, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)

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

  const active = hovered ? PALETTE_ITEMS.find((it) => it.kind === hovered) ?? null : null

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
      className="w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-900"
    >
      <div className="grid grid-cols-4 gap-1">
        {PALETTE_ITEMS.map((it) => (
          <button
            key={it.kind}
            type="button"
            data-tile
            data-kind={it.kind}
            aria-describedby={`palette-tip-${it.kind}`}
            title={`${it.hint} (${it.slash})`}
            onClick={() => onPick(it)}
            onKeyDown={onTileKeyDown}
            onMouseEnter={() => setHovered(it.kind)}
            onMouseLeave={() => setHovered((cur) => (cur === it.kind ? null : cur))}
            onFocus={() => setHovered(it.kind)}
            onBlur={() => setHovered((cur) => (cur === it.kind ? null : cur))}
            className="flex flex-col items-center gap-1 rounded-md border border-transparent px-1 py-2 text-[11px] text-gray-700 transition-colors hover:border-smsg-300 hover:bg-smsg-50 hover:text-smsg-900 focus-visible:border-smsg-500 focus-visible:bg-smsg-50 focus-visible:outline-none dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <span aria-hidden className="text-base leading-none">{it.icon}</span>
            <span>{it.label}</span>
          </button>
        ))}
      </div>

      {/* Hidden description nodes, surfaced through aria-describedby so screen
          readers always have the same body even though the visible tooltip
          only renders for the hovered tile. */}
      <div className="sr-only">
        {PALETTE_ITEMS.map((it) => (
          <span key={it.kind} id={`palette-tip-${it.kind}`}>
            {`${it.hint} 슬래시 메뉴 단축어: ${it.slash}.`}
          </span>
        ))}
      </div>

      {active && (
        <div
          role="tooltip"
          data-testid="palette-tooltip"
          className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-2 text-[11px] leading-snug text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          <p className="font-semibold text-smsg-900 dark:text-smsg-100">{active.label}</p>
          <p className="mt-0.5">{active.hint}</p>
          <pre className="mt-1 whitespace-pre-wrap rounded bg-white px-2 py-1 font-mono text-[10px] text-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {active.preview}
          </pre>
          <p className="mt-1 text-[10px] text-gray-500">
            슬래시 메뉴: <kbd className="rounded border border-gray-300 bg-white px-1 font-mono dark:border-gray-600 dark:bg-gray-900">{active.slash}</kbd>
          </p>
        </div>
      )}
    </div>
  )
}
