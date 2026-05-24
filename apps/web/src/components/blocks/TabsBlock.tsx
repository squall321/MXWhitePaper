import { useState } from 'react'
import type { TabsBlock } from '@/types/document'
import { BlockRenderer } from './BlockRenderer'

export function TabsBlockView({ block }: { block: TabsBlock }) {
  const [active, setActive] = useState(0)
  const tabs = block.tabs ?? []
  const tab = tabs[active] ?? tabs[0]
  return (
    <div className="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div role="tablist" className="flex flex-wrap gap-1 border-b border-gray-200 p-1 text-xs dark:border-gray-700">
        {tabs.map((t, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={active === i}
            onClick={() => setActive(i)}
            className={
              'rounded px-2 py-1 ' +
              (active === i
                ? 'bg-smsg-700 text-white'
                : 'text-gray-700 hover:bg-smsg-100 dark:text-gray-300')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="space-y-3 p-3">
        {(tab?.blocks ?? []).map((b) => (
          <BlockRenderer key={b.id} block={b} />
        ))}
      </div>
    </div>
  )
}
