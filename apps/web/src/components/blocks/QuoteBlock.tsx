import type { QuoteBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'

/**
 * Block-quote with optional citation footer.
 */
export function QuoteBlockView({ block }: { block: QuoteBlock }) {
  return (
    <blockquote className="border-l-4 border-smsg-500 bg-smsg-100 px-4 py-2 text-[15px] italic text-smsg-900">
      <p>
        <Inline text={block.text} />
      </p>
      {block.cite && (
        <footer className="mt-1 text-xs not-italic text-gray-600">
          — {block.cite}
        </footer>
      )}
    </blockquote>
  )
}
