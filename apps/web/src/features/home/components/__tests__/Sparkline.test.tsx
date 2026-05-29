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

  it('renders <rect> bars and no <path> when kind="bar"', () => {
    const data = [1, 2, 3, 4, 5]
    const html = renderToStaticMarkup(
      <Sparkline data={data} kind="bar" width={50} height={20} ariaLabel="bar trend" />,
    )
    expect(html).toContain('<svg')
    expect(html).not.toContain('<path')
    expect(html.match(/<rect/g)?.length).toBe(5)
  })

  it('renders win-loss bars skipping zeros and differentiating sign by y position', () => {
    const data = [2, -1, 0, 3, -2]
    const html = renderToStaticMarkup(
      <Sparkline data={data} kind="win-loss" width={50} height={20} ariaLabel="win-loss" />,
    )
    expect(html).toContain('<svg')
    // 4 non-zero values → 4 rects (0 skipped)
    expect(html.match(/<rect/g)?.length).toBe(4)
    // Sign differentiation: positives use opacity 0.9, negatives 0.55
    expect(html).toContain('opacity="0.9"')
    expect(html).toContain('opacity="0.55"')
  })

  describe('color override', () => {
    it('line kind — color prop sets path stroke (and currentColor disappears)', () => {
      const html = renderToStaticMarkup(
        <Sparkline
          data={[1, 2, 3]}
          kind="line"
          color="#1428A0"
          ariaLabel="line color override"
        />,
      )
      expect(html).toContain('stroke="#1428A0"')
      expect(html).not.toContain('stroke="currentColor"')
    })

    it('bar kind — color prop fills every rect uniformly', () => {
      const html = renderToStaticMarkup(
        <Sparkline
          data={[1, 2, 3, 4]}
          kind="bar"
          color="#10B981"
          ariaLabel="bar color override"
        />,
      )
      // 4 rects, all the same color
      expect(html.match(/fill="#10B981"/g)?.length).toBe(4)
      expect(html).not.toContain('fill="currentColor"')
    })

    it('bar kind — palette cycles per bar (i % palette.length)', () => {
      const html = renderToStaticMarkup(
        <Sparkline
          data={[1, 2, 3, 4, 5]}
          kind="bar"
          palette={['#aa0000', '#00aa00']}
          ariaLabel="bar palette cycle"
        />,
      )
      // 5 bars with 2-color palette → indices 0,2,4 = red; 1,3 = green
      expect(html.match(/fill="#aa0000"/g)?.length).toBe(3)
      expect(html.match(/fill="#00aa00"/g)?.length).toBe(2)
    })

    it('bar kind — palette wins over color when both supplied', () => {
      const html = renderToStaticMarkup(
        <Sparkline
          data={[1, 2]}
          kind="bar"
          color="#1428A0"
          palette={['#aa0000', '#00aa00']}
          ariaLabel="bar palette priority"
        />,
      )
      expect(html).not.toContain('fill="#1428A0"')
      expect(html).toContain('fill="#aa0000"')
      expect(html).toContain('fill="#00aa00"')
    })

    it('win-loss kind — color prop fills all rects (same color, opacity differs)', () => {
      const html = renderToStaticMarkup(
        <Sparkline
          data={[2, -1, 3, -2]}
          kind="win-loss"
          color="#7C3AED"
          ariaLabel="win-loss color override"
        />,
      )
      expect(html.match(/fill="#7C3AED"/g)?.length).toBe(4)
      // opacity still differentiates positives (0.9) from negatives (0.55)
      expect(html).toContain('opacity="0.9"')
      expect(html).toContain('opacity="0.55"')
    })

    it('win-loss kind — palette is ignored (only color applies)', () => {
      const html = renderToStaticMarkup(
        <Sparkline
          data={[2, -1, 3]}
          kind="win-loss"
          palette={['#aa0000', '#00aa00']}
          ariaLabel="win-loss palette ignored"
        />,
      )
      // palette not applied → fall back to currentColor
      expect(html).not.toContain('fill="#aa0000"')
      expect(html).not.toContain('fill="#00aa00"')
      expect(html).toContain('fill="currentColor"')
    })
  })
})
