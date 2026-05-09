import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { makeQuestion, FormBlockEditor } from '../FormBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { FormBlock } from '@/types/document'

describe('makeQuestion', () => {
  it('creates a text question by default', () => {
    const q = makeQuestion('text')
    expect(q.kind).toBe('text')
    expect(q.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(q.label).toBeTruthy()
    expect(q.options).toBeUndefined()
  })
  it('seeds options for select/multi-select', () => {
    const a = makeQuestion('select')
    expect(a.options?.length).toBeGreaterThan(0)
    const b = makeQuestion('multi-select')
    expect(b.options?.length).toBeGreaterThan(0)
  })
})

describe('<FormBlockEditor /> smoke render', () => {
  it('renders without crashing and shows controls', () => {
    // Bind editor store with a synthetic doc + etag so persist() is a no-op.
    const block: FormBlock = {
      type: 'form',
      id: '01TESTFORMBLOCK000000000ED',
      title: 'Hi',
      questions: [
        { id: 'q1', kind: 'text', label: '이름', required: true },
      ],
    }
    useEditorStore.getState().bind(
      'sample-slug',
      {
        schema_version: '1.0',
        id: '01TESTDOC00000000000000000',
        slug: 'sample-slug',
        title: 't',
        metadata: {
          division: 'MX',
          owners: ['u'],
          tags: [],
          confidentiality: 'internal',
        },
        sections: [],
      } as never,
      'etag-123',
    )
    const html = renderToStaticMarkup(
      <FormBlockEditor slug="sample-slug" block={block} />,
    )
    expect(html).toContain('응답 보기')
    expect(html).toContain('질문 추가')
  })
})
