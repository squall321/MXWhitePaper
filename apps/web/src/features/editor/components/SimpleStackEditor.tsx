import { useCallback, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Block, Slug, Ulid } from '@/types/document'
import type { AnySection } from '../api'
import { patchSection, isPreconditionFailed, deleteBlock } from '../api'
import { useEditorStore } from '../state'
import { BlockHoverInserter } from './BlockHoverInserter'
import { BlockInsertPalette, type PaletteItem } from './BlockInsertPalette'
import { InlineFormattingToolbar } from './InlineFormattingToolbar'
import { BlockRenderer } from '@/components/blocks/BlockRenderer'
import { useSectionCollapseStore } from '../sectionCollapseStore'

/**
 * SimpleStackEditor — Notion-style block stack with drag-to-reorder and
 * hover `+` rails on every block. Replaces the BlockNote-based
 * `SectionInlineEdit` for users who hate the slash menu.
 *
 *   ┌──────── + ─────────┐    ← top rail (visible on hover/focus)
 *   │ ⋮ ▢ block1         │    ← left drag handle, right edge = delete
 *   │       ┌─ + ─┐      │    ← bottom rail = top rail of block2
 *   │ ⋮ ▢ block2         │
 *   └──────── + ─────────┘    ← trailing + always visible
 *
 * Behaviour:
 *   - + opens `BlockInsertPalette` at click coords. Pick a block kind →
 *     `insertBlock` POST with the right `index`.
 *   - Drag to reorder → optimistically reorder locally, fire `patchSection`
 *     with the full new block list. Rollback on conflict.
 *   - Empty section gets a big `+` placeholder so first-time users have a
 *     hook (the original BlockNote editor relied on the slash menu, which
 *     the user explicitly rejected).
 *
 * Text-block inline editing (paragraph, heading-4, etc.) is delegated to
 * `BlockRenderer` so existing block-editor modals (chart, image, etc.) still
 * open on click. For paragraph/heading-4/quote/callout we surface a small
 * inline contentEditable inside the same wrapper.
 */

interface Props {
  slug: Slug
  section: AnySection
  /** Auto-focus the title input on mount (used for the very first section). */
  autoFocusTitle?: boolean
}

export function SimpleStackEditor({ slug, section, autoFocusTitle }: Props) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [title, setTitle] = useState(section.title)
  const [titleDirty, setTitleDirty] = useState(false)

  // Trailing palette state — for the empty-section CTA + final "add at end".
  const [tailOpen, setTailOpen] = useState<{ x: number; y: number } | null>(null)

  const blocks = section.blocks ?? []

  // Section-level collapse — same store as the read-mode SectionRenderer so a
  // user who collapsed a section in reader stays collapsed when they enter
  // full-edit. We hide the blocks list but keep title + trailing "+" visible
  // (clicking "+" auto-expands the section so users never get stuck).
  const collapsed = useSectionCollapseStore((s) => s.isCollapsed(slug, section.id))
  const setCollapsed = useSectionCollapseStore((s) => s.setCollapsed)
  const toggleCollapsed = useSectionCollapseStore((s) => s.toggle)
  const blocksPanelId = `section-stack-panel-${section.id}`

  const persistTitle = useCallback(async () => {
    if (!etag || !titleDirty) return
    try {
      const result = await patchSection(slug, section.id, { title }, etag, '섹션 제목 수정')
      apply(result.document, result.etag)
      setTitleDirty(false)
    } catch (err) {
      if (isPreconditionFailed(err)) setConflict(null)
    }
  }, [etag, slug, section.id, title, titleDirty, apply, setConflict])

  const onPickTail = useCallback(
    async (it: PaletteItem) => {
      if (it.kind === 'image') {
        window.dispatchEvent(new CustomEvent('mxwp:open-image-picker'))
        setTailOpen(null)
        return
      }
      const block = it.build()
      if (!block || !etag) {
        setTailOpen(null)
        return
      }
      try {
        const result = await patchSection(
          slug,
          section.id,
          { blocks: [...blocks, block] },
          etag,
          `${it.label} 추가`,
        )
        apply(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      } finally {
        setTailOpen(null)
      }
    },
    [etag, slug, section.id, blocks, apply, setConflict],
  )

  const onDelete = useCallback(
    async (blockId: Ulid) => {
      if (!etag) return
      try {
        const result = await deleteBlock(slug, blockId, etag, '블록 삭제')
        apply(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      }
    },
    [etag, slug, apply, setConflict],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id || !etag) return
      const oldIdx = blocks.findIndex((b) => b.id === active.id)
      const newIdx = blocks.findIndex((b) => b.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return
      const reordered = arrayMove(blocks, oldIdx, newIdx)
      try {
        const result = await patchSection(
          slug,
          section.id,
          { blocks: reordered },
          etag,
          '블록 순서 변경',
        )
        apply(result.document, result.etag)
      } catch (err) {
        if (isPreconditionFailed(err)) setConflict(null)
      }
    },
    [blocks, etag, slug, section.id, apply, setConflict],
  )

  const onTrailingClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    // If the section was collapsed, expand it before opening the palette so
    // the user can see the inserted block land in context.
    if (collapsed) setCollapsed(slug, section.id, false)
    setTailOpen({ x: e.clientX || r.left + 24, y: e.clientY || r.bottom })
  }

  return (
    <section
      data-simple-stack-editor
      data-section-level={section.level}
      className="space-y-3"
    >
      <div className="group flex items-baseline gap-2">
        <button
          type="button"
          onClick={() => toggleCollapsed(slug, section.id)}
          aria-label={collapsed ? '섹션 펴기' : '섹션 접기'}
          aria-expanded={!collapsed}
          aria-controls={blocksPanelId}
          data-testid="section-collapse-toggle"
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-smsg-500 transition-transform hover:bg-smsg-50 hover:text-smsg-900"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="2,4 6,8 10,4" />
          </svg>
        </button>
        {section.number && (
          <span className="font-mono text-sm text-smsg-500">{section.number}</span>
        )}
        <input
          autoFocus={autoFocusTitle}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-2xl font-semibold text-smsg-900 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none dark:focus:bg-gray-900"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            setTitleDirty(true)
          }}
          onBlur={() => void persistTitle()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              void persistTitle()
              ;(e.currentTarget as HTMLInputElement).blur()
            }
          }}
          aria-label="섹션 제목"
        />
      </div>

      {!collapsed && (
        blocks.length === 0 ? (
          <button
            type="button"
            onClick={onTrailingClick}
            className="group flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-8 text-sm text-gray-500 transition-colors hover:border-smsg-300 hover:bg-smsg-50 hover:text-smsg-900 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
            aria-label="첫 블록 추가"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-smsg-500 text-smsg-700 group-hover:bg-smsg-500 group-hover:text-white">
              +
            </span>
            첫 블록 추가
          </button>
        ) : (
          <div id={blocksPanelId}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
              <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-4 pl-7 pr-7">
                  {blocks.map((block, idx) => (
                    <SortableBlock
                      key={block.id}
                      slug={slug}
                      sectionId={section.id}
                      index={idx}
                      block={block}
                      onDelete={() => void onDelete(block.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        )
      )}

      {collapsed && blocks.length > 0 && (
        <p className="pl-7 text-xs text-gray-500" aria-live="polite">
          ({blocks.length}개 항목 접힘)
        </p>
      )}

      {blocks.length > 0 && (
        <div className="pl-7 pr-7">
          <button
            type="button"
            onClick={onTrailingClick}
            className="group flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 px-4 py-2 text-xs text-gray-500 transition-colors hover:border-smsg-300 hover:bg-smsg-50 hover:text-smsg-900 dark:border-gray-700 dark:hover:bg-gray-800"
            aria-label="블록 추가"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-smsg-500 text-smsg-700 group-hover:bg-smsg-500 group-hover:text-white">
              +
            </span>
            블록 추가
          </button>
        </div>
      )}

      {tailOpen && (
        <BlockInsertPalette
          anchor={tailOpen}
          onPick={(it) => void onPickTail(it)}
          onClose={() => setTailOpen(null)}
        />
      )}

      {/* Floating inline-formatting toolbar — listens to selection changes
          inside any [data-inline-text-editor] in this section. Renders a
          single instance regardless of how many text blocks are present. */}
      <InlineFormattingToolbar />
    </section>
  )
}

interface SortableBlockProps {
  slug: Slug
  sectionId: Ulid
  index: number
  block: Block
  onDelete: () => void
}

function SortableBlock({ slug, sectionId, index, block, onDelete }: SortableBlockProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} data-sortable-block-id={block.id}>
      <BlockHoverInserter
        slug={slug}
        sectionId={sectionId}
        index={index}
        active
        block={block}
        dragListeners={listeners as Record<string, unknown>}
        dragSetActivatorRef={setActivatorNodeRef}
        onRequestDelete={onDelete}
      >
        <BlockRenderer block={block} />
      </BlockHoverInserter>
    </div>
  )
}
