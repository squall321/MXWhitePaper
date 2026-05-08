import type { Heading4Block } from '@/types/document'

/**
 * Heading-4 block — sub-section heading inside a level-3 section. NOT
 * surfaced in the TOC (TOC walks Section nodes only).
 */
export function Heading4BlockView({ block }: { block: Heading4Block }) {
  return (
    <h4 className="mt-4 text-base font-semibold text-smsg-900">
      {block.title}
    </h4>
  )
}
