import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BulkActionsBar,
  BulkActionsBarView,
  cloneBlockWithNewIds,
  looksLikeBlockArray,
  runBulkDelete,
  runBulkDuplicate,
  runBulkMoveToSection,
  type BulkOpDeps,
} from '../BulkActionsBar'
import { useBulkSelectionStore } from '@/features/editor/bulkSelectionStore'
import { useEditorStore } from '@/features/editor/state'
import type { Block, DocumentJSONV10 } from '@/types/document'

/**
 * BulkActionsBar — the React shell delegates to three pure async loops
 * (`runBulkDelete`, `runBulkDuplicate`, `runBulkMoveToSection`) that take a
 * deps bag including mockable `api.*` functions. These tests exercise the
 * pure loops directly so the API-call assertions are deterministic without
 * needing jsdom + RTL.
 *
 * The render-side tests use `renderToStaticMarkup` (the same SSR pattern as
 * sibling tests) to verify the bar appears with the right buttons + count.
 */

function makeDoc(): DocumentJSONV10 {
  return {
    schema_version: '1.0',
    id: '01ABCDEFGHJKMNPQRSTVWXYZ00',
    slug: 'test-doc',
    title: 'Test',
    metadata: {
      division: 'eng',
      owners: ['squall'],
      tags: [],
      confidentiality: 'internal',
    },
    sections: [
      {
        id: '01SECTIONONE00000000000001',
        number: '1',
        level: 1,
        title: '개요',
        blocks: [
          { type: 'paragraph', id: 'BLOCK0000000000000000000A1', text: 'a' },
          { type: 'paragraph', id: 'BLOCK0000000000000000000A2', text: 'b' },
          { type: 'paragraph', id: 'BLOCK0000000000000000000A3', text: 'c' },
        ],
        subsections: [],
      },
      {
        id: '01SECTIONTWO00000000000001',
        number: '2',
        level: 1,
        title: '본문',
        blocks: [],
        subsections: [],
      },
    ],
  }
}

function freshResult(): { document: DocumentJSONV10; etag: string } {
  return { document: makeDoc(), etag: 'etag-next' }
}

function depsWith(api: Partial<BulkOpDeps['api']>): BulkOpDeps {
  return {
    slug: 'test-doc',
    getDoc: () => makeDoc(),
    getEtag: () => 'etag-1',
    apply: vi.fn(),
    onConflict: vi.fn(),
    api: {
      deleteBlock: vi.fn().mockResolvedValue(freshResult()),
      insertBlock: vi.fn().mockResolvedValue(freshResult()),
      moveBlock: vi.fn().mockResolvedValue(freshResult()),
      ...api,
    },
  }
}

describe('cloneBlockWithNewIds', () => {
  it('produces a copy with a different top-level id', () => {
    const orig: Block = { type: 'paragraph', id: 'OLD', text: 'hi' }
    const c = cloneBlockWithNewIds(orig) as Block & { id: string; text?: string }
    expect(c.id).not.toBe('OLD')
    expect(c.id).toHaveLength(26)
    expect(c.text).toBe('hi')
    // Original untouched.
    expect(orig.id).toBe('OLD')
  })

  it('reassigns ids inside columns containers', () => {
    const orig: Block = {
      type: 'columns',
      id: 'COL_OLD',
      columns: [
        [{ type: 'paragraph', id: 'C1_OLD', text: 'x' }],
        [{ type: 'paragraph', id: 'C2_OLD', text: 'y' }],
      ],
    }
    const c = cloneBlockWithNewIds(orig)
    expect(c.id).not.toBe('COL_OLD')
    if (c.type !== 'columns') throw new Error('expected columns')
    expect(c.columns[0]?.[0]?.id).not.toBe('C1_OLD')
    expect(c.columns[1]?.[0]?.id).not.toBe('C2_OLD')
  })

  it('reassigns ids inside tabs blocks', () => {
    const orig: Block = {
      type: 'tabs',
      id: 'TABS_OLD',
      tabs: [{ label: 'A', blocks: [{ type: 'paragraph', id: 'T1_OLD', text: 'x' }] }],
    }
    const c = cloneBlockWithNewIds(orig)
    if (c.type !== 'tabs') throw new Error('expected tabs')
    expect(c.id).not.toBe('TABS_OLD')
    expect(c.tabs[0]?.blocks[0]?.id).not.toBe('T1_OLD')
  })
})

describe('looksLikeBlockArray', () => {
  it('accepts an array of {type,id} payloads', () => {
    expect(looksLikeBlockArray([{ type: 'paragraph', id: 'X', text: '' }])).toBe(true)
  })
  it('rejects a non-array', () => {
    expect(looksLikeBlockArray({ type: 'paragraph', id: 'X' })).toBe(false)
  })
  it('rejects an array containing a non-object', () => {
    expect(looksLikeBlockArray([1, 2, 3])).toBe(false)
  })
  it('rejects entries missing type or id', () => {
    expect(looksLikeBlockArray([{ id: 'x' }])).toBe(false)
    expect(looksLikeBlockArray([{ type: 'p' }])).toBe(false)
  })
})

describe('runBulkDelete', () => {
  it('calls deleteBlock once per id and returns ok=N', async () => {
    const deps = depsWith({})
    const result = await runBulkDelete(
      ['BLOCK0000000000000000000A1', 'BLOCK0000000000000000000A2'],
      deps,
    )
    expect(deps.api.deleteBlock).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(2)
    expect(result.failed).toBe(0)
  })

  it('stops on first failure and reports remaining ids as failed', async () => {
    const deleteBlock = vi
      .fn()
      .mockResolvedValueOnce(freshResult())
      .mockRejectedValueOnce(new Error('boom'))
    const deps = depsWith({ deleteBlock })
    const result = await runBulkDelete(['a', 'b', 'c'], deps)
    expect(deleteBlock).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(1)
    expect(result.failed).toBe(2)
  })

  it('routes 412 errors through onConflict', async () => {
    const conflict = Object.assign(new Error('precondition'), {
      response: { status: 412 },
    })
    const deleteBlock = vi.fn().mockRejectedValue(conflict)
    const deps = depsWith({ deleteBlock })
    await runBulkDelete(['a'], deps)
    expect(deps.onConflict).toHaveBeenCalled()
  })
})

describe('runBulkDuplicate', () => {
  it('calls insertBlock once per existing id with a fresh ULID', async () => {
    const insertBlock = vi.fn().mockResolvedValue(freshResult())
    const deps = depsWith({ insertBlock })
    await runBulkDuplicate(['BLOCK0000000000000000000A1', 'BLOCK0000000000000000000A2'], deps)
    expect(insertBlock).toHaveBeenCalledTimes(2)
    // Each call gets a body with a fresh block id (not the original).
    for (const call of insertBlock.mock.calls) {
      const body = call[1] as { block: { id: string } }
      expect(body.block.id).not.toBe('BLOCK0000000000000000000A1')
      expect(body.block.id).not.toBe('BLOCK0000000000000000000A2')
    }
  })

  it('skips ids that aren’t in the doc', async () => {
    const insertBlock = vi.fn().mockResolvedValue(freshResult())
    const deps = depsWith({ insertBlock })
    await runBulkDuplicate(['DOES-NOT-EXIST'], deps)
    expect(insertBlock).not.toHaveBeenCalled()
  })
})

describe('runBulkMoveToSection', () => {
  it('moves every id with to_index=-1 (append)', async () => {
    const moveBlock = vi.fn().mockResolvedValue(freshResult())
    const deps = depsWith({ moveBlock })
    await runBulkMoveToSection(
      ['BLOCK0000000000000000000A1'],
      '01SECTIONTWO00000000000001',
      deps,
    )
    expect(moveBlock).toHaveBeenCalledTimes(1)
    const body = moveBlock.mock.calls[0]?.[2] as { to_section_id: string; to_index: number }
    expect(body.to_section_id).toBe('01SECTIONTWO00000000000001')
    expect(body.to_index).toBe(-1)
  })
})

describe('<BulkActionsBar /> static render', () => {
  /**
   * Note on SSR rendering: zustand v5's `useStore` uses
   * `getServerSnapshot = () => selector(api.getInitialState())`. That means
   * `setState({selected: new Set([...])})` does NOT propagate to a
   * `renderToStaticMarkup` call because SSR reads the initial (empty) state.
   *
   * → For empty-selection rendering we can still exercise the SSR path. For
   *   the "renders with N items" assertions we exercise `BulkActionsBarView`
   *   in the "render scaffold" sub-block below.
   */
  beforeEach(() => {
    useBulkSelectionStore.setState({ selected: new Set<string>() })
    useEditorStore.getState().reset()
    useEditorStore.setState({ slug: 'test-doc', etag: 'etag-1', draft: makeDoc() })
  })

  it('renders nothing when nothing is selected', () => {
    const html = renderToStaticMarkup(<BulkActionsBar slug="test-doc" />)
    expect(html).toBe('')
  })
})

describe('<BulkActionsBarView /> presentational', () => {
  const noop = () => undefined

  it('renders the bar + count + 7 action buttons + close button', () => {
    const html = renderToStaticMarkup(
      <BulkActionsBarView
        count={3}
        onDelete={noop}
        onDuplicate={noop}
        onMoveUp={noop}
        onMoveDown={noop}
        onPickSection={noop}
        onCopy={noop}
        onClose={noop}
      />,
    )
    expect(html).toContain('data-testid="bulk-actions-bar"')
    expect(html).toContain('3개 블록 선택됨')
    expect(html).toContain('data-testid="bulk-action-delete"')
    expect(html).toContain('data-testid="bulk-action-duplicate"')
    expect(html).toContain('data-testid="bulk-action-move-up"')
    expect(html).toContain('data-testid="bulk-action-move-down"')
    expect(html).toContain('data-testid="bulk-action-move-section"')
    expect(html).toContain('data-testid="bulk-action-copy"')
    expect(html).toContain('data-testid="bulk-action-close"')
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('aria-label="블록 일괄 작업"')
  })

  it('disables every action button when busy=true', () => {
    const html = renderToStaticMarkup(
      <BulkActionsBarView
        count={1}
        busy
        onDelete={noop}
        onDuplicate={noop}
        onMoveUp={noop}
        onMoveDown={noop}
        onPickSection={noop}
        onCopy={noop}
        onClose={noop}
      />,
    )
    // All 7 main action buttons + close = 8 disabled buttons.
    const matches = html.match(/disabled=""/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(7)
  })
})
