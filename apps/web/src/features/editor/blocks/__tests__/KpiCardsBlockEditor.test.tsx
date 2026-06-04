import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KpiCardsBlockEditor, trendFromDelta } from '../KpiCardsBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { KpiCardsBlock } from '@/types/document'

// I (cycle b) — KpiCardsBlockView (안의 preview) 가 useQuery 호출.
function ssr(node: ReactNode): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
}

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
    const html = ssr(<KpiCardsBlockEditor slug="test" block={block} />)
    expect(html).toContain('aria-label="kpi 0 label"')
    expect(html).toContain('aria-label="kpi 0 value"')
    expect(html).toContain('aria-label="kpi 0 delta"')
    expect(html).toContain('aria-label="kpi 1 label"')
    expect(html).toContain('+ KPI 추가')
  })

  it('surfaces ZebraToggle for the kpi-cards blockType', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = ssr(<KpiCardsBlockEditor slug="test" block={block} />)
    expect(html).toContain('data-zebra-toggle="kpi-cards"')
  })

  it('preview applies blue zebra to odd cards when stripe is on', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = ssr(<KpiCardsBlockEditor slug="test" block={block} />)
    expect(html).toContain('bg-[var(--smsg-blue-050)]')
  })

  it('preview skips zebra when options.stripe is false', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const blockOff: KpiCardsBlock = { ...block, options: { stripe: false } }
    const html = ssr(<KpiCardsBlockEditor slug="test" block={blockOff} />)
    expect(html).not.toContain('bg-[var(--smsg-blue-050)]')
  })

  describe('sparkline color swatches', () => {
    const blockWithSpark: KpiCardsBlock = {
      type: 'kpi-cards',
      id: '01TESTBLOCK000000000000KPI',
      items: [
        { label: 'DAU', value: 1230, sparkline: { values: [1, 2, 3, 4] } },
        { label: 'Revenue', value: '4.2M' },
      ],
    }

    it('renders a swatch row per item that has a sparkline (and not for items without)', () => {
      useEditorStore.getState().reset()
      useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
      const html = ssr(
        <KpiCardsBlockEditor slug="test" block={blockWithSpark} />,
      )
      // Item 0 has sparkline → swatch row present (editor area only — preview
      // never renders the swatches so both occurrences must be the editor row).
      expect(html).toContain('data-testid="kpi-sparkline-color-0"')
      // Item 1 has no sparkline → no swatch row
      expect(html).not.toContain('data-testid="kpi-sparkline-color-1"')
    })

    it('exposes all four preset color swatches as buttons with aria-labels', () => {
      useEditorStore.getState().reset()
      useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
      const html = ssr(
        <KpiCardsBlockEditor slug="test" block={blockWithSpark} />,
      )
      expect(html).toContain('aria-label="kpi 0 sparkline color #1428A0"')
      expect(html).toContain('aria-label="kpi 0 sparkline color #10B981"')
      expect(html).toContain('aria-label="kpi 0 sparkline color #F59E0B"')
      expect(html).toContain('aria-label="kpi 0 sparkline color #DC2626"')
    })

    it('exposes a custom hex input alongside the presets', () => {
      useEditorStore.getState().reset()
      useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
      const html = ssr(
        <KpiCardsBlockEditor slug="test" block={blockWithSpark} />,
      )
      expect(html).toContain('aria-label="kpi 0 sparkline color custom"')
    })

    it('marks the active preset with aria-pressed="true" when sparkline.color matches', () => {
      useEditorStore.getState().reset()
      useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
      const active: KpiCardsBlock = {
        ...blockWithSpark,
        items: [
          {
            label: 'DAU',
            value: 1230,
            sparkline: { values: [1, 2, 3], color: '#10B981' },
          },
        ],
      }
      const html = ssr(<KpiCardsBlockEditor slug="test" block={active} />)
      expect(html).toMatch(
        /aria-label="kpi 0 sparkline color #10B981"[^>]*aria-pressed="true"/,
      )
      // Other presets must be aria-pressed="false"
      expect(html).toMatch(
        /aria-label="kpi 0 sparkline color #1428A0"[^>]*aria-pressed="false"/,
      )
    })

    it('renders the clear button only when sparkline.color is set', () => {
      useEditorStore.getState().reset()
      useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
      const noColor = ssr(
        <KpiCardsBlockEditor slug="test" block={blockWithSpark} />,
      )
      expect(noColor).not.toContain('aria-label="kpi 0 sparkline color clear"')

      const withColor: KpiCardsBlock = {
        ...blockWithSpark,
        items: [
          {
            label: 'DAU',
            value: 1230,
            sparkline: { values: [1, 2, 3], color: '#1428A0' },
          },
        ],
      }
      const html = ssr(<KpiCardsBlockEditor slug="test" block={withColor} />)
      expect(html).toContain('aria-label="kpi 0 sparkline color clear"')
    })
  })
})
