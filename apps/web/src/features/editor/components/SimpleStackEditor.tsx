import { useCallback, useEffect, useRef, useState } from 'react'
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
import { patchSection, isPreconditionFailed, deleteBlock, insertBlock } from '../api'
import { useEditorStore } from '../state'
import { useBulkSelectionStore } from '../bulkSelectionStore'
import { BlockHoverInserter } from './BlockHoverInserter'
import { BlockInsertPalette, type PaletteItem } from './BlockInsertPalette'
import { InlineFormattingToolbar } from './InlineFormattingToolbar'
import { BlockRenderer } from '@/components/blocks/BlockRenderer'
import { useSectionCollapseStore } from '../sectionCollapseStore'
import { cloneBlockWithNewIds, looksLikeBlockArray } from './BulkActionsBar'
import { htmlToBlocks } from '../paste/htmlPaste'
import { rehydratePastedImages } from '../paste/imageRehydrate'
import { looksLikeCsv, parseCsv } from '../extensions/csv-paste'
import { ulid } from '../ulid'
import { toast } from '@/components/ui/Toast'
import { SnippetPicker } from '@/features/block-library/SnippetPicker'

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
  const selected = useBulkSelectionStore((s) => s.selected)
  const toggleSel = useBulkSelectionStore((s) => s.toggle)
  const setManySel = useBulkSelectionStore((s) => s.setMany)
  const clearSel = useBulkSelectionStore((s) => s.clear)

  const [title, setTitle] = useState(section.title)
  const [titleDirty, setTitleDirty] = useState(false)

  // Trailing palette state — for the empty-section CTA + final "add at end".
  const [tailOpen, setTailOpen] = useState<{ x: number; y: number } | null>(null)
  const [snippetTailOpen, setSnippetTailOpen] = useState(false)

  // Anchor block id for shift+click range select. Reset on clear() / Esc.
  const lastAnchorRef = useRef<Ulid | null>(null)

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
      if (it.kind === 'snippet') {
        setSnippetTailOpen(true)
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

  /**
   * Handle a click on a block's checkbox / left-edge target. Plain click
   * toggles just that block; shift+click selects the range from the previous
   * anchor; ctrl/cmd+click toggles a single block (same as plain click but
   * does NOT update the anchor — matches macOS Finder semantics).
   */
  const onBlockSelectClick = useCallback(
    (blockId: Ulid, ev: React.MouseEvent) => {
      const idx = blocks.findIndex((b) => b.id === blockId)
      if (idx < 0) return
      const isShift = ev.shiftKey
      const isMod = ev.metaKey || ev.ctrlKey
      if (isShift && lastAnchorRef.current) {
        const anchorIdx = blocks.findIndex((b) => b.id === lastAnchorRef.current)
        if (anchorIdx >= 0) {
          const lo = Math.min(anchorIdx, idx)
          const hi = Math.max(anchorIdx, idx)
          const range = blocks.slice(lo, hi + 1).map((b) => b.id)
          // Merge with existing selection so chained shift-clicks accumulate.
          const merged = new Set([...Array.from(selected), ...range])
          setManySel(Array.from(merged))
          return
        }
      }
      if (isMod) {
        toggleSel(blockId)
        return
      }
      // Plain click — toggle and set this block as the new anchor.
      toggleSel(blockId)
      lastAnchorRef.current = blockId
    },
    [blocks, selected, toggleSel, setManySel],
  )

  /**
   * Click on the editor surface BACKGROUND (not on a block / button / input)
   * clears the selection. We listen on the section root and bail out if the
   * click came from inside a block wrapper.
   */
  const onSurfaceMouseDown = useCallback(
    (ev: React.MouseEvent<HTMLElement>) => {
      const t = ev.target as HTMLElement | null
      if (!t) return
      if (t.closest('[data-sortable-block-id]')) return
      if (t.closest('button, input, a, [role="button"], textarea, select')) return
      if (t.closest('[data-bulk-keep]')) return
      clearSel()
      lastAnchorRef.current = null
    },
    [clearSel],
  )

  /**
   * Keyboard handler — global within this section's lifecycle. Suppressed
   * while the user is typing in any contentEditable / input / textarea so
   * we don't steal "a" or "Backspace" from the inline editor.
   */
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false
      if (t.isContentEditable) return true
      const tag = t.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    function onKey(ev: KeyboardEvent) {
      const mod = ev.metaKey || ev.ctrlKey
      // Esc clears regardless of focus — common UX expectation.
      if (ev.key === 'Escape') {
        if (useBulkSelectionStore.getState().size() > 0) {
          ev.preventDefault()
          clearSel()
          lastAnchorRef.current = null
        }
        return
      }
      if (isTypingTarget(ev.target)) return

      // Cmd/Ctrl+A — select all blocks in this section. Multiple sections may
      // be mounted; each registers this handler. To keep behaviour sane we
      // only act when the focus / pointer is inside this section's root.
      if (mod && (ev.key === 'a' || ev.key === 'A')) {
        ev.preventDefault()
        setManySel(blocks.map((b) => b.id))
        return
      }
      // Delete / Backspace — bulk delete. Only fires when there's a
      // selection so we don't surprise the user with a stray Backspace.
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && useBulkSelectionStore.getState().size() > 0) {
        ev.preventDefault()
        const sel = Array.from(useBulkSelectionStore.getState().selected)
        ;(async () => {
          for (const id of sel) {
            const tag = useEditorStore.getState().etag
            if (!tag) break
            try {
              const result = await deleteBlock(slug, id, tag, '여러 블록 삭제')
              apply(result.document, result.etag)
            } catch (err) {
              if (isPreconditionFailed(err)) setConflict(null)
              break
            }
          }
          clearSel()
        })()
        return
      }
      // Cmd/Ctrl+D — duplicate selection. Spec requires this shortcut.
      if (mod && (ev.key === 'd' || ev.key === 'D') && useBulkSelectionStore.getState().size() > 0) {
        ev.preventDefault()
        const sel = Array.from(useBulkSelectionStore.getState().selected)
        ;(async () => {
          for (const id of sel) {
            const doc = useEditorStore.getState().draft
            const tag = useEditorStore.getState().etag
            if (!doc || !tag) break
            // Locate the block in this section's current snapshot.
            const idx = blocks.findIndex((b) => b.id === id)
            if (idx < 0) continue
            const original = blocks[idx]
            if (!original) continue
            try {
              const result = await insertBlock(
                slug,
                {
                  section_id: section.id,
                  index: idx + 1,
                  block: cloneBlockWithNewIds(original),
                },
                tag,
                '여러 블록 복제',
              )
              apply(result.document, result.etag)
            } catch (err) {
              if (isPreconditionFailed(err)) setConflict(null)
              break
            }
          }
          clearSel()
        })()
        return
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blocks, slug, section.id, apply, setConflict, clearSel, setManySel])

  /**
   * Sequentially insert a list of blocks at the end of the section. Returns
   * the (possibly cloned) blocks that landed so the caller can kick off
   * post-insert work (image rehydration, etc.). Pulled out of the paste
   * handler so the multi-block cross-component event can reuse it.
   */
  const insertManyAtEnd = useCallback(
    async (arr: Block[], changeLog: string): Promise<Block[]> => {
      const inserted: Block[] = []
      for (const b of arr) {
        const tag = useEditorStore.getState().etag
        if (!tag) break
        const cloned = cloneBlockWithNewIds(b)
        try {
          const result = await insertBlock(
            slug,
            { section_id: section.id, index: -1, block: cloned },
            tag,
            changeLog,
          )
          apply(result.document, result.etag)
          inserted.push(cloned)
        } catch (err) {
          if (isPreconditionFailed(err)) setConflict(null)
          break
        }
      }
      return inserted
    },
    [slug, section.id, apply, setConflict],
  )

  /**
   * Ctrl/Cmd+V handler scoped to this section. Recognises three clipboard
   * shapes, in priority order:
   *
   *   1. Bulk-clipboard JSON Block[] — from a "클립보드에 복사" action.
   *      Confirm + insert at end of section.
   *   2. text/html (and not just span-wrapped plain text) — convert via
   *      `htmlToBlocks` and insert each as a Block. Image blocks with
   *      `meta.note: "src:<url>"` get rehydrated in the background.
   *   3. text/plain CSV-shaped — confirm "표로 변환?" → insert a table block.
   *
   * Anything else falls through to the default browser paste (which will be
   * handled by the inline editor's own onPaste if focus is inside one).
   */
  const onPaste = useCallback(
    async (ev: React.ClipboardEvent<HTMLElement>) => {
      // Bail if the user is typing inside a contentEditable / input — let the
      // native paste run (the inline editor handles HTML there).
      const t = ev.target as HTMLElement | null
      if (t?.isContentEditable) return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return

      const cd = ev.clipboardData
      const text = cd?.getData('text/plain') ?? ''
      const html = cd?.getData('text/html') ?? ''

      // 1. Bulk-clipboard JSON Block[] — checked first so it wins over HTML
      //    when our own copy action put both formats on the clipboard.
      if (text.trim().startsWith('[')) {
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          parsed = null
        }
        if (looksLikeBlockArray(parsed)) {
          ev.preventDefault()
          const arr = parsed as Block[]
          if (!window.confirm(`${arr.length}개 블록 붙여넣기?`)) return
          await insertManyAtEnd(arr, '클립보드에서 붙여넣기')
          return
        }
      }

      // 2. Rich HTML — Word / Notion / web. Skip when the only thing in the
      //    HTML is a single <span> wrapper around plain text (Slack does
      //    this and we'd rather treat it as plain).
      if (html && isRichHtml(html)) {
        ev.preventDefault()
        const { blocks, warnings } = htmlToBlocks(html)
        if (warnings.length > 0) {
          for (const w of warnings.slice(0, 3)) toast.warn(w)
        }
        if (blocks.length === 0) return
        const inserted = await insertManyAtEnd(blocks, 'HTML 붙여넣기')
        rehydratePastedImages(slug, inserted)
        return
      }

      // 3. Plain-text CSV. Looser test than rich HTML — only fires for
      //    multi-line text with consistent delimiters.
      if (text && looksLikeCsv(text)) {
        const parsed = parseCsv(text)
        if (parsed) {
          ev.preventDefault()
          if (!window.confirm('표로 변환할까요?')) {
            // Decline — just insert as a paragraph (preserves user choice).
            await insertManyAtEnd(
              [{ type: 'paragraph', id: ulid(), text } as Block],
              '평문 붙여넣기',
            )
            return
          }
          const tableBlock: Block = {
            type: 'table',
            id: ulid(),
            headers: parsed.headers,
            rows: parsed.rows,
          }
          await insertManyAtEnd([tableBlock], 'CSV 붙여넣기')
          return
        }
      }
    },
    [slug, insertManyAtEnd],
  )

  /**
   * Cross-component paste handoff: when the inline contentEditable's paste
   * decides the HTML payload represents multiple blocks, it dispatches a
   * `mxwp:paste-multi-blocks` event with `{detail: {blocks, sectionId}}`.
   * We catch it here, ignore other sections' events, and insert at end.
   */
  useEffect(() => {
    function onMulti(ev: Event) {
      const ce = ev as CustomEvent<{ blocks: Block[]; sectionId: Ulid }>
      if (!ce.detail || ce.detail.sectionId !== section.id) return
      const arr = ce.detail.blocks
      if (!Array.isArray(arr) || arr.length === 0) return
      void (async () => {
        const inserted = await insertManyAtEnd(arr, 'HTML 붙여넣기')
        rehydratePastedImages(slug, inserted)
      })()
    }
    window.addEventListener('mxwp:paste-multi-blocks', onMulti as EventListener)
    return () =>
      window.removeEventListener('mxwp:paste-multi-blocks', onMulti as EventListener)
  }, [section.id, insertManyAtEnd, slug])

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
      data-section-id={section.id}
      data-section-level={section.level}
      className="space-y-3"
      onMouseDown={onSurfaceMouseDown}
      onPaste={(e) => void onPaste(e)}
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
                      isSelected={selected.has(block.id)}
                      onSelectClick={(ev) => onBlockSelectClick(block.id, ev)}
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

      {snippetTailOpen && (
        <SnippetPicker
          onClose={() => setSnippetTailOpen(false)}
          onInsert={async (snippetBlocks) => {
            // Append each snippet block at the section's current tail. Each
            // POST returns a fresh etag chained into the next iteration.
            for (const b of snippetBlocks) {
              const tag = useEditorStore.getState().etag
              if (!tag) break
              try {
                const result = await insertBlock(
                  slug,
                  { section_id: section.id, block: b },
                  tag,
                  '스니펫 삽입',
                )
                apply(result.document, result.etag)
              } catch (err) {
                if (isPreconditionFailed(err)) setConflict(null)
                break
              }
            }
            setSnippetTailOpen(false)
          }}
        />
      )}

      {/* Floating inline-formatting toolbar — listens to selection changes
          inside any [data-inline-text-editor] in this section. Renders a
          single instance regardless of how many text blocks are present. */}
      <InlineFormattingToolbar />
    </section>
  )
}

/**
 * Heuristic to decide whether a `text/html` clipboard payload is rich
 * enough to be worth running through `htmlToBlocks`. Slack copies plain
 * text wrapped in a single `<span>` (or even `<meta>` + `<span>`) — those
 * shouldn't trigger our paragraph-splitting machinery. We require at least
 * one block-level tag.
 */
function isRichHtml(html: string): boolean {
  if (!html || html.length === 0) return false
  // Cheap regex; avoids paying for the full tokenizer twice.
  return /<(p|h[1-6]|ul|ol|li|table|tr|blockquote|pre|img|figure|hr|br|div|article|section)\b/i.test(
    html,
  )
}

interface SortableBlockProps {
  slug: Slug
  sectionId: Ulid
  index: number
  block: Block
  onDelete: () => void
  isSelected: boolean
  onSelectClick: (ev: React.MouseEvent) => void
}

function SortableBlock({
  slug,
  sectionId,
  index,
  block,
  onDelete,
  isSelected,
  onSelectClick,
}: SortableBlockProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      data-sortable-block-id={block.id}
      data-bulk-selected={isSelected ? 'true' : undefined}
      className={`group/sortable relative ${isSelected ? 'ring-2 ring-smsg-500 rounded-md' : ''}`}
    >
      {/* Bulk-selection checkbox. Sits to the left of the existing drag-handle
          rail so it doesn't fight for the same gutter pixels. Click handler
          handles plain / shift / ctrl click variants. The checkbox stays
          visible while the block is selected so users can see the affordance. */}
      <label
        data-testid="bulk-select-checkbox"
        data-bulk-keep
        className={`absolute -left-12 top-1.5 inline-flex h-5 w-5 cursor-pointer items-center justify-center transition-opacity group-hover/sortable:opacity-100 focus-within:opacity-100 ${
          isSelected ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => undefined /* onClick drives state to access shiftKey */}
          onClick={(e) => {
            e.stopPropagation()
            onSelectClick(e)
          }}
          aria-label="블록 선택"
          className="h-4 w-4 rounded border-gray-300 text-smsg-600 focus:ring-smsg-500"
        />
      </label>
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
