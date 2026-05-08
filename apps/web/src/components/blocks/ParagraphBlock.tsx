import type { ParagraphBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'

/**
 * Paragraph block — `\n\n` separates paragraphs. Each paragraph runs through
 * the inline parser (markdown-lite + WikiLink).
 *
 * Special case: a paragraph carrying `meta.note === 'page-break-before'` is
 * rendered as a visible separator in the editor; the HTML export adds the
 * CSS `page-break-before: always` directly. We keep the dotted line so the
 * author can see where pages will split.
 */
export function ParagraphBlockView({ block }: { block: ParagraphBlock }) {
  if (block.meta?.note === 'page-break-before') {
    return (
      <div
        data-page-break
        className="my-3 flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-400 select-none"
        aria-label="페이지 나누기"
      >
        <span className="h-px flex-1 border-t border-dashed border-gray-300" />
        <span>페이지 나누기</span>
        <span className="h-px flex-1 border-t border-dashed border-gray-300" />
      </div>
    )
  }
  const paragraphs = block.text.split(/\n{2,}/)
  return (
    <div className="space-y-3 text-[15px] leading-7 text-smsg-900">
      {paragraphs.map((p, i) => (
        <p key={i}>
          <Inline text={p} />
        </p>
      ))}
    </div>
  )
}
