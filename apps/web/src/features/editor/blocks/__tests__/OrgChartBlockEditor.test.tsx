import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  OrgChartBlockEditor,
  addChild,
  addSibling,
  removeNode,
  updateNode,
  reparent,
  parseOrgCsv,
} from '../OrgChartBlockEditor'
import { useEditorStore } from '@/features/editor/state'
import type { OrgChartBlock, OrgChartNode } from '@/types/document'

const root: OrgChartNode = {
  id: 'r',
  label: 'CEO',
  children: [
    { id: 'a', label: 'A', children: [{ id: 'a1', label: 'A1' }] },
    { id: 'b', label: 'B' },
  ],
}

const block: OrgChartBlock = {
  type: 'org-chart',
  id: '01TESTBLOCK00000000000ORG1',
  root,
  layout: 'tree',
}

describe('addChild', () => {
  it('appends a child under the requested parent', () => {
    const next = addChild(root, 'a', { id: 'a2', label: 'A2' })
    const a = (next.children ?? [])[0]
    expect((a?.children ?? []).length).toBe(2)
    expect((a?.children ?? [])[1]?.id).toBe('a2')
    // immutability: original root untouched.
    expect(((root.children ?? [])[0]?.children ?? []).length).toBe(1)
  })
})

describe('addSibling', () => {
  it('inserts a sibling immediately after the target', () => {
    const sib: OrgChartNode = { id: 'a-new', label: 'A-NEW' }
    const next = addSibling(root, 'a', sib)
    const labels = (next.children ?? []).map((c) => c.label)
    expect(labels).toEqual(['A', 'A-NEW', 'B'])
  })
  it('skips when target is the root (no parent)', () => {
    const sib: OrgChartNode = { id: 'r-sib', label: 'X' }
    expect(addSibling(root, 'r', sib)).toBe(root)
  })
})

describe('removeNode', () => {
  it('drops the targeted node', () => {
    const next = removeNode(root, 'a1')
    expect(((next.children ?? [])[0]?.children ?? []).length).toBe(0)
  })
  it('refuses to remove the root', () => {
    const next = removeNode(root, 'r')
    expect(next.id).toBe('r')
  })
})

describe('updateNode', () => {
  it('patches a deeply-nested node', () => {
    const next = updateNode(root, 'a1', { label: 'A1*' })
    const a1 = ((next.children ?? [])[0]?.children ?? [])[0]
    expect(a1?.label).toBe('A1*')
  })
})

describe('reparent', () => {
  it('moves a node under a new parent', () => {
    const next = reparent(root, 'a1', 'b')
    // a1 left a's children
    expect(((next.children ?? [])[0]?.children ?? []).length).toBe(0)
    // a1 now under b
    const moved = ((next.children ?? [])[1]?.children ?? [])[0]
    expect(moved?.id).toBe('a1')
  })
  it('refuses to move a node under its own descendant', () => {
    const next = reparent(root, 'a', 'a1')
    expect(next).toBe(root)
  })
  it('refuses to move the root', () => {
    expect(reparent(root, 'r', 'a')).toBe(root)
  })
})

describe('<OrgChartBlockEditor />', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
  })

  it('renders nodes with editable labels', () => {
    const html = renderToStaticMarkup(
      <OrgChartBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('aria-label="node r label"')
    expect(html).toContain('aria-label="node a label"')
    expect(html).toContain('aria-label="add child to r"')
  })

  it('exposes the CSV paste textarea', () => {
    const html = renderToStaticMarkup(
      <OrgChartBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('aria-label="org-csv-paste"')
  })
})

describe('parseOrgCsv', () => {
  it('builds a tree from Manager,Subordinate CSV', () => {
    const root = parseOrgCsv('Manager,Subordinate\nCEO,COO\nCEO,CTO\nCTO,Eng')
    expect(root).not.toBeNull()
    expect(root!.label).toBe('CEO')
    const labels = (root!.children ?? []).map((c) => c.label)
    expect(labels).toEqual(['COO', 'CTO'])
    const cto = (root!.children ?? []).find((c) => c.label === 'CTO')!
    expect((cto.children ?? []).map((c) => c.label)).toEqual(['Eng'])
  })

  it('returns null for non-CSV', () => {
    expect(parseOrgCsv('not a csv')).toBeNull()
  })
})

