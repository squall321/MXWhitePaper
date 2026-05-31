import type { ParagraphBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'
import { useT } from '@/lib/i18n'

/**
 * Footnote definition pattern. A paragraph whose text starts with `[^TAG]: `
 * is treated as a footnote definition (pandoc-style). The capture groups are
 * `[1]=tag` and `[2]=body`.
 */
const FOOTNOTE_DEF_RE = /^\[\^([A-Za-z0-9-]+)\]:\s+([\s\S]+)$/

/**
 * Detect a footnote-definition paragraph. Exported so SectionRenderer can
 * collect definitions across all paragraphs in a section.
 */
export function parseFootnoteDefinition(
  text: string,
): { tag: string; body: string } | null {
  const m = text.match(FOOTNOTE_DEF_RE)
  if (!m) return null
  return { tag: m[1] ?? '', body: m[2] ?? '' }
}

/**
 * Speaker-note convention. A paragraph whose `meta.note` begins with
 * `speaker:` (or equals `speaker-note`) is presenter-only content: the body
 * lives in `block.text`, but it is hidden from normal read mode AND from the
 * slide body. It surfaces only in PresenterView's notes pane.
 */
export function isSpeakerNoteParagraph(meta?: { note?: string } | undefined): boolean {
  const note = meta?.note
  if (!note) return false
  return note === 'speaker-note' || note.startsWith('speaker:')
}

/**
 * Paragraph block — `\n\n` separates paragraphs. Each paragraph runs through
 * the inline parser (markdown-lite + WikiLink).
 *
 * Special case: a paragraph carrying `meta.note === 'page-break-before'` is
 * rendered as a visible separator in the editor; the HTML export adds the
 * CSS `page-break-before: always` directly. We keep the dotted line so the
 * author can see where pages will split.
 *
 * Footnote definitions: a paragraph whose text starts with `[^TAG]: …` is a
 * pandoc-style footnote definition. By default we hide it from the read-mode
 * output because `<SectionRenderer>` already collects all definitions into a
 * "각주" mini-list at the bottom of the section (no duplication). Edit-mode
 * surfaces (`InlineTextBlockEditor`) still see the raw text untouched.
 *
 * Speaker notes: a paragraph whose `meta.note` starts with `speaker:` (or
 * equals `speaker-note`) is presenter-only. It is hidden from read mode AND
 * from the slide body — it surfaces only in PresenterView's notes pane.
 * Edit-mode surfaces still see the raw text untouched.
 */
export function ParagraphBlockView({ block }: { block: ParagraphBlock }) {
  const t = useT()
  if (isSpeakerNoteParagraph(block.meta)) {
    return null
  }
  if (block.meta?.note === 'page-break-before') {
    return (
      <div
        data-page-break
        className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 select-none dark:text-gray-500"
        aria-label={t('block.paragraph.pageBreakAria')}
      >
        <span className="h-px flex-1 border-t border-dashed border-gray-300 dark:border-gray-600" />
        <span>{t('block.paragraph.pageBreakAria')}</span>
        <span className="h-px flex-1 border-t border-dashed border-gray-300 dark:border-gray-600" />
      </div>
    )
  }

  // If the entire paragraph is a footnote definition, render nothing here —
  // SectionRenderer handles it in its section-bottom "각주" list. Keeping the
  // raw markdown out of the read view avoids visual duplication while leaving
  // the source unchanged for the editor.
  const fnDef = parseFootnoteDefinition(block.text)
  if (fnDef) {
    return null
  }

  const paragraphs = block.text.split(/\n{2,}/)
  return (
    <div className="space-y-3 text-[15px] leading-7 text-smsg-900 break-words">
      {paragraphs.map((p, i) => (
        <p key={i}>
          <Inline text={p} />
        </p>
      ))}
    </div>
  )
}
