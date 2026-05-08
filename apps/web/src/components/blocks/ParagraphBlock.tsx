import type { ParagraphBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'

/**
 * Paragraph block — `\n\n` separates paragraphs. Each paragraph runs through
 * the inline parser (markdown-lite + WikiLink).
 */
export function ParagraphBlockView({ block }: { block: ParagraphBlock }) {
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
