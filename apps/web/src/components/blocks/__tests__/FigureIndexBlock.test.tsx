import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FigureIndexBlockView } from '../FigureIndexBlock'

describe('<FigureIndexBlockView /> static render', () => {
  it('renders the explicit 갱신 button so users can force a refresh', () => {
    const html = renderToStaticMarkup(
      <FigureIndexBlockView block={{ title: '그림 목차' }} />,
    )
    expect(html).toContain('data-action="figure-index-refresh"')
    expect(html).toContain('갱신')
  })

  it('renders the empty-state copy when no captioned figures exist', () => {
    const html = renderToStaticMarkup(
      <FigureIndexBlockView block={{}} />,
    )
    // MutationObserver runs in useEffect → during SSR the initial walk
    // returns nothing; the empty-state line should still render.
    expect(html).toContain('이 문서에는 캡션이 달린')
  })

  it('uses the provided title when one is supplied', () => {
    const html = renderToStaticMarkup(
      <FigureIndexBlockView block={{ title: '내 목차' }} />,
    )
    expect(html).toContain('내 목차')
  })
})
