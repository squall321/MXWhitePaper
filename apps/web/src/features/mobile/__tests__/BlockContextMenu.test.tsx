import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BlockContextMenu,
  DEFAULT_ACTIONS,
  clampMenuPosition,
} from '../BlockContextMenu'

/**
 * Static-render checks for the long-press popover. Behavioural focus / outside-
 * click handling lives in the useEffect, which only runs in the browser and is
 * exercised by the e2e suite. For unit-level coverage we verify:
 *   - the menu renders nothing when closed
 *   - all six default actions appear with their `data-action` keys
 *   - the popover position is clamped within the viewport
 */
describe('clampMenuPosition (popover anchor math)', () => {
  it('keeps the popover inside the viewport on the right edge', () => {
    const r = clampMenuPosition({ x: 999, y: 100 }, { w: 360, h: 640 })
    // 360 - 200 - 8 = 152
    expect(r.left).toBe(152)
  })

  it('keeps the popover above the bottom edge', () => {
    const r = clampMenuPosition({ x: 100, y: 999 }, { w: 360, h: 640 })
    // 640 - 280 - 8 = 352
    expect(r.top).toBe(352)
  })

  it('respects the 8px gutter on the left/top edges', () => {
    const r = clampMenuPosition({ x: 0, y: 0 }, { w: 360, h: 640 })
    expect(r.left).toBe(8)
    expect(r.top).toBe(8)
  })
})

describe('<BlockContextMenu /> static markup', () => {
  it('renders nothing when closed', () => {
    const html = renderToStaticMarkup(
      <BlockContextMenu
        open={false}
        point={{ x: 50, y: 50 }}
        blockId="01HQ"
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(html).toBe('')
  })

  it('renders all default actions when open', () => {
    const html = renderToStaticMarkup(
      <BlockContextMenu
        open
        point={{ x: 50, y: 50 }}
        blockId="01HQ"
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(html).toContain('data-testid="block-context-menu"')
    expect(html).toContain('data-block-id="01HQ"')
    for (const action of DEFAULT_ACTIONS) {
      expect(html).toContain(`data-action="${action.key}"`)
      expect(html).toContain(action.label)
    }
  })

  it('marks disabled actions correctly', () => {
    const html = renderToStaticMarkup(
      <BlockContextMenu
        open
        point={{ x: 50, y: 50 }}
        blockId="01HQ"
        actions={[{ label: '복제', key: 'duplicate', disabled: true }]}
        onClose={() => {}}
        onAction={() => {}}
      />,
    )
    expect(html).toContain('disabled')
  })

  it('exposes default actions covering the bulk-actions surface', () => {
    const keys = DEFAULT_ACTIONS.map((a) => a.key)
    expect(keys).toEqual(['duplicate', 'delete', 'move-up', 'move-down', 'move-section', 'info'])
  })
})
