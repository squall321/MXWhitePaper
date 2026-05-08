import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { FlowBlockEditor, FLOW_TEMPLATES } from '../FlowBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { FlowBlock } from '@/types/document'

const block: FlowBlock = {
  type: 'flow',
  id: '01TESTBLOCK00000000000FLOW',
  engine: 'mermaid',
  source: '',
}

describe('FLOW_TEMPLATES', () => {
  it('exports six starter templates', () => {
    expect(FLOW_TEMPLATES.length).toBe(6)
    const ids = FLOW_TEMPLATES.map((t) => t.id)
    expect(ids).toEqual(['flowchart', 'sequence', 'class', 'state', 'gantt', 'er'])
  })
  it('every template has a non-empty Mermaid source', () => {
    for (const t of FLOW_TEMPLATES) {
      expect(t.source.length).toBeGreaterThan(0)
      expect(t.label.length).toBeGreaterThan(0)
    }
  })
})

describe('<FlowBlockEditor /> static render', () => {
  it('exposes the source textarea + template select', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(<FlowBlockEditor slug="test" block={block} />)
    expect(html).toContain('aria-label="flow source"')
    expect(html).toContain('aria-label="flow template"')
    expect(html).toContain('순서도')
    expect(html).toContain('시퀀스')
  })
})
