import type { CSSProperties } from 'react'
import type { Block, ColumnsBlock } from '@/types/document'
import { BlockRenderer } from './BlockRenderer'

/**
 * Multi-column layout. Renders each child Block via BlockRenderer.
 *
 * `block.widths` (optional, length == columns.length, sum ~100) drives the
 * grid template — `[30, 70]` ⇒ `30fr 70fr`. Without it columns split evenly.
 * The server normalises the sum so we just trust whatever lands here.
 */
export function ColumnsBlockView({ block }: { block: ColumnsBlock }) {
  const cols = block.columns.length
  const widths = Array.isArray(block.widths) && block.widths.length === cols
    ? block.widths
    : null
  const style: CSSProperties = widths
    ? { gridTemplateColumns: widths.map((w) => `${w}fr`).join(' ') }
    : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
  return (
    <div className="grid gap-4" style={style}>
      {block.columns.map((col, i) => (
        <div key={i} className="min-w-0 space-y-3">
          {(col as Block[]).map((b) => (
            <BlockRenderer key={b.id} block={b} />
          ))}
        </div>
      ))}
    </div>
  )
}
