/**
 * Tests for ConditionalFormattingPresetsPanel.
 *
 * Project policy: no jsdom + no @testing-library. We exercise structure via
 * SSR (panel is collapsed by default, so we assert the toggle shell) and
 * the actual rule-application logic via the pure {@link appendPresetRules}
 * helper that the panel delegates to.
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ConditionalFormattingPresetsPanel } from '../ConditionalFormattingPresetsPanel'
import { appendPresetRules } from '@/components/blocks/conditionalPresets'
import type { TableBlock } from '@/types/document'

const baseBlock: TableBlock = {
  type: 'table',
  id: '01TESTBLOCK00000000000CF1',
  headers: ['이름', '매출'],
  rows: [
    ['A', '100'],
    ['B', '200'],
    ['C', '300'],
    ['A', '50'],
  ],
}

describe('<ConditionalFormattingPresetsPanel /> — SSR', () => {
  it('renders the toggle shell with marker attributes', () => {
    const html = renderToStaticMarkup(
      <ConditionalFormattingPresetsPanel
        block={baseBlock}
        headerNames={baseBlock.headers}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('data-cf-presets')
    expect(html).toContain('data-action="toggle-cf-presets"')
    expect(html).toContain('조건부 서식 프리셋')
  })

  it('returns null when there are no columns (renders empty string)', () => {
    const empty: TableBlock = {
      type: 'table',
      id: '01TESTBLOCK00000000000CF2',
      headers: [],
      rows: [],
    }
    const html = renderToStaticMarkup(
      <ConditionalFormattingPresetsPanel
        block={empty}
        headerNames={[]}
        onChange={() => {}}
      />,
    )
    expect(html).toBe('')
  })

  it('shows applied rule count badge when rules already exist', () => {
    const withRules: TableBlock = {
      ...baseBlock,
      options: {
        conditionalFormatting: [
          {
            column: '매출',
            operator: 'gt',
            value: 100,
            style: { bg: '#aaa' },
          },
          {
            column: 0,
            operator: 'lte',
            value: 0,
            style: { fg: '#f00', bold: true },
          },
        ],
      },
    }
    const html = renderToStaticMarkup(
      <ConditionalFormattingPresetsPanel
        block={withRules}
        headerNames={withRules.headers}
        onChange={() => {}}
      />,
    )
    // Count badge appears next to the title.
    expect(html).toMatch(/조건부 서식 프리셋[\s\S]*?2/)
  })
})

describe('appendPresetRules — wiring used by panel click handlers', () => {
  it('appends a top10 rule onto an empty list', () => {
    const next = appendPresetRules(undefined, 'top10pct', '매출', [
      '100',
      '200',
      '300',
    ])
    expect(next).toBeDefined()
    expect(next!.length).toBe(1)
    expect(next![0]!.operator).toBe('top_n')
    expect(next![0]!.column).toBe('매출')
  })

  it('appends onto an existing list without dropping prior rules', () => {
    const prior = [
      {
        column: 0,
        operator: 'gt' as const,
        value: 50,
        style: { bg: '#aaa' },
      },
    ]
    const next = appendPresetRules(prior, 'nonPositive', 1, [])
    expect(next).toBeDefined()
    expect(next!.length).toBe(2)
    expect(next![0]).toEqual(prior[0]) // first rule preserved
    expect(next![1]!.operator).toBe('lte')
    expect(next![1]!.column).toBe(1)
  })

  it('returns the same reference when the preset emits nothing (no patch needed)', () => {
    const prior = [
      {
        column: 0,
        operator: 'gt' as const,
        value: 50,
        style: { bg: '#aaa' },
      },
    ]
    // top10 on a text-only column → no numeric data → no rule added.
    const next = appendPresetRules(prior, 'top10pct', 0, ['foo', 'bar'])
    expect(next).toBe(prior)
  })

  it('returns undefined when prior is undefined and preset emits nothing', () => {
    const next = appendPresetRules(undefined, 'top10pct', 0, ['foo', 'bar'])
    expect(next).toBeUndefined()
  })

  it('duplicates preset emits one eq rule per duplicated value', () => {
    const next = appendPresetRules(undefined, 'duplicates', '이름', [
      'A',
      'B',
      'A',
      'C',
      'B',
    ])
    expect(next).toBeDefined()
    expect(next!.length).toBe(2)
    for (const r of next!) {
      expect(r.operator).toBe('eq')
      expect(r.column).toBe('이름')
    }
  })
})
