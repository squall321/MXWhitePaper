/**
 * Footnote / endnote keyboard shortcut helper.
 *
 * The user's "직관적인 각주 추가" workflow:
 *   1. caret sits anywhere in a paragraph
 *   2. press Ctrl+Alt+F (각주) or Ctrl+Alt+E (미주)
 *   3. `[^N]` (or `[^en-N]`) is inserted at the caret
 *   4. a `[^N]: ` (or `[^en-N]: `) definition paragraph is appended to the
 *      enclosing section
 *   5. focus jumps to the definition paragraph so the user can type the
 *      content immediately
 *
 * The marker syntax matches what `Inline.tsx` and `SectionRenderer.tsx`
 * already understand — definition paragraphs are auto-collected into the
 * section-bottom note list, the inline `[^N]` becomes a clickable link
 * that scrolls to the right anchor.
 *
 * The actual `insertBlock` round-trip and focus management live in
 * `addFootnoteOrEndnote` (called from the editor's keymap).
 */
import type { Block, DocumentJSONV10 } from '@/types/document'

/**
 * Walk every paragraph in the doc and find the highest existing footnote
 * ordinal. Returns N+1 (or 1 when no notes yet). Endnotes use the
 * `en-N` namespace, so they're counted independently.
 */
export function nextNoteOrdinal(
  draft: DocumentJSONV10 | null | undefined,
  kind: 'footnote' | 'endnote',
): number {
  if (!draft) return 1
  // Two patterns we honour:
  //   `[^N]` / `[^N]: …` (footnote)
  //   `[^en-N]` / `[^en-N]: …` (endnote)
  const re = kind === 'endnote'
    ? /\[\^en-(\d+)(?:\]|\])/g
    : /\[\^(\d+)\]/g
  let max = 0
  const visit = (text: string) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  const walkBlocks = (blocks: Block[]) => {
    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'paragraph' && typeof b.text === 'string') visit(b.text)
      // Containers (columns/tabs/accordion) carry nested blocks — recurse.
      if (b.type === 'columns') {
        for (const col of b.columns ?? []) walkBlocks(col as Block[])
      } else if (b.type === 'tabs') {
        for (const tab of b.tabs ?? []) walkBlocks(tab.blocks ?? [])
      } else if (b.type === 'accordion') {
        for (const item of b.items ?? []) walkBlocks(item.blocks ?? [])
      }
    }
  }
  const walkSections = (
    secs: { blocks?: Block[]; subsections?: typeof secs }[] | undefined,
  ): void => {
    if (!Array.isArray(secs)) return
    for (const s of secs) {
      if (s?.blocks) walkBlocks(s.blocks)
      if (s?.subsections) walkSections(s.subsections)
    }
  }
  walkSections(draft.sections as never)
  return max + 1
}

/**
 * Build the marker fragment that lands at the caret. `kind === "footnote"`
 * → `[^N]`, `kind === "endnote"` → `[^en-N]`.
 */
export function noteMarker(kind: 'footnote' | 'endnote', ordinal: number): string {
  return kind === 'endnote' ? `[^en-${ordinal}]` : `[^${ordinal}]`
}

/**
 * Tag used in the definition paragraph (`[^TAG]: …`). Same as the marker
 * tag minus the surrounding brackets.
 */
export function noteTag(kind: 'footnote' | 'endnote', ordinal: number): string {
  return kind === 'endnote' ? `en-${ordinal}` : String(ordinal)
}
