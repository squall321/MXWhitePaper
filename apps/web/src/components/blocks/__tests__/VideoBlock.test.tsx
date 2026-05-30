/**
 * VideoBlockView — SSR renders for native + YouTube + Vimeo with
 * `autoplay` / `controls` / `loop` reflected as attrs (native) and
 * embed URL query (YouTube / Vimeo).
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VideoBlockView } from '../VideoBlock'
import type { VideoBlock } from '@/types/document'

const ID = '01TESTBLOCK00000000000VB01'

function mk(over: Partial<VideoBlock>): VideoBlock {
  return {
    type: 'video',
    id: ID,
    url: 'https://example.com/x.mp4',
    provider: 'intra',
    ...over,
  } as VideoBlock
}

describe('<VideoBlockView /> native video', () => {
  it('default — controls on, no autoplay, no loop, no muted', () => {
    const html = renderToStaticMarkup(<VideoBlockView block={mk({})} />)
    expect(html).toContain('<video')
    expect(html).toContain('controls=""')
    expect(html).not.toContain('autoplay=""')
    expect(html).not.toContain('loop=""')
    expect(html).not.toContain('muted=""')
  })

  it('autoplay=true forces muted=true (browser policy)', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView block={mk({ autoplay: true })} />,
    )
    expect(html).toContain('autoplay=""')
    expect(html).toContain('muted=""')
  })

  it('controls=false removes the controls attr', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView block={mk({ controls: false })} />,
    )
    expect(html).not.toContain('controls=""')
  })

  it('loop=true emits loop attr', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView block={mk({ loop: true })} />,
    )
    expect(html).toContain('loop=""')
  })
})

describe('<VideoBlockView /> YouTube embed', () => {
  const base = mk({ provider: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' })

  it('default — no query params', () => {
    const html = renderToStaticMarkup(<VideoBlockView block={base} />)
    expect(html).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ"')
  })

  it('autoplay=true adds autoplay=1 + mute=1', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView block={{ ...base, autoplay: true }} />,
    )
    expect(html).toMatch(/embed\/dQw4w9WgXcQ\?[^"]*autoplay=1/)
    expect(html).toMatch(/embed\/dQw4w9WgXcQ\?[^"]*mute=1/)
  })

  it('controls=false adds controls=0', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView block={{ ...base, controls: false }} />,
    )
    expect(html).toMatch(/controls=0/)
  })

  it('loop=true adds loop=1 + playlist={id}', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView block={{ ...base, loop: true }} />,
    )
    expect(html).toMatch(/loop=1/)
    expect(html).toMatch(/playlist=dQw4w9WgXcQ/)
  })

  it('all options combined produces all 4 query params', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView
        block={{ ...base, autoplay: true, controls: false, loop: true }}
      />,
    )
    expect(html).toMatch(/autoplay=1/)
    expect(html).toMatch(/mute=1/)
    expect(html).toMatch(/controls=0/)
    expect(html).toMatch(/loop=1/)
  })
})

describe('<VideoBlockView /> Vimeo embed', () => {
  const base = mk({ provider: 'vimeo', url: 'https://player.vimeo.com/video/12345' })

  it('default — no autoplay or loop query', () => {
    const html = renderToStaticMarkup(<VideoBlockView block={base} />)
    expect(html).toContain('src="https://player.vimeo.com/video/12345')
    expect(html).not.toMatch(/autoplay=1/)
    expect(html).not.toMatch(/loop=1/)
  })

  it('autoplay=true adds autoplay=1 + muted=1', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView block={{ ...base, autoplay: true }} />,
    )
    expect(html).toMatch(/autoplay=1/)
    expect(html).toMatch(/muted=1/)
  })

  it('loop=true adds loop=1', () => {
    const html = renderToStaticMarkup(
      <VideoBlockView block={{ ...base, loop: true }} />,
    )
    expect(html).toMatch(/loop=1/)
  })
})
