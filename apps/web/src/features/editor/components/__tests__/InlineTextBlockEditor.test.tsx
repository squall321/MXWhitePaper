import { describe, it, expect } from 'vitest'
import {
  mdLiteToHtml,
  walkNodeForMdLite,
} from '../InlineTextBlockEditor'

/**
 * mdLiteToHtml is a pure string→string function — no DOM. It can run in the
 * default node test env. htmlToMdLite needs a real DOM (jsdom) which this
 * repo doesn't ship, so we exercise its core logic by hand-building a tiny
 * fake-Node tree and feeding it to the exported `walkNodeForMdLite`.
 */

// Mirror the bare-minimum DOM Node interface that walkNodeForMdLite touches.
interface FakeNode {
  nodeType: number
  textContent?: string
  tagName?: string
  childNodes: FakeNode[]
  // Use a plain Map-ish for attrs.
  _attrs?: Record<string, string>
  getAttribute?: (name: string) => string | null
}

const TEXT_NODE = 3
const ELEMENT_NODE = 1

function txt(value: string): FakeNode {
  return { nodeType: TEXT_NODE, textContent: value, childNodes: [] }
}

function el(
  tag: string,
  children: FakeNode[] = [],
  attrs: Record<string, string> = {},
): FakeNode {
  return {
    nodeType: ELEMENT_NODE,
    tagName: tag.toUpperCase(),
    childNodes: children,
    _attrs: attrs,
    getAttribute(name: string) {
      return name in attrs ? attrs[name] ?? null : null
    },
  }
}

// Wrap walkNodeForMdLite so the test can pass a FakeNode tree. The function's
// runtime contract only depends on the subset declared above; TS complains
// because FakeNode != Node, so cast at the boundary.
function walkFake(node: FakeNode): string {
  // Make Node.TEXT_NODE / Node.ELEMENT_NODE available globally — the function
  // references them as constants on the global Node object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Node = { TEXT_NODE, ELEMENT_NODE }
  return walkNodeForMdLite(node as unknown as Node)
}

describe('mdLiteToHtml — strikethrough', () => {
  it('renders ~~text~~ as <s>text</s>', () => {
    expect(mdLiteToHtml('~~foo~~')).toBe('<s>foo</s>')
  })

  it('coexists with bold, italic, code in the same string', () => {
    const html = mdLiteToHtml('**b** ~~s~~ *i* `c`')
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<s>s</s>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<code>c</code>')
  })

  it('does NOT match ~~ inside `code`', () => {
    expect(mdLiteToHtml('`~~not~~`')).toBe('<code>~~not~~</code>')
  })

  it('does NOT match a single ~ as a delimiter', () => {
    expect(mdLiteToHtml('~not~')).toBe('~not~')
  })

  it('keeps stray ~~ literal when there is no closing pair', () => {
    expect(mdLiteToHtml('~~unbalanced')).toBe('~~unbalanced')
  })

  it('keeps the existing **bold**, `code`, *italic* tokens unchanged', () => {
    expect(mdLiteToHtml('**foo**')).toBe('<strong>foo</strong>')
    expect(mdLiteToHtml('`foo`')).toBe('<code>foo</code>')
    expect(mdLiteToHtml('*foo*')).toBe('<em>foo</em>')
  })
})

describe('walkNodeForMdLite — strikethrough', () => {
  it('serializes <s> back to ~~…~~', () => {
    expect(walkFake(el('div', [el('s', [txt('foo')])]))).toBe('~~foo~~')
  })

  it('serializes <del> and <strike> the same way', () => {
    expect(walkFake(el('div', [el('del', [txt('foo')])]))).toBe('~~foo~~')
    expect(walkFake(el('div', [el('strike', [txt('foo')])]))).toBe('~~foo~~')
  })

  it('normalizes <span style="text-decoration:line-through"> from execCommand', () => {
    expect(
      walkFake(
        el(
          'div',
          [el('span', [txt('foo')], { style: 'text-decoration: line-through;' })],
        ),
      ),
    ).toBe('~~foo~~')
    expect(
      walkFake(
        el(
          'div',
          [el('span', [txt('foo')], { style: 'text-decoration-line: line-through;' })],
        ),
      ),
    ).toBe('~~foo~~')
  })

  it('drops empty <s></s> on serialize', () => {
    expect(walkFake(el('div', [el('s', [])]))).toBe('')
  })

  it('keeps existing bold/italic/code mappings unchanged', () => {
    expect(walkFake(el('div', [el('strong', [txt('b')])]))).toBe('**b**')
    expect(walkFake(el('div', [el('em', [txt('i')])]))).toBe('*i*')
    expect(walkFake(el('div', [el('code', [txt('c')])]))).toBe('`c`')
  })
})

describe('strikethrough round-trip (mdLite → HTML-tree → mdLite)', () => {
  it('~~foo~~ → <s>foo</s> → ~~foo~~', () => {
    const html = mdLiteToHtml('~~foo~~')
    expect(html).toBe('<s>foo</s>')
    // Replay the saved HTML through the tree walker by mirroring the parse.
    const round = walkFake(el('div', [el('s', [txt('foo')])]))
    expect(round).toBe('~~foo~~')
  })
})
