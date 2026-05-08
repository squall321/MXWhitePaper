import type { Block } from '@/types/document'
import { BlockRenderer } from '@/components/blocks/BlockRenderer'

interface SlideBlockRendererProps {
  block: Block
}

/**
 * Wraps the standard read-mode BlockRenderer with slide-friendly typography.
 *
 * The wrapper applies a `prose-slide` class which the Presentation page
 * styles via global CSS (larger fonts, taller line-height, max-width).
 * We deliberately reuse the existing block components instead of forking
 * them so the SSOT block grammar stays as the single render path.
 */
export function SlideBlockRenderer({ block }: SlideBlockRendererProps) {
  return (
    <div className="prose-slide" data-block-type={block.type}>
      <BlockRenderer block={block} />
    </div>
  )
}
