import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuickInsertBar } from '../QuickInsertBar'
import { useEditorStore } from '@/features/editor/state'

describe('<QuickInsertBar /> static render', () => {
  it('renders the 12 default block buttons with Korean labels', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(<QuickInsertBar slug="test" />)
    // Spot-check a few labels.
    expect(html).toContain('글</span>')
    expect(html).toContain('표</span>')
    expect(html).toContain('차트')
    expect(html).toContain('이미지')
    expect(html).toContain('체크리스트')
    expect(html).toContain('수식')
    // role/aria.
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('data-quick-insert-bar')
  })

  it('exposes a button per kind via data-kind', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(<QuickInsertBar slug="test" />)
    for (const kind of [
      'paragraph',
      'table',
      'chart',
      'image',
      'gallery',
      'callout',
      'code',
      'quote',
      'list',
      'math',
      'video',
      'file',
    ]) {
      expect(html).toContain(`data-kind="${kind}"`)
    }
  })
})
