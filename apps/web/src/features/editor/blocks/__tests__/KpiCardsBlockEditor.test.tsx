import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KpiCardsBlockEditor, trendFromDelta } from '../KpiCardsBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { KpiCardsBlock } from '@/types/document'

const block: KpiCardsBlock = {
  type: 'kpi-cards',
  id: '01TESTBLOCK000000000000KPI',
  items: [
    { label: '매출', value: 100 },
    { label: 'NPS', value: 42, delta: '+5%' },
  ],
}

describe('trendFromDelta', () => {
  it('positive number → up', () => {
    expect(trendFromDelta(5)).toBe('up')
    expect(trendFromDelta('+5%')).toBe('up')
  })
  it('negative → down', () => {
    expect(trendFromDelta(-3)).toBe('down')
    expect(trendFromDelta('-3%')).toBe('down')
  })
  it('zero → flat', () => {
    expect(trendFromDelta(0)).toBe('flat')
  })
  it('undefined / non-numeric → undefined', () => {
    expect(trendFromDelta(undefined)).toBeUndefined()
    expect(trendFromDelta('???')).toBeUndefined()
  })
})

describe('<KpiCardsBlockEditor /> static render', () => {
  it('renders a row per item with edit fields', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(<KpiCardsBlockEditor slug="test" block={block} />)
    expect(html).toContain('aria-label="kpi 0 label"')
    expect(html).toContain('aria-label="kpi 0 value"')
    expect(html).toContain('aria-label="kpi 0 delta"')
    expect(html).toContain('aria-label="kpi 1 label"')
    expect(html).toContain('+ KPI 추가')
  })

  it('surfaces ZebraToggle for the kpi-cards blockType', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(<KpiCardsBlockEditor slug="test" block={block} />)
    expect(html).toContain('data-zebra-toggle="kpi-cards"')
  })

  it('preview applies blue zebra to odd cards when stripe is on', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(<KpiCardsBlockEditor slug="test" block={block} />)
    expect(html).toContain('bg-[var(--smsg-blue-050)]')
  })

  it('preview skips zebra when options.stripe is false', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const blockOff: KpiCardsBlock = { ...block, options: { stripe: false } }
    const html = renderToStaticMarkup(<KpiCardsBlockEditor slug="test" block={blockOff} />)
    expect(html).not.toContain('bg-[var(--smsg-blue-050)]')
  })
})
