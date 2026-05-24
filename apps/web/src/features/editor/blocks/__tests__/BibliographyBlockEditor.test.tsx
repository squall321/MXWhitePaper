import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BibliographyBlockEditor } from '../BibliographyBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { BibliographyBlock } from '@/types/document'

const block: BibliographyBlock = {
  type: 'bibliography',
  id: '01TESTBLOCK000000000000BIB',
  title: '참고문헌',
  entries: [{ text: 'Smith, J. (2020). Foo bar.' }],
}

describe('<BibliographyBlockEditor /> static render', () => {
  it('surfaces the ZebraToggle for the bibliography blockType', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(
      <BibliographyBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('data-zebra-toggle="bibliography"')
  })

  it('checkbox checked by default when options is undefined', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(
      <BibliographyBlockEditor slug="test" block={block} />,
    )
    // ZebraToggle wraps the checkbox in a <label data-zebra-toggle=...>
    const idx = html.indexOf('data-zebra-toggle="bibliography"')
    expect(idx).toBeGreaterThan(-1)
    const snippet = html.slice(idx, idx + 300)
    expect(snippet).toContain('checked=""')
  })
})
