import { useState, type CSSProperties } from 'react'
import type {
  AccordionBlock,
  Block,
  ColumnsBlock,
  Slug,
  TabsBlock,
} from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { BlockRenderer } from '@/components/blocks/BlockRenderer'
import {
  BlockInsertPalette,
  PALETTE_ITEMS,
  type PaletteItem,
} from '../components/BlockInsertPalette'

interface SlotPaletteState {
  /** Path identifying the slot the user clicked (e.g. tab/item/column index). */
  slotKey: string
  x: number
  y: number
}

/**
 * Helpers that swap one slot's `blocks` array for a new one and re-emit the
 * full `patchBlock` payload. Each container block carries its full list of
 * sub-block arrays in a slightly different shape, so we keep the patch
 * helpers per-block but the rendering / palette logic shared.
 */
function useContainerPatch<B extends Block>(
  slug: Slug,
  blockId: B['id'],
  changeLog: string,
) {
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)
  const [error, setError] = useState<string | null>(null)

  const persist = async (patch: Partial<B>) => {
    if (!etag) return
    try {
      const result = await patchBlock(
        slug,
        blockId,
        patch as Partial<Block>,
        etag,
        changeLog,
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError('충돌 — 새로고침 필요')
      } else {
        setError((err as Error).message)
      }
    }
  }

  return { persist, error }
}

function buildBlock(item: PaletteItem): Block | null {
  // The palette has an "image" tile that delegates to the global picker.
  // We don't have access to that flow inside a nested slot, so we just
  // skip it here — the user can still nest images by inserting them at
  // the outer section level and dragging in.
  return item.build()
}

/* ============================== TabsBlockEditor ============================ */

interface TabsProps {
  slug: Slug
  block: TabsBlock
}

export function TabsBlockEditor({ slug, block }: TabsProps) {
  const { persist, error } = useContainerPatch<TabsBlock>(slug, block.id, '탭 편집')
  const [active, setActive] = useState(0)
  const [palette, setPalette] = useState<SlotPaletteState | null>(null)

  const tabs = block.tabs ?? []
  const tab = tabs[active] ?? tabs[0]

  const setLabel = (idx: number, label: string) => {
    const next = tabs.map((t, i) => (i === idx ? { ...t, label } : t)) as TabsBlock['tabs']
    void persist({ tabs: next })
  }
  const addTab = () => {
    const next = [...tabs, { label: `탭 ${tabs.length + 1}`, blocks: [] }] as TabsBlock['tabs']
    void persist({ tabs: next })
    setActive(next.length - 1)
  }
  const removeTab = (idx: number) => {
    if (tabs.length <= 1) return
    const next = tabs.filter((_, i) => i !== idx) as TabsBlock['tabs']
    void persist({ tabs: next })
    setActive((a) => Math.max(0, Math.min(a, next.length - 1)))
  }
  const insertBlockInTab = (tabIdx: number, kid: Block) => {
    const next = tabs.map((t, i) =>
      i === tabIdx ? { ...t, blocks: [...t.blocks, kid] } : t,
    ) as TabsBlock['tabs']
    void persist({ tabs: next })
  }

  return (
    <div data-tabs-block-editor data-block-id={block.id} className="my-3 rounded border border-smsg-100 bg-white">
      <div role="tablist" className="flex flex-wrap items-center gap-1 border-b border-gray-200 p-1 text-xs">
        {tabs.map((t, i) => (
          <div key={i} className={`flex items-center gap-1 rounded ${active === i ? 'bg-smsg-700 text-white' : 'bg-smsg-100 text-gray-700'}`}>
            <input
              type="text"
              value={t.label}
              onChange={(e) => setLabel(i, e.target.value)}
              onFocus={() => setActive(i)}
              aria-label={`탭 ${i + 1} 이름`}
              className="bg-transparent px-2 py-1 outline-none placeholder:text-current"
            />
            <button
              type="button"
              aria-label={`탭 ${i + 1} 삭제`}
              onClick={() => removeTab(i)}
              disabled={tabs.length <= 1}
              className="rounded px-1 hover:bg-black/10 disabled:opacity-30"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addTab}
          className="rounded border border-dashed border-smsg-300 px-2 py-1 text-smsg-700 hover:bg-smsg-100"
        >
          + 탭
        </button>
      </div>
      <div className="space-y-3 p-3">
        {(tab?.blocks ?? []).map((b) => (
          <BlockRenderer key={b.id} block={b} />
        ))}
        <SlotAddButton
          slotKey={`tab-${active}`}
          onOpen={(p) => setPalette(p)}
        />
      </div>

      {palette && (
        <BlockInsertPalette
          anchor={{ x: palette.x, y: palette.y }}
          onPick={(item) => {
            const built = buildBlock(item)
            setPalette(null)
            if (built) insertBlockInTab(active, built)
          }}
          onClose={() => setPalette(null)}
        />
      )}
      {error && <p className="px-3 pb-2 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

/* =========================== AccordionBlockEditor ========================== */

interface AccordionProps {
  slug: Slug
  block: AccordionBlock
}

export function AccordionBlockEditor({ slug, block }: AccordionProps) {
  const { persist, error } = useContainerPatch<AccordionBlock>(
    slug,
    block.id,
    '아코디언 편집',
  )
  const [palette, setPalette] = useState<(SlotPaletteState & { itemIdx: number }) | null>(
    null,
  )

  const items = block.items ?? []

  const setLabel = (idx: number, label: string) => {
    const next = items.map((it, i) => (i === idx ? { ...it, label } : it)) as AccordionBlock['items']
    void persist({ items: next })
  }
  const addItem = () => {
    const next = [
      ...items,
      { label: `항목 ${items.length + 1}`, blocks: [] },
    ] as AccordionBlock['items']
    void persist({ items: next })
  }
  const removeItem = (idx: number) => {
    if (items.length <= 1) return
    const next = items.filter((_, i) => i !== idx) as AccordionBlock['items']
    void persist({ items: next })
  }
  const insertBlockInItem = (itemIdx: number, kid: Block) => {
    const next = items.map((it, i) =>
      i === itemIdx ? { ...it, blocks: [...it.blocks, kid] } : it,
    ) as AccordionBlock['items']
    void persist({ items: next })
  }

  return (
    <div data-accordion-block-editor data-block-id={block.id} className="my-3 space-y-1">
      {items.map((it, i) => (
        <details
          key={i}
          className="rounded border border-gray-200 bg-white"
          open={i === 0 ? true : undefined}
        >
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium text-smsg-900 hover:bg-smsg-100">
            <input
              type="text"
              value={it.label}
              onChange={(e) => setLabel(i, e.target.value)}
              onClick={(e) => e.preventDefault()}
              aria-label={`항목 ${i + 1} 이름`}
              className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                removeItem(i)
              }}
              disabled={items.length <= 1}
              aria-label={`항목 ${i + 1} 삭제`}
              className="rounded px-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
            >
              ✕
            </button>
          </summary>
          <div className="space-y-3 border-t border-gray-100 p-3">
            {(it.blocks ?? []).map((b) => (
              <BlockRenderer key={b.id} block={b} />
            ))}
            <SlotAddButton
              slotKey={`item-${i}`}
              onOpen={(p) => setPalette({ ...p, itemIdx: i })}
            />
          </div>
        </details>
      ))}
      <button
        type="button"
        onClick={addItem}
        className="rounded border border-dashed border-smsg-300 px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100"
      >
        + 항목
      </button>

      {palette && (
        <BlockInsertPalette
          anchor={{ x: palette.x, y: palette.y }}
          onPick={(item) => {
            const built = buildBlock(item)
            const target = palette.itemIdx
            setPalette(null)
            if (built) insertBlockInItem(target, built)
          }}
          onClose={() => setPalette(null)}
        />
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

/* ============================ ColumnsBlockEditor =========================== */

interface ColumnsProps {
  slug: Slug
  block: ColumnsBlock
}

export function ColumnsBlockEditor({ slug, block }: ColumnsProps) {
  const { persist, error } = useContainerPatch<ColumnsBlock>(slug, block.id, '컬럼 편집')
  const [palette, setPalette] = useState<(SlotPaletteState & { colIdx: number }) | null>(
    null,
  )

  // The schema enforces 2..4 columns via a tuple shape, but at runtime the
  // value is just `Block[][]`. Cast to a permissive shape for editing and
  // re-narrow at persist time.
  const cols = block.columns as unknown as Block[][]

  const setColumns = (next: Block[][]) => {
    // Schema constraint: 2..4 columns. We just clamp to keep the BE happy.
    const clamped = next.length < 2 ? next.concat([[]]) : next.slice(0, 4)
    void persist({
      columns: clamped as unknown as ColumnsBlock['columns'],
    })
  }
  const insertBlockInCol = (colIdx: number, kid: Block) => {
    const next = cols.map((c, i) => (i === colIdx ? [...c, kid] : c))
    setColumns(next)
  }
  const addColumn = () => {
    if (cols.length >= 4) return
    setColumns([...cols, []])
  }
  const removeColumn = (idx: number) => {
    if (cols.length <= 2) return
    setColumns(cols.filter((_, i) => i !== idx))
  }

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))`,
  }

  return (
    <div data-columns-block-editor data-block-id={block.id} className="my-3 space-y-2">
      <div className="grid gap-3" style={gridStyle}>
        {cols.map((col, i) => (
          <div
            key={i}
            className="space-y-3 rounded border border-dashed border-gray-200 bg-white p-2"
          >
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span>컬럼 {i + 1}</span>
              <button
                type="button"
                onClick={() => removeColumn(i)}
                disabled={cols.length <= 2}
                aria-label={`컬럼 ${i + 1} 삭제`}
                className="rounded px-1 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              >
                ✕
              </button>
            </div>
            {col.map((b) => (
              <BlockRenderer key={b.id} block={b} />
            ))}
            <SlotAddButton
              slotKey={`col-${i}`}
              onOpen={(p) => setPalette({ ...p, colIdx: i })}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addColumn}
        disabled={cols.length >= 4}
        className="rounded border border-dashed border-smsg-300 px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100 disabled:opacity-40"
      >
        + 컬럼
      </button>

      {palette && (
        <BlockInsertPalette
          anchor={{ x: palette.x, y: palette.y }}
          onPick={(item) => {
            const built = buildBlock(item)
            const target = palette.colIdx
            setPalette(null)
            if (built) insertBlockInCol(target, built)
          }}
          onClose={() => setPalette(null)}
        />
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  )
}

/* ============================== Shared atoms ============================== */

interface SlotAddButtonProps {
  slotKey: string
  onOpen: (state: SlotPaletteState) => void
}

function SlotAddButton({ slotKey, onOpen }: SlotAddButtonProps) {
  return (
    <button
      type="button"
      data-slot-key={slotKey}
      onClick={(e) => onOpen({ slotKey, x: e.clientX, y: e.clientY })}
      className="w-full rounded border border-dashed border-smsg-200 bg-white px-2 py-1.5 text-[11px] text-smsg-700 hover:border-smsg-500 hover:bg-smsg-50"
    >
      + 블록 추가
    </button>
  )
}

// Re-export PALETTE_ITEMS so test files can verify the slot palette uses
// the same shape as the section-level palette without importing two paths.
export { PALETTE_ITEMS }
