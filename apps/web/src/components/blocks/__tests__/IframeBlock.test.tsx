/**
 * IframeBlockView — SSR rendering smoke + placeholder fallback shape.
 * jsdom-free per project convention: we render to static markup and
 * inspect the HTML for the markers added by the iframe-placeholder-fallback
 * cycle (data-iframe-status, data-iframe-placeholder, "새 탭에서 열기"
 * link present only when the 4-second load timeout fires — which it
 * cannot during SSR, so SSR shows the 'loading' overlay).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IframeBlockView } from '../IframeBlock'
import type { IframeBlock } from '@/types/document'

describe('<IframeBlockView />', () => {
  it('html mode renders srcdoc iframe (no placeholder needed — content lives inside)', () => {
    const block: IframeBlock = {
      type: 'iframe',
      id: '01TESTBLOCK00000000000IFR1',
      html: '<p>hello</p>',
    }
    const html = renderToStaticMarkup(<IframeBlockView block={block} />)
    expect(html).toContain('srcDoc')
    expect(html).not.toContain('data-iframe-placeholder')
    expect(html).not.toContain('새 탭에서 열기')
  })

  it('src mode renders iframe + loading placeholder + hostname for friendly fallback', () => {
    const block: IframeBlock = {
      type: 'iframe',
      id: '01TESTBLOCK00000000000IFR2',
      src: 'https://example.com/demo',
      title: 'External Demo',
    }
    const html = renderToStaticMarkup(<IframeBlockView block={block} />)
    // The iframe itself is still rendered (browser may load it fine).
    expect(html).toContain('src="https://example.com/demo"')
    expect(html).toContain('data-iframe-status="loading"')
    // SSR cannot fire the 4s timeout — overlay is in 'loading' state.
    expect(html).toContain('data-iframe-placeholder="loading"')
    expect(html).toContain('임베드 불러오는 중')
    // Hostname extracted so user knows which site is being embedded.
    expect(html).toContain('example.com')
  })

  it('src mode keeps the figcaption when title is set', () => {
    const block: IframeBlock = {
      type: 'iframe',
      id: '01TESTBLOCK00000000000IFR3',
      src: 'https://example.com/',
      title: 'My Embed',
    }
    const html = renderToStaticMarkup(<IframeBlockView block={block} />)
    expect(html).toContain('<figcaption')
    expect(html).toContain('My Embed')
  })

  it('empty (no src, no html) renders the placeholder hint', () => {
    const block: IframeBlock = {
      type: 'iframe',
      id: '01TESTBLOCK00000000000IFR4',
    }
    const html = renderToStaticMarkup(<IframeBlockView block={block} />)
    expect(html).toContain('data-empty-iframe-block')
    expect(html).toContain('비어있는 임베드')
  })
})
