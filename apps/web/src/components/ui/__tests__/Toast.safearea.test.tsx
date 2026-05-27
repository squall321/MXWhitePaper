import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToastProvider } from '../Toast'

/**
 * M8c — Toast container safe-area guard.
 *
 * The toast stack lives at the bottom-right of the viewport. On iPhone the
 * home indicator occupies ~34px at the bottom and landscape mode pushes the
 * right edge inward; pinning the stack to `bottom-4 right-4` clips that
 * affordance. The fix wraps the offsets in `max(1rem, env(safe-area-inset-*))`
 * inline so the position respects the device chrome.
 */
describe('<ToastProvider /> mobile safe-area guard', () => {
  it('declares safe-area-inset-bottom + right inline style', () => {
    const html = renderToStaticMarkup(<ToastProvider />)
    // Grab the outer container's style attribute (no other inline styles in this tree).
    const match = html.match(/style="([^"]*)"/)
    expect(match, 'ToastProvider root must declare safe-area inline style').toBeTruthy()
    const style = match?.[1] ?? ''
    expect(style).toContain('safe-area-inset-bottom')
    expect(style).toContain('safe-area-inset-right')
  })

  it('keeps the fixed-position / z-toast classes that anchor the stack', () => {
    const html = renderToStaticMarkup(<ToastProvider />)
    // Sanity — the safe-area refactor must not have stripped layout classes.
    expect(html).toMatch(/\bfixed\b/)
    expect(html).toMatch(/\bz-toast\b/)
  })
})
