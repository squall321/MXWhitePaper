import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FigureIndexBlockEditor } from '../FigureIndexBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { FigureIndexBlock } from '@/types/document'

const block: FigureIndexBlock = {
  type: 'figure-index',
  id: '01TESTBLOCK000000000000FIG',
  title: '그림 목차',
}

describe('<FigureIndexBlockEditor /> static render', () => {
  it('surfaces the ZebraToggle for the figure-index blockType', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(
      <FigureIndexBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('data-zebra-toggle="figure-index"')
  })

  it('renders the title input bound to block.title', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(
      <FigureIndexBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('aria-label="그림 목차 제목"')
    expect(html).toContain('value="그림 목차"')
  })
})
