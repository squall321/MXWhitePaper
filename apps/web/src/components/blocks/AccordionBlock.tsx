import type { AccordionBlock } from '@/types/document'
import { BlockRenderer } from './BlockRenderer'

export function AccordionBlockView({ block }: { block: AccordionBlock }) {
  return (
    <div className="space-y-1">
      {(block.items ?? []).map((item, i) => (
        <details
          key={i}
          className="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
        >
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-smsg-900 hover:bg-smsg-100">
            {item.label}
          </summary>
          <div className="space-y-3 border-t border-gray-100 p-3 dark:border-gray-800">
            {(item.blocks ?? []).map((b) => (
              <BlockRenderer key={b.id} block={b} />
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}
