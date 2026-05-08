import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CalculatorBlockEditor, validateFormula } from '../CalculatorBlockEditor'
import {
  CalculatorBlockView,
  evaluateFormula,
  defaultValues,
} from '@/components/blocks/CalculatorBlock'
import { useEditorStore } from '@/features/editor/state'
import type { CalculatorBlock } from '@/types/document'

const block: CalculatorBlock = {
  type: 'calculator',
  id: '01TESTBLOCK00000000000CALC',
  inputs: [
    { name: 'a', label: 'A', kind: 'number', default: 1 },
    { name: 'b', label: 'B', kind: 'number', default: 1 },
  ],
  formula: 'a + b',
  label: '합계',
}

describe('validateFormula', () => {
  it('accepts a syntactically-valid expression', () => {
    expect(validateFormula('a + b').ok).toBe(true)
  })
  it('rejects a malformed expression', () => {
    const r = validateFormula('a + ')
    expect(r.ok).toBe(false)
  })
  it('rejects an empty expression', () => {
    expect(validateFormula('   ').ok).toBe(false)
  })
})

describe('evaluateFormula', () => {
  it('computes 2 + 3 = 5', () => {
    const inputs = block.inputs
    const r = evaluateFormula('a + b', inputs, { a: 2, b: 3 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('5')
  })
  it('supports inputs.* dotted access', () => {
    const r = evaluateFormula('inputs.a * inputs.b', block.inputs, { a: 4, b: 5 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('20')
  })
  it('returns an error for unknown identifiers', () => {
    const r = evaluateFormula('zzz + 1', block.inputs, {})
    expect(r.ok).toBe(false)
  })
})

describe('defaultValues', () => {
  it('uses declared defaults', () => {
    expect(defaultValues(block.inputs)).toEqual({ a: 1, b: 1 })
  })
  it('seeds 0 / "" by kind when no default', () => {
    expect(
      defaultValues([
        { name: 'x', label: 'X', kind: 'number' },
        { name: 'y', label: 'Y', kind: 'text' },
      ]),
    ).toEqual({ x: 0, y: '' })
  })
})

describe('<CalculatorBlockView /> live preview', () => {
  it('shows the result of formula = a + b with seeded defaults 2 + 3', () => {
    const seeded: CalculatorBlock = {
      ...block,
      inputs: [
        { name: 'a', label: 'A', kind: 'number', default: 2 },
        { name: 'b', label: 'B', kind: 'number', default: 3 },
      ],
    }
    const html = renderToStaticMarkup(<CalculatorBlockView block={seeded} />)
    // Result is 5, rendered inside the data-testid="calc-result" element.
    expect(html).toContain('data-testid="calc-result"')
    expect(html).toContain('>5<')
  })
})

describe('<CalculatorBlockEditor /> static render', () => {
  beforeEach(() => {
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test', etag: 'etag-1' })
  })

  it('exposes formula textarea + input rows', () => {
    const html = renderToStaticMarkup(
      <CalculatorBlockEditor slug="test" block={block} />,
    )
    expect(html).toContain('aria-label="formula"')
    expect(html).toContain('aria-label="input 0 name"')
    expect(html).toContain('aria-label="input 1 name"')
    expect(html).toContain('수식')
  })
})
