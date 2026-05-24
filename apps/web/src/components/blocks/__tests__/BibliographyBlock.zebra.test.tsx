import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BibliographyBlockView } from '../BibliographyBlock'
import type { BibliographyBlock } from '@/types/document'

// The reference entries pass through <Inline /> which reads the glossary
// store via react-query; stub it the same way ListBlock.test.tsx does.
vi.mock('@/features/glossary/useGlossary', () => ({
  useGlossary: () => ({
    terms: [],
    lookup: () => undefined,
    findEntry: () => undefined,
  }),
}))

const block: BibliographyBlock = {
  type: 'bibliography',
  id: '01TESTBLOCK000000000000BZ',
  entries: [
    { text: 'A.' },
    { text: 'B.' },
    { text: 'C.' },
    { text: 'D.' },
  ],
}

describe('<BibliographyBlockView /> zebra-striping', () => {
  it('default ON — odd entries (idx 1, 3) carry bg-gray-50', () => {
    const html = renderToStaticMarkup(<BibliographyBlockView block={block} />)
    const matches = html.match(/bg-gray-50/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('options.stripe=false suppresses zebra', () => {
    const html = renderToStaticMarkup(
      <BibliographyBlockView block={{ ...block, options: { stripe: false } }} />,
    )
    expect(html).not.toContain('bg-gray-50')
  })
})
