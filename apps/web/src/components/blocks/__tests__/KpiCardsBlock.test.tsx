import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KpiCardsBlockView } from '../KpiCardsBlock'
import type { KpiCardsBlock } from '@/types/document'

const ID = (n: number) => '01HZX' + String(n).padStart(21, '0')

function block(items: KpiCardsBlock['items']): KpiCardsBlock {
  return { type: 'kpi-cards', id: ID(1), items }
}

describe('<KpiCardsBlockView /> — sparkline (WIDGET-09)', () => {
  it('omits sparkline svg when item has no sparkline field (backwards compat)', () => {
    const html = renderToStaticMarkup(
      <KpiCardsBlockView block={block([{ label: '매출', value: '1.2M' }])} />,
    )
    expect(html).toContain('매출')
    expect(html).toContain('1.2M')
    expect(html).not.toContain('<svg')
  })

  it('renders an inline sparkline svg (default line kind) when item.sparkline.values is set', () => {
    const html = renderToStaticMarkup(
      <KpiCardsBlockView
        block={block([
          {
            label: 'DAU',
            value: 1230,
            sparkline: { values: [10, 12, 14, 18, 22, 28] },
          },
        ])}
      />,
    )
    expect(html).toContain('<svg')
    expect(html).toContain('aria-label="DAU sparkline"')
    // default kind=line → path element
    expect(html).toContain('<path')
  })

  it('renders a bar sparkline with <rect> children when kind="bar"', () => {
    const html = renderToStaticMarkup(
      <KpiCardsBlockView
        block={block([
          {
            label: 'Revenue',
            value: '4.2M',
            sparkline: { values: [3, 4, 5, 6], kind: 'bar' },
          },
        ])}
      />,
    )
    expect(html).toContain('<svg')
    expect(html).not.toContain('<path')
    // 4 values → 4 rects
    expect(html.match(/<rect/g)?.length).toBe(4)
  })

  it('renders sparklines for multiple cards independently', () => {
    const html = renderToStaticMarkup(
      <KpiCardsBlockView
        block={block([
          { label: 'A', value: 1, sparkline: { values: [1, 2, 3] } },
          { label: 'B', value: 2 },
          { label: 'C', value: 3, sparkline: { values: [-1, 1, -1, 1], kind: 'win-loss' } },
        ])}
      />,
    )
    // A and C have svg; B does not
    expect(html.match(/<svg/g)?.length).toBe(2)
    expect(html).toContain('aria-label="A sparkline"')
    expect(html).toContain('aria-label="C sparkline"')
  })

  it('skips sparkline when values array is empty', () => {
    const html = renderToStaticMarkup(
      <KpiCardsBlockView
        block={block([{ label: 'Empty', value: 0, sparkline: { values: [] } }])}
      />,
    )
    expect(html).not.toContain('<svg')
  })

  describe('sparkline color forwarding (color-picker cycle)', () => {
    it('forwards `sparkline.color` to Sparkline (line stroke)', () => {
      const html = renderToStaticMarkup(
        <KpiCardsBlockView
          block={block([
            { label: 'Sales', value: 100, sparkline: { values: [1, 2, 3], color: '#1428A0' } },
          ])}
        />,
      )
      expect(html).toContain('stroke="#1428A0"')
    })

    it('forwards `sparkline.palette` to Sparkline bars', () => {
      const html = renderToStaticMarkup(
        <KpiCardsBlockView
          block={block([
            {
              label: 'Quarters',
              value: 'Q4',
              sparkline: {
                values: [10, 20, 30, 40],
                kind: 'bar',
                palette: ['#aa0000', '#00aa00'],
              },
            },
          ])}
        />,
      )
      // 4 bars cycling between two colors
      expect(html.match(/fill="#aa0000"/g)?.length).toBe(2)
      expect(html.match(/fill="#00aa00"/g)?.length).toBe(2)
    })
  })
})
