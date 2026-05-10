import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  AccordionBlock,
  Block,
  ColumnsBlock,
  Slug,
  TabsBlock,
} from '@/types/document'
import { useEditorStore } from '../state'
import { patchBlock, isPreconditionFailed } from '../api'
import { NestedBlockControls } from './NestedBlockControls'
import {
  BlockInsertPalette,
  PALETTE_ITEMS,
  type PaletteItem,
} from '../components/BlockInsertPalette'
import { useT, t as tStatic } from '@/lib/i18n'

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
        setError(tStatic('editor.common.conflict'))
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
  const t = useT()
  const { persist, error } = useContainerPatch<TabsBlock>(slug, block.id, t('editor.tabs.changeLog'))
  const [active, setActive] = useState(0)
  const [palette, setPalette] = useState<SlotPaletteState | null>(null)

  const tabs = block.tabs ?? []
  const tab = tabs[active] ?? tabs[0]

  const setLabel = (idx: number, label: string) => {
    const next = tabs.map((tab2, i) => (i === idx ? { ...tab2, label } : tab2)) as TabsBlock['tabs']
    void persist({ tabs: next })
  }
  const addTab = () => {
    const next = [
      ...tabs,
      { label: t('editor.tabs.newTabName', { n: tabs.length + 1 }), blocks: [] },
    ] as TabsBlock['tabs']
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
        {tabs.map((tab2, i) => (
          <div key={i} className={`flex items-center gap-1 rounded ${active === i ? 'bg-smsg-700 text-white' : 'bg-smsg-100 text-gray-700'}`}>
            <input
              type="text"
              value={tab2.label}
              onChange={(e) => setLabel(i, e.target.value)}
              onFocus={() => setActive(i)}
              aria-label={t('editor.tabs.tabNameLabel', { n: i + 1 })}
              className="bg-transparent px-2 py-1 outline-none placeholder:text-current"
            />
            <button
              type="button"
              aria-label={t('editor.tabs.removeTab', { n: i + 1 })}
              onClick={() => removeTab(i)}
              disabled={tabs.length <= 1}
              className="rounded px-1 hover:bg-black/10 disabled:opacity-30"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addTab}
          className="rounded border border-dashed border-smsg-300 px-2 py-1 text-smsg-700 hover:bg-smsg-100"
        >
          {t('editor.tabs.addTab')}
        </button>
      </div>
      <div className="space-y-3 p-3">
        {(tab?.blocks ?? []).map((b) => (
          <NestedBlockControls key={b.id} slug={slug} block={b} />
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
      {error && (
        <p role="status" aria-live="polite" className="px-3 pb-2 text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

/* =========================== AccordionBlockEditor ========================== */

interface AccordionProps {
  slug: Slug
  block: AccordionBlock
}

export function AccordionBlockEditor({ slug, block }: AccordionProps) {
  const t = useT()
  const { persist, error } = useContainerPatch<AccordionBlock>(
    slug,
    block.id,
    t('editor.accordion.changeLog'),
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
      { label: t('editor.accordion.newItemName', { n: items.length + 1 }), blocks: [] },
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
              aria-label={t('editor.accordion.itemNameLabel', { n: i + 1 })}
              className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                removeItem(i)
              }}
              disabled={items.length <= 1}
              aria-label={t('editor.accordion.removeItem', { n: i + 1 })}
              className="rounded px-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </summary>
          <div className="space-y-3 border-t border-gray-100 p-3">
            {(it.blocks ?? []).map((b) => (
              <NestedBlockControls key={b.id} slug={slug} block={b} />
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
        {t('editor.accordion.addItem')}
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
      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

/* ============================ ColumnsBlockEditor =========================== */

interface ColumnsProps {
  slug: Slug
  block: ColumnsBlock
}

export function ColumnsBlockEditor({ slug, block }: ColumnsProps) {
  const t = useT()
  const { persist, error } = useContainerPatch<ColumnsBlock>(slug, block.id, t('editor.columns.changeLog'))
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
    const targetLen = clamped.length
    const persisted = block.widths as number[] | undefined
    const keepWidths =
      Array.isArray(persisted) && persisted.length === targetLen
    // If the column count changed, drop the existing widths array so the row
    // falls back to an equal split. Sending `null` over the partial-PATCH
    // pipeline removes the field cleanly (BE accepts list | None).
    const patch: Record<string, unknown> = {
      columns: clamped as unknown as ColumnsBlock['columns'],
    }
    if (!keepWidths) patch.widths = null
    void persist(patch as Partial<ColumnsBlock>)
  }

  const setWidthsOnly = (next: number[]) => {
    if (next.length !== cols.length) return
    void persist({ widths: next as unknown as ColumnsBlock['widths'] })
  }

  const insertBlockInCol = (colIdx: number, kid: Block) => {
    const next = cols.map((c, i) => (i === colIdx ? [...c, kid] : c))
    setColumns(next)
  }
  const addColumn = () => {
    if (cols.length >= 4) return
    setColumns([...cols, []])
  }
  /**
   * Insert an empty column at `at` (0..cols.length). Used by the side `+`
   * rails on each column so the user can grow the grid horizontally without
   * scrolling down to the "단 추가" button. Capped at 4 columns by the
   * schema; we silently no-op when full.
   */
  const insertColumnAt = (at: number) => {
    if (cols.length >= 4) return
    const next = cols.slice()
    next.splice(Math.max(0, Math.min(at, cols.length)), 0, [])
    setColumns(next)
  }
  const removeColumn = (idx: number) => {
    if (cols.length <= 2) return
    setColumns(cols.filter((_, i) => i !== idx))
  }

  // ── Column-width splitter ──────────────────────────────────────────────
  // `widths` is optional and only present when the user has dragged a
  // splitter at least once. Otherwise the grid uses an equal split. While a
  // drag is in flight we keep the candidate values in `draftWidths` so the
  // UI updates pixel-by-pixel without blasting the BE on every move.
  const baseWidths = useMemo<number[]>(() => {
    const w = block.widths as number[] | undefined
    if (Array.isArray(w) && w.length === cols.length) return w
    const eq = Math.round((100 / cols.length) * 100) / 100
    return Array(cols.length).fill(eq)
  }, [block.widths, cols.length])

  const [draftWidths, setDraftWidths] = useState<number[] | null>(null)
  const draftRef = useRef<number[] | null>(null)
  useEffect(() => {
    draftRef.current = draftWidths
  }, [draftWidths])
  // If the column count changes server-side, drop any in-flight draft so we
  // don't render a stale shape.
  useEffect(() => {
    setDraftWidths(null)
  }, [cols.length])

  const effectiveWidths = draftWidths ?? baseWidths

  const gridRef = useRef<HTMLDivElement | null>(null)

  const onSplitterPointerDown =
    (idx: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startWidths = effectiveWidths.slice()
      const totalPx = gridRef.current?.getBoundingClientRect().width ?? 0
      if (totalPx <= 0) return
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const dpct = (dx / totalPx) * 100
        const a = startWidths[idx] ?? 0
        const b = startWidths[idx + 1] ?? 0
        let leftW = a + dpct
        let rightW = b - dpct
        const MIN = 5 // matches schema minimum so the BE accepts the persisted shape
        if (leftW < MIN) {
          const adj = MIN - leftW
          leftW = MIN
          rightW -= adj
        }
        if (rightW < MIN) {
          const adj = MIN - rightW
          rightW = MIN
          leftW -= adj
        }
        const next = startWidths.slice()
        next[idx] = Math.round(leftW * 100) / 100
        next[idx + 1] = Math.round(rightW * 100) / 100
        setDraftWidths(next)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        const final = draftRef.current
        setDraftWidths(null)
        if (final && final.length === cols.length) setWidthsOnly(final)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

  const gridStyle: CSSProperties = {
    gridTemplateColumns: effectiveWidths.map((w) => `${w}fr`).join(' '),
  }

  return (
    <div data-columns-block-editor data-block-id={block.id} className="my-3 space-y-2">
      <div ref={gridRef} className="relative grid gap-3" style={gridStyle}>
        {cols.map((col, i) => (
          <div
            key={i}
            className="group/col relative min-w-0 space-y-3 rounded border border-dashed border-gray-200 bg-white p-2"
          >
            {/* Left rail — adds a new column to the LEFT of this one. */}
            <button
              type="button"
              onClick={() => insertColumnAt(i)}
              disabled={cols.length >= 4}
              aria-label={t('editor.columns.insertLeft', { n: i + 1 })}
              title={t('editor.columns.insertLeft', { n: i + 1 })}
              className="absolute -left-3 top-0 bottom-0 z-10 hidden w-3 items-center justify-center opacity-0 transition-opacity group-hover/col:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 sm:flex"
            >
              <span className="pointer-events-none flex h-full w-3 flex-col items-center">
                <span className="w-px flex-1 bg-smsg-300" />
                <span className="my-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-smsg-500 bg-white text-xs font-bold text-smsg-700 shadow-sm dark:bg-gray-900">
                  +
                </span>
                <span className="w-px flex-1 bg-smsg-300" />
              </span>
            </button>

            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span>{t('editor.columns.label', { n: i + 1 })}</span>
              <button
                type="button"
                onClick={() => removeColumn(i)}
                disabled={cols.length <= 2}
                aria-label={t('editor.columns.removeColumn', { n: i + 1 })}
                className="rounded px-1 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
            {col.map((b) => (
              <NestedBlockControls key={b.id} slug={slug} block={b} />
            ))}
            <SlotAddButton
              slotKey={`col-${i}`}
              onOpen={(p) => setPalette({ ...p, colIdx: i })}
            />

            {/* Right rail — adds a new column to the RIGHT of this one. */}
            <button
              type="button"
              onClick={() => insertColumnAt(i + 1)}
              disabled={cols.length >= 4}
              aria-label={t('editor.columns.insertRight', { n: i + 1 })}
              title={t('editor.columns.insertRight', { n: i + 1 })}
              className="absolute -right-3 top-0 bottom-0 z-10 hidden w-3 items-center justify-center opacity-0 transition-opacity group-hover/col:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-0 sm:flex"
            >
              <span className="pointer-events-none flex h-full w-3 flex-col items-center">
                <span className="w-px flex-1 bg-smsg-300" />
                <span className="my-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-smsg-500 bg-white text-xs font-bold text-smsg-700 shadow-sm dark:bg-gray-900">
                  +
                </span>
                <span className="w-px flex-1 bg-smsg-300" />
              </span>
            </button>

            {/* Splitter handle — sits in the grid `gap` between this column
                and the next. Drag horizontally to redistribute the two
                column widths while keeping the others fixed. The handle is
                kept narrow (4px hit area visualised by an 8-px-tall pill) and
                only fades in on hover so it doesn't compete with the +
                rails. Mirrored at `-right-2` (half of the 12-px gap). */}
            {i < cols.length - 1 && (
              <button
                type="button"
                aria-label={t('editor.columns.splitter', { n: i + 1 })}
                title={t('editor.columns.splitter', { n: i + 1 })}
                tabIndex={-1}
                onPointerDown={onSplitterPointerDown(i)}
                className={`absolute top-2 bottom-2 z-20 -right-2 w-1 cursor-ew-resize touch-none select-none transition-opacity ${
                  draftWidths ? 'opacity-100' : 'opacity-0 group-hover/col:opacity-60 hover:opacity-100'
                }`}
                data-splitter-index={i}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-1 rounded-full bg-smsg-500/80 shadow-sm"
                />
              </button>
            )}
          </div>
        ))}
        {/* Live size readout while dragging — sits above the grid so the user
            sees the current ratio (e.g. "32% / 68%") without trial-and-error. */}
        {draftWidths && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-6 right-0 z-20 rounded bg-smsg-700 px-1.5 py-0.5 text-[10px] font-mono text-white shadow"
          >
            {draftWidths.map((w) => `${Math.round(w)}%`).join(' / ')}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={addColumn}
        disabled={cols.length >= 4}
        className="rounded border border-dashed border-smsg-300 px-2 py-1 text-xs text-smsg-700 hover:bg-smsg-100 disabled:opacity-40"
      >
        {t('editor.columns.addColumn')}
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
      {error && (
        <p role="status" aria-live="polite" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

/* ============================== Shared atoms ============================== */

interface SlotAddButtonProps {
  slotKey: string
  onOpen: (state: SlotPaletteState) => void
}

function SlotAddButton({ slotKey, onOpen }: SlotAddButtonProps) {
  const t = useT()
  return (
    <button
      type="button"
      data-slot-key={slotKey}
      onClick={(e) => onOpen({ slotKey, x: e.clientX, y: e.clientY })}
      className="w-full rounded border border-dashed border-smsg-200 bg-white px-2 py-1.5 text-[11px] text-smsg-700 hover:border-smsg-500 hover:bg-smsg-50"
    >
      {t('editor.containers.addBlock')}
    </button>
  )
}

// Re-export PALETTE_ITEMS so test files can verify the slot palette uses
// the same shape as the section-level palette without importing two paths.
export { PALETTE_ITEMS }
