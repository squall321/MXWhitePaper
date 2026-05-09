import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { DocumentJSONV10 } from '@/types/document'

// vi.mock is hoisted before module-level `const`s, so the fixture must live
// inside vi.hoisted() to be safe to reference from the factory.
const { fixtureDoc } = vi.hoisted(() => {
  const fixtureDoc: DocumentJSONV10 = {
  schema_version: '1.0',
  id: '01TESTDOC0000000000000000Z',
  slug: 'fixture-vars',
  title: '변수 픽스처',
  metadata: {
    division: 'MX',
    owners: ['someone@example.com'],
    tags: [],
    confidentiality: 'internal',
  },
  sections: [
    {
      id: '01SEC00000000000000000000A',
      number: '1',
      level: 1,
      title: '본문',
      blocks: [
        {
          type: 'paragraph',
          id: '01P000000000000000000000A1',
          text: '안녕 {{user}}, 오늘은 {{date|미정}}입니다.',
        },
        {
          type: 'list',
          id: '01L000000000000000000000A2',
          style: 'bullet',
          items: ['카운트: {{count}}', '카운트: {{count}}'],
        },
        // code block must be ignored by the collector — `{{secret}}` here
        // should NOT show up in the editor.
        {
          type: 'code',
          id: '01C000000000000000000000A3',
          language: 'python',
          code: 'print("{{secret}}")',
        },
      ],
      subsections: [],
    },
  ],
  variables: { user: '홍길동' },
} as never
  return { fixtureDoc }
})

vi.mock('@/features/document/hooks/useDocument', () => ({
  // The DocumentResult type asks for `row: DocumentRow`, but the page only
  // reads `document` + `meta.etag` so an `as never` keeps the test focused.
  useDocument: () =>
    ({
      data: { document: fixtureDoc, meta: { etag: '"abc:1"' }, row: {} },
      isPending: false,
      isError: false,
    } as never),
}))

vi.mock('@/features/editor/state', () => {
  const draft = fixtureDoc
  const etag = '"abc:1"'
  const state = {
    draft,
    etag,
    applyServerSnapshot: vi.fn(),
    setConflict: vi.fn(),
  }
  return {
    useEditorStore: Object.assign(
      <T,>(selector: (s: typeof state) => T): T => selector(state),
      { getState: () => state, setState: () => {} },
    ),
    editorSelectors: {},
  }
})

import { DocumentVariablesPage, collectVariables } from '../DocumentVariables'

describe('collectVariables()', () => {
  it('collects every {{var}} from paragraphs, lists, and tables', () => {
    const tokens = collectVariables(fixtureDoc)
    expect(tokens).toContain('user')
    expect(tokens).toContain('date')
    expect(tokens).toContain('count')
  })

  it('deduplicates repeated occurrences', () => {
    // `count` appears twice in the list; collector emits it once.
    const tokens = collectVariables(fixtureDoc)
    const occurrences = tokens.filter((t) => t === 'count').length
    expect(occurrences).toBe(1)
  })

  it('skips code blocks', () => {
    const tokens = collectVariables(fixtureDoc)
    expect(tokens).not.toContain('secret')
  })
})

function renderPage(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/docs/fixture-vars/variables']}>
      <Routes>
        <Route
          path="/docs/:slug/variables"
          element={<DocumentVariablesPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('<DocumentVariablesPage />', () => {
  it('lists every {{var}} discovered in the document', () => {
    const html = renderPage()
    expect(html).toContain('{{user}}')
    expect(html).toContain('{{date}}')
    expect(html).toContain('{{count}}')
  })

  it('renders an input pre-filled from doc.variables for known keys', () => {
    const html = renderPage()
    // `user` is set to "홍길동" in the fixture; the input should show it.
    expect(html).toContain('value="홍길동"')
  })

  it('exposes a 저장 button gated on etag presence', () => {
    const html = renderPage()
    expect(html).toContain('저장')
    expect(html).toContain('data-testid="save-variables"')
  })
})
