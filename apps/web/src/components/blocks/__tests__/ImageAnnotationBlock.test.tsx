/**
 * ImageAnnotationBlock — read-mode rendering test.
 *
 * Builds a block exercising every annotation kind (arrow / rect / callout)
 * and asserts the SVG output contains the expected primitives. We use
 * `renderToStaticMarkup` (no jsdom) — same harness as the rest of this repo.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImageAnnotationBlockView } from '../ImageAnnotationBlock'
import type { ImageAnnotationBlock } from '@/types/document'

function harness(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

const block: ImageAnnotationBlock = {
  type: 'image-annotation',
  id: '01TESTBLOCK000000000000IA1',
  imageId: '01TESTIMAGE000000000000IA1',
  caption: '예제 이미지 주석',
  annotations: [
    {
      kind: 'arrow',
      id: 'ann-arrow-1',
      from: { x: 0.1, y: 0.1 },
      to: { x: 0.4, y: 0.3 },
      color: '#dc2626',
      label: '메인 카메라',
    },
    {
      kind: 'rect',
      id: 'ann-rect-1',
      x: 0.5,
      y: 0.2,
      w: 0.2,
      h: 0.15,
      color: '#2563eb',
      label: '지문센서',
    },
    {
      kind: 'callout',
      id: 'ann-call-1',
      x: 0.6,
      y: 0.7,
      anchor: { x: 0.45, y: 0.55 },
      label: '여기 마감 확인',
      color: '#16a34a',
    },
  ],
}

describe('<ImageAnnotationBlockView />', () => {
  it('renders the caption', () => {
    const html = renderToStaticMarkup(harness(<ImageAnnotationBlockView block={block} />))
    expect(html).toContain('예제 이미지 주석')
  })

  it('emits a normalised viewBox so coords scale with the image', () => {
    const html = renderToStaticMarkup(harness(<ImageAnnotationBlockView block={block} />))
    expect(html).toContain('viewBox="0 0 1 1"')
  })

  it('renders an arrow with marker-end + label', () => {
    const html = renderToStaticMarkup(harness(<ImageAnnotationBlockView block={block} />))
    expect(html).toContain('data-el-id="ann-arrow-1"')
    expect(html).toContain('marker-end="url(#ia-arrow)"')
    expect(html).toContain('메인 카메라')
  })

  it('renders a rect with stroke + label', () => {
    const html = renderToStaticMarkup(harness(<ImageAnnotationBlockView block={block} />))
    expect(html).toContain('data-el-id="ann-rect-1"')
    expect(html).toContain('<rect')
    expect(html).toContain('지문센서')
  })

  it('renders a callout with anchor line + bubble text', () => {
    const html = renderToStaticMarkup(harness(<ImageAnnotationBlockView block={block} />))
    expect(html).toContain('data-el-id="ann-call-1"')
    expect(html).toContain('여기 마감 확인')
    // anchor connecting line uses dashed stroke
    expect(html).toMatch(/stroke-dasharray="0\.01 0\.005"/)
  })

  it('emits the arrow-marker <defs> exactly once', () => {
    const html = renderToStaticMarkup(harness(<ImageAnnotationBlockView block={block} />))
    const occurrences = html.match(/id="ia-arrow"/g) ?? []
    expect(occurrences.length).toBe(1)
  })

  it('renders even when annotations is empty', () => {
    const empty: ImageAnnotationBlock = { ...block, annotations: [] }
    const html = renderToStaticMarkup(harness(<ImageAnnotationBlockView block={empty} />))
    expect(html).toContain('<svg')
    expect(html).not.toContain('data-el-id')
  })

  it('preserves z-order (later annotations appear after earlier ones in markup)', () => {
    const html = renderToStaticMarkup(harness(<ImageAnnotationBlockView block={block} />))
    const idxArrow = html.indexOf('ann-arrow-1')
    const idxCallout = html.indexOf('ann-call-1')
    expect(idxArrow).toBeGreaterThan(0)
    expect(idxCallout).toBeGreaterThan(idxArrow)
  })
})
