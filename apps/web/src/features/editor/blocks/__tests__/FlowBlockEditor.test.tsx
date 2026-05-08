import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FlowBlockEditor,
  FLOW_KINDS,
  FLOW_EXAMPLES,
  detectKind,
} from '../FlowBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { FlowBlock } from '@/types/document'

const block: FlowBlock = {
  type: 'flow',
  id: '01TESTBLOCK00000000000FLOW',
  engine: 'mermaid',
  source: '',
}

describe('FLOW_KINDS', () => {
  it('exposes the 8 mermaid kinds we expect', () => {
    const ids = FLOW_KINDS.map((k) => k.id)
    expect(ids).toEqual([
      'flowchart',
      'sequence',
      'class',
      'state',
      'gantt',
      'mindmap',
      'pie',
      'journey',
    ])
  })

  it('every kind has a starter source + label', () => {
    for (const k of FLOW_KINDS) {
      expect(k.source.length).toBeGreaterThan(0)
      expect(k.label.length).toBeGreaterThan(0)
      expect(k.detect.length).toBeGreaterThan(0)
    }
  })
})

describe('FLOW_EXAMPLES', () => {
  it('exposes 3 ready-to-paste cheat-sheet samples', () => {
    expect(FLOW_EXAMPLES.length).toBe(3)
    for (const ex of FLOW_EXAMPLES) {
      expect(ex.label.length).toBeGreaterThan(0)
      expect(ex.source.length).toBeGreaterThan(0)
    }
  })
})

describe('detectKind', () => {
  it('detects flowchart from `flowchart TD ...`', () => {
    expect(detectKind('flowchart TD\n  A --> B')).toBe('flowchart')
  })
  it('detects sequence from sequenceDiagram', () => {
    expect(detectKind('sequenceDiagram\n A->>B: x')).toBe('sequence')
  })
  it('returns null for empty / unknown source', () => {
    expect(detectKind('')).toBeNull()
    expect(detectKind('hello world')).toBeNull()
  })
  it('skips leading blank lines', () => {
    expect(detectKind('\n\n  pie title x\n  "A": 1')).toBe('pie')
  })
})

describe('<FlowBlockEditor /> static render', () => {
  it('exposes the source textarea + kind select + cheat sheet', () => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
    const html = renderToStaticMarkup(<FlowBlockEditor slug="test" block={block} />)
    expect(html).toContain('aria-label="flow source"')
    expect(html).toContain('aria-label="flow kind"')
    expect(html).toContain('aria-label="cheat sheet"')
    expect(html).toContain('순서도')
    expect(html).toContain('시퀀스')
    expect(html).toContain('이렇게 쓰세요')
    // line number gutter rendered
    expect(html).toContain('data-flow-line-numbers')
  })
})
