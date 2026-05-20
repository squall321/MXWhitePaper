import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Sparkline } from '../Sparkline'

describe('<Sparkline />', () => {
  it('returns null when data is empty', () => {
    const html = renderToStaticMarkup(
      <Sparkline data={[]} ariaLabel="empty sparkline" />,
    )
    expect(html).toBe('')
  })

  it('renders an svg with one path, role="img", and aria-label when given 7 data points', () => {
    const data = [42, 48, 55, 60, 68, 75, 86]
    const html = renderToStaticMarkup(
      <Sparkline data={data} width={80} height={20} ariaLabel="7-day trend" />,
    )
    expect(html).toContain('<svg')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="7-day trend"')
    expect(html).toContain('<path')
    // only one path element
    expect(html.match(/<path/g)?.length).toBe(1)
  })

  it('renders a flat line when all values are equal (range=1 fallback prevents division by zero)', () => {
    // data=[0,0,0,0] → min=0, max=Math.max(0,1)=1, range=Math.max(1-0,1)=1
    // y(0)=20-((0-0)/1)*20=20 for all points — flat line at bottom
    const data = [0, 0, 0, 0]
    const html = renderToStaticMarkup(
      <Sparkline data={data} width={80} height={20} ariaLabel="flat trend" />,
    )
    expect(html).toContain('<path')
    // All y values should be 20.0 (bottom of viewport) — flat horizontal line
    expect(html).toContain('20.0')
    // Verify path starts with M command
    expect(html).toMatch(/d="M [\d.]+/)
  })
})
