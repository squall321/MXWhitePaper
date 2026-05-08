import type { Block, ColumnsBlock } from '@/types/document'
import { BlockRenderer } from './BlockRenderer'

/**
 * Multi-column layout. Renders each child Block via BlockRenderer.
 */
export function ColumnsBlockView({ block }: { block: ColumnsBlock }) {
  const cols = block.columns.length
  const gridClass = cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-4'
  return (
    <div className={`grid gap-4 ${gridClass}`}>
      {block.columns.map((col, i) => (
        <div key={i} className="space-y-3">
          {(col as Block[]).map((b) => (
            <BlockRenderer key={b.id} block={b} />
          ))}
        </div>
      ))}
    </div>
  )
}
