import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { OrgChartBlockView } from '../OrgChartBlock'
import type { OrgChartBlock } from '@/types/document'

const tree: OrgChartBlock = {
  type: 'org-chart',
  id: '01TESTBLOCK00000000000ORG1',
  root: {
    id: 'ceo',
    label: 'CEO',
    role: 'Chief',
    children: [
      { id: 'cto', label: 'CTO', role: 'Tech' },
      { id: 'cfo', label: 'CFO', role: 'Finance' },
    ],
  },
}

const empty: OrgChartBlock = {
  type: 'org-chart',
  id: '01TESTBLOCK00000000000ORG2',
  root: undefined as unknown as OrgChartBlock['root'],
}

describe('<OrgChartBlockView /> darkmode tokens', () => {
  it('emits SVG colours as CSS tokens', () => {
    const html = renderToStaticMarkup(<OrgChartBlockView block={tree} />)
    // Inactive edge / node border
    expect(html).toContain('stroke="var(--smsg-gray-300)"')
    expect(html).toContain('stroke="var(--smsg-gray-500)"')
    // Node fill (inactive)
    expect(html).toContain('fill="var(--smsg-surface)"')
    // Label / role text
    expect(html).toContain('fill="var(--smsg-gray-900)"')
    expect(html).toContain('fill="var(--smsg-gray-700)"')

    // No legacy slate hex should remain
    expect(html).not.toContain('#CBD5E1')
    expect(html).not.toContain('#94A3B8')
    expect(html).not.toContain('#0F172A')
    expect(html).not.toContain('#475569')
    expect(html).not.toContain('#FFFFFF')
  })

  it('figure declares dark-mode variants', () => {
    const html = renderToStaticMarkup(<OrgChartBlockView block={tree} />)
    expect(html).toContain('dark:bg-gray-900')
    expect(html).toContain('dark:border-gray-700')
  })

  it('empty-state placeholder declares dark variants', () => {
    const html = renderToStaticMarkup(<OrgChartBlockView block={empty} />)
    expect(html).toContain('dark:bg-gray-800')
    expect(html).toContain('dark:border-gray-600')
    expect(html).toContain('dark:text-gray-400')
  })
})
