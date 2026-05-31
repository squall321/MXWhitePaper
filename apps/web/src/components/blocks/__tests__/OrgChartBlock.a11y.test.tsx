import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { OrgChartBlockView } from '../OrgChartBlock'
import type { OrgChartBlock } from '@/types/document'

const ID = '01TESTBLOCK00000000000ORG'

const FIXTURE: OrgChartBlock = {
  type: 'org-chart',
  id: ID,
  layout: 'tree',
  root: {
    id: 'r',
    label: 'CEO',
    role: 'Chief',
    children: [
      { id: 'a', label: 'Alice', role: 'Eng' },
      { id: 'b', label: 'Bob' },
    ],
  },
}

describe('OrgChartBlockView a11y (ORG-01)', () => {
  it('each interactive node is focusable and has role=button + descriptive aria-label', () => {
    const html = renderToStaticMarkup(<OrgChartBlockView block={FIXTURE} />)
    // tabIndex={0} renders as tabindex="0"
    expect(html.match(/tabindex="0"/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(html.match(/role="button"/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    // aria-label composes label + role when role is present
    expect(html).toContain('aria-label="CEO — Chief"')
    expect(html).toContain('aria-label="Alice — Eng"')
    // No role → just label
    expect(html).toContain('aria-label="Bob"')
  })

  it('svg root keeps its existing role=img + chart-level aria-label', () => {
    const html = renderToStaticMarkup(<OrgChartBlockView block={FIXTURE} />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="조직도"')
  })
})
