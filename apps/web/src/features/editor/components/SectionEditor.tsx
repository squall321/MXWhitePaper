import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useCreateBlockNote, SuggestionMenuController } from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import type { Block } from '@/types/document'
import { editorSchema } from '../blocknote-config'
import {
  blockNoteToDocumentJson,
  documentJsonToBlockNote,
  type BNBlock,
} from '../adapters'
import { buildSlashItems, type BNEditorLike } from './slash-menu-items'
import { EditorTriggerOverlay, type OverlaySelection } from '../extensions/WikiLinkSuggestion'
import { parseCsv } from '../extensions/csv-paste'
import { decideUrlPaste } from '../extensions/url-paste'

interface SectionEditorProps {
  /** Initial DocumentJSON Block array. */
  initialBlocks: Block[]
  /** Called on every change with the converted Block array. */
  onChange: (blocks: Block[]) => void
  /** Disable editing (e.g., locked sections). */
  readOnly?: boolean
  /**
   * If true (default in fullEdit) the editor auto-focuses its first block on
   * mount. Used to satisfy the "instant productivity" requirement when a fresh
   * doc lands on `/docs/:slug?fullEdit=1`.
   */
  autoFocus?: boolean
}

/**
 * Thin BlockNote wrapper. Owns no state of its own — purely controlled by the
 * parent through `initialBlocks` + `onChange`.
 *
 * Surface details:
 *   - Uses `@blocknote/mantine` for the styled view (Sprint 7 polish).
 *   - Custom slash menu wired through `SuggestionMenuController` so the menu
 *     opens inline at the caret with Korean labels and section grouping.
 *   - Editor card matches the article prose width (`max-w-prose`) and the
 *     `wp-editor-surface` class injects Samsung Blue accents via CSS vars.
 */
export function SectionEditor({
  initialBlocks,
  onChange,
  readOnly = false,
  autoFocus = false,
}: SectionEditorProps) {
  // Initial BN doc; useMemo so re-renders don't recreate the editor.
  const initial = useMemo<BNBlock[]>(() => documentJsonToBlockNote(initialBlocks), [])
  // BlockNote types are intentionally permissive at this boundary — its public
  // surface accepts plain block descriptors without forcing us to import the
  // generic instantiations.
  const editor = useCreateBlockNote({
    schema: editorSchema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initialContent: (initial.length > 0 ? (initial as unknown as any) : undefined),
  })

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!editor) return
    const unsub = (editor as { onChange: (cb: () => void) => () => void }).onChange(() => {
      // The runtime shape of a top-level BN block matches `BNBlock` enough
      // for the adapter; cast at the boundary.
      const top = (editor as unknown as { document: BNBlock[] }).document
      onChangeRef.current(blockNoteToDocumentJson(top))
    })
    return () => {
      try {
        unsub()
      } catch {
        /* noop */
      }
    }
  }, [editor])

  // First-paint focus: jump the cursor into the first block within ~100 ms so
  // the user can type immediately after navigating to a fresh doc.
  useEffect(() => {
    if (!editor || !autoFocus || readOnly) return
    const t = setTimeout(() => {
      try {
        ;(editor as unknown as { focus(): void }).focus()
      } catch {
        /* swallow — BN may not be mounted yet */
      }
    }, 50)
    return () => clearTimeout(t)
  }, [editor, autoFocus, readOnly])

  // ── Inline suggestion overlay + paste interception (Cycle 15) ──────────
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  /**
   * Replace the trigger text immediately preceding the caret with
   * `replacement`. Falls back gracefully when `Selection` / `Range` aren't
   * available (e.g. jsdom-less unit tests).
   */
  const insertAtCaret = useCallback((consume: number, replacement: string) => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return
    const offset = range.startOffset
    const start = Math.max(0, offset - consume)
    const text = (node.textContent ?? '')
    const next = text.slice(0, start) + replacement + text.slice(offset)
    node.textContent = next
    // Position the caret after the inserted text.
    const newOffset = start + replacement.length
    const newRange = document.createRange()
    newRange.setStart(node, Math.min(newOffset, next.length))
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
    // Notify ProseMirror via an input event so it picks up the DOM mutation.
    surfaceRef.current?.dispatchEvent(new InputEvent('input', { bubbles: true }))
  }, [])

  const handleSuggestionSelect = useCallback(
    (sel: OverlaySelection) => {
      const insertText = sel.item.insertText
      // The wiki-create fallback: redirect to /docs/new instead of inserting.
      if (insertText.startsWith('__create__')) {
        const slug = insertText.slice('__create__'.length)
        window.location.href = `/docs/new?slug=${encodeURIComponent(slug)}`
        return
      }
      insertAtCaret(sel.match.consume, insertText)
    },
    [insertAtCaret],
  )

  /**
   * Editor-level paste interception:
   *   - CSV → wrap in a hidden chip "표로 변환?" (yes inserts a `table` block).
   *     For now we just insert the table directly when no selection is set,
   *     since the Cycle 15 milestone is about the pipeline working end-to-end.
   *   - URL on selection → wrap the selection.
   *   - URL on bare line + internal slug → suggest `[[slug]]`.
   */
  const onPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const text = e.clipboardData.getData('text/plain')
      if (!text) return
      // 1) CSV first.
      const csv = parseCsv(text)
      if (csv) {
        // Defer to `editor.insertBlocks` if available.
        const ed = editor as unknown as BNEditorLike | undefined
        if (ed && typeof ed.insertBlocks === 'function') {
          e.preventDefault()
          const cur = ed.getTextCursorPosition?.()
          ed.insertBlocks(
            [
              {
                type: 'table',
                content: {
                  type: 'tableContent',
                  rows: [
                    { cells: csv.headers },
                    ...csv.rows.map((r) => ({ cells: r })),
                  ],
                },
              },
            ],
            cur?.block ?? { id: 'first' },
            'after',
          )
          return
        }
      }
      // 2) URL handling.
      const decision = decideUrlPaste({
        text,
        selection: window.getSelection()?.toString() ?? '',
        origin: typeof window !== 'undefined' ? window.location.origin : undefined,
      })
      if (decision.kind === 'wikilink' && decision.slug) {
        e.preventDefault()
        insertAtCaret(0, `[[${decision.slug}]]`)
      }
      // wrap / link / none → fall through to BlockNote default.
    },
    [editor, insertAtCaret],
  )

  /**
   * `[ ] ` at the start of a line converts to a check-list item. We listen
   * for the Space keystroke and inspect the four characters before the
   * caret. The conversion is a simple text replacement; BlockNote's input
   * rules will pick it up on the next render.
   */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== ' ') return
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return
    const before = (node.textContent ?? '').slice(0, range.startOffset)
    if (!/(^|\n)\[ \]$/.test(before)) return
    e.preventDefault()
    // Replace `[ ]` with empty string and let BlockNote's checkListItem
    // shortcut take over — easiest approach: dispatch a synthetic event
    // that mutates the type via the editor API.
    const ed = editor as unknown as BNEditorLike | undefined
    if (!ed) return
    const cur = ed.getTextCursorPosition?.()
    if (!cur) return
    // Strip the literal text from the line.
    insertAtCaret(3, '')
    ed.insertBlocks([{ type: 'checkListItem' }], cur.block, 'after')
  }, [editor, insertAtCaret])

  if (!editor) return null
  const isEmpty = initial.length === 0

  return (
    <div
      ref={surfaceRef}
      onPaste={onPaste}
      onKeyDown={onKeyDown}
      data-blocknote-surface
      className="wp-editor-surface relative rounded-md border border-smsg-100 bg-white"
    >
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <BlockNoteView
        editor={editor as any}
        editable={!readOnly}
        slashMenu={false}
        theme="light"
        className="wp-editor-view"
      >
        {/* Custom slash menu: groups + Korean labels + 영문 보조 + shortcuts. */}
        <SuggestionMenuController
          triggerCharacter={'/'}
          getItems={async (query) => {
            const items = buildSlashItems(editor as unknown as BNEditorLike, () => {
              // Focus pulse on the editor wrapper after insertion so the user
              // sees where the new block landed.
              const el = (document.querySelector(
                '[data-blocknote-surface]',
              ) as HTMLElement | null)
              if (el) {
                el.classList.add('wp-pulse')
                setTimeout(() => el.classList.remove('wp-pulse'), 600)
              }
            })
            const q = query.trim().toLowerCase()
            if (!q) return items
            return items.filter(
              (it) =>
                it.title.toLowerCase().includes(q) ||
                (it.aliases ?? []).some((a) => a.toLowerCase().includes(q)) ||
                (it.subtext ?? '').toLowerCase().includes(q),
            )
          }}
        />
      </BlockNoteView>

      {isEmpty && !readOnly && <EmptyEditorHint />}

      {/* Wiki / mention / emoji autocomplete (Cycle 15). */}
      {!readOnly && (
        <EditorTriggerOverlay hostRef={surfaceRef} onSelect={handleSuggestionSelect} />
      )}
    </div>
  )
}

/**
 * Soft inline ghost shown when the editor is mounted with zero blocks. Sits
 * inside the editor card and dims itself the moment the user starts typing.
 */
function EmptyEditorHint() {
  return (
    <div
      data-empty-editor-hint
      aria-hidden
      className="pointer-events-none absolute left-3 top-3 select-none text-sm text-gray-400 wp-empty-hint"
    >
      여기에 입력하거나 <kbd className="rounded border border-gray-300 px-1 font-mono text-[10px] text-gray-500">/</kbd>를 눌러 블록을 추가하세요
    </div>
  )
}

