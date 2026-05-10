import type { Block, Slug } from '@/types/document'
import { useEditorStore } from '../state'
import { insertBlock, isPreconditionFailed } from '../api'
import { ulid } from '../ulid'
import { useClipboardImage } from '../hooks/useClipboardImage'

/**
 * QuickInsertBar — a horizontally-scrollable strip of icon buttons for the
 * 12 most-used block types. Mounted under the editor on mobile (and also
 * available on desktop) so users without the slash menu can still insert
 * blocks with a single tap.
 *
 * The bar:
 *   - Reads `slug`, `etag`, `draft` from the editor store.
 *   - Inserts each block at the end of the first top-level section.
 *   - For `image` it dispatches the same `mxwp:open-image-picker` event
 *     the slash menu uses, so the existing toolbar dropzone takes over.
 */

export interface QuickInsertItem {
  /** Stable kind label used by tests. */
  kind: string
  /** Korean caption. */
  label: string
  /** Single-glyph icon. */
  icon: string
  /** Build the block payload. Return null to delegate (e.g. image picker). */
  build: () => Block | null
}

const ITEMS: QuickInsertItem[] = [
  {
    kind: 'paragraph',
    label: '글',
    icon: '¶',
    build: () => ({ type: 'paragraph', id: ulid(), text: '' }),
  },
  {
    kind: 'columns',
    label: '좌우 단',
    icon: '⫴',
    build: () => ({
      type: 'columns',
      id: ulid(),
      // Schema requires 2..4 columns. Start with two empty columns; users
      // populate each column via the slot palette inside ColumnsBlockEditor.
      columns: [[], []],
    }),
  },
  {
    kind: 'table',
    label: '표',
    icon: '▦',
    build: () => ({
      type: 'table',
      id: ulid(),
      headers: ['열 1', '열 2'],
      rows: [['', '']],
    }),
  },
  {
    kind: 'chart',
    label: '차트',
    icon: '📊',
    build: () => ({
      type: 'chart',
      id: ulid(),
      chartType: 'line',
      data: { labels: [], series: [] },
    }),
  },
  {
    kind: 'image',
    label: '이미지',
    icon: '🖼',
    build: () => null, // delegate
  },
  {
    kind: 'gallery',
    label: '갤러리',
    icon: '🖻',
    build: () => ({
      type: 'gallery',
      id: ulid(),
      layout: 'grid',
      // GalleryBlock requires ≥1 item; seed an empty placeholder.
      items: [{ imageId: '' }],
    }),
  },
  {
    kind: 'callout',
    label: '콜아웃',
    icon: '!',
    build: () => ({ type: 'callout', id: ulid(), variant: 'info', text: '' }),
  },
  {
    kind: 'code',
    label: '코드',
    icon: '<>',
    build: () => ({ type: 'code', id: ulid(), code: '', language: 'text' }),
  },
  {
    kind: 'quote',
    label: '인용',
    icon: '“”',
    build: () => ({ type: 'quote', id: ulid(), text: '' }),
  },
  {
    kind: 'list',
    label: '체크리스트',
    icon: '☑',
    build: () => ({
      type: 'list',
      id: ulid(),
      style: 'check',
      items: [''],
    }),
  },
  {
    kind: 'math',
    label: '수식',
    icon: '∑',
    build: () => ({ type: 'math', id: ulid(), expression: '' }),
  },
  {
    kind: 'video',
    label: '영상',
    icon: '▶',
    build: () => ({ type: 'video', id: ulid(), url: '' }),
  },
  {
    kind: 'file',
    label: '파일',
    icon: '📎',
    build: () => ({ type: 'file', id: ulid(), fileId: '', name: '' }),
  },
]

interface Props {
  slug: Slug
  /** Items override (mainly for tests). */
  items?: QuickInsertItem[]
  /** Hook so tests can capture the inserted block. */
  onInserted?: (block: Block | { kind: 'image' }) => void
}

export function QuickInsertBar({ slug, items = ITEMS, onInserted }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const draft = useEditorStore((s) => s.draft)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const targetSectionId = draft?.sections[0]?.id
  const clipboardHasImage = useClipboardImage()

  const onPick = async (it: QuickInsertItem) => {
    if (it.kind === 'image') {
      window.dispatchEvent(new CustomEvent('mxwp:open-image-picker'))
      onInserted?.({ kind: 'image' })
      return
    }
    const block = it.build()
    if (!block || !etag || !targetSectionId) return
    try {
      const result = await insertBlock(
        slug,
        { section_id: targetSectionId, block },
        etag,
        `${it.label} 추가`,
      )
      apply(result.document, result.etag)
      onInserted?.(block)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }

  return (
    <div
      data-quick-insert-bar
      role="toolbar"
      aria-label="빠른 블록 삽입"
      className="-mx-4 flex items-stretch gap-1 overflow-x-auto border-t border-gray-200 bg-white/95 px-4 py-1.5 text-xs sm:-mx-6 sm:px-6"
    >
      {items.map((it) => {
        const glow = it.kind === 'image' && clipboardHasImage
        return (
          <button
            key={it.kind}
            type="button"
            onClick={() => void onPick(it)}
            aria-label={it.label}
            title={glow ? '붙여넣은 이미지 추가' : undefined}
            data-kind={it.kind}
            data-clipboard-glow={glow ? '' : undefined}
            className={
              'inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-gray-700 transition-all hover:-translate-y-px hover:border-smsg-500 hover:bg-smsg-50 hover:text-smsg-900' +
              (glow
                ? ' border-smsg-500 bg-smsg-50 text-smsg-900 ring-2 ring-smsg-300 ring-offset-1 animate-pulse'
                : '')
            }
          >
            <span aria-hidden className="text-sm leading-none">{it.icon}</span>
            <span>{it.label}</span>
          </button>
        )
      })}
    </div>
  )
}
