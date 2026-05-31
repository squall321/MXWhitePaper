import { useRef, useState, type KeyboardEvent } from 'react'
import type { TabsBlock } from '@/types/document'
import { BlockRenderer } from './BlockRenderer'

/**
 * Tabs widget — WAI-ARIA tabs pattern (D3 / TABS-01).
 *
 * - role="tablist" wraps the trigger row, each trigger is role="tab"
 *   with stable id + aria-controls pointing at its panel.
 * - Single tabpanel (role="tabpanel", aria-labelledby on the active tab id)
 *   shows the active tab's blocks. We render one panel rather than a
 *   panel-per-tab so block ids stay unique across the article.
 * - Roving tabindex: only the active tab is in the tab order
 *   (`tabIndex={0}`); inactive tabs are `tabIndex={-1}` and reachable via
 *   ← → Home End from inside the tablist.
 */
export function TabsBlockView({ block }: { block: TabsBlock }) {
  const [active, setActive] = useState(0)
  const tabs = block.tabs ?? []
  const tab = tabs[active] ?? tabs[0]
  const tablistId = `tabs-${block.id}`
  const tabId = (i: number) => `${tablistId}-tab-${i}`
  const panelId = `${tablistId}-panel`
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const focusTab = (i: number) => {
    const next = (i + tabs.length) % tabs.length
    setActive(next)
    // Defer focus to after re-render — the inactive→active swap flips
    // tabIndex so the freshly-active button is focusable.
    queueMicrotask(() => refs.current[next]?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        focusTab(i + 1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        focusTab(i - 1)
        break
      case 'Home':
        e.preventDefault()
        focusTab(0)
        break
      case 'End':
        e.preventDefault()
        focusTab(tabs.length - 1)
        break
    }
  }

  return (
    <div className="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div
        role="tablist"
        id={tablistId}
        className="flex flex-wrap gap-1 border-b border-gray-200 p-1 text-xs dark:border-gray-700"
      >
        {tabs.map((t, i) => {
          const isActive = active === i
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              id={tabId(i)}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={panelId}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={
                'rounded px-2 py-1 ' +
                (isActive
                  ? 'bg-smsg-700 text-white'
                  : 'text-gray-700 hover:bg-smsg-100 dark:text-gray-300')
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tab ? tabId(active) : undefined}
        tabIndex={0}
        className="space-y-3 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-smsg-500"
      >
        {(tab?.blocks ?? []).map((b) => (
          <BlockRenderer key={b.id} block={b} />
        ))}
      </div>
    </div>
  )
}
