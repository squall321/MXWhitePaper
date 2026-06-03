import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fetchDataSource } from './DataSourceBlock'
import { payloadToRows } from './PivotTableBlock'
import { useEditorStore } from '@/features/editor/state'
import { useSlicerStore } from '@/features/slicer/store'
import type { Block, DataSourceBlock as DataSourceBlockType, TimelineBlock } from '@/types/document'

/**
 * G4 — Timeline widget. Two HTML range inputs scoped to the field's
 * [min, max] ISO-date domain; the active [from, to] window is persisted
 * in `useSlicerStore` under this block's id (same store SlicerBlock uses,
 * so a single `boundSlicers` picker binds either type). Widgets read the
 * window via `collectTimelineFilters`, which emits a `{op:'between'}`
 * filter spec consumed by `pivotEngine.applyFilters`.
 *
 * Why the same store as SlicerBlock: cross-widget filter coordination
 * shouldn't fork based on widget type. A consumer (Pivot, Table) walks
 * `boundSlicers` once and dispatches by the bound block's `type`.
 */
interface Props {
  block: TimelineBlock
}

/** Numeric position of an ISO date within [min, max], clamped to [0, 1]. */
function pct(iso: string, min: string, max: string): number {
  if (min === max) return 0
  const a = Date.parse(iso)
  const lo = Date.parse(min)
  const hi = Date.parse(max)
  if (Number.isNaN(a) || Number.isNaN(lo) || Number.isNaN(hi) || hi === lo) return 0
  return Math.max(0, Math.min(1, (a - lo) / (hi - lo)))
}

/** ISO date at fractional position p ∈ [0,1] across [min, max]. */
function isoAt(p: number, min: string, max: string): string {
  const lo = Date.parse(min)
  const hi = Date.parse(max)
  if (Number.isNaN(lo) || Number.isNaN(hi)) return min
  const t = lo + Math.max(0, Math.min(1, p)) * (hi - lo)
  return new Date(t).toISOString().slice(0, 10)
}

export function TimelineBlockView({ block }: Props) {
  const draft = useEditorStore((s) => s.draft)
  const sourceKind = block.source?.kind
  const active = useSlicerStore((s) => s.active[block.id] ?? [])
  const setActive = useSlicerStore((s) => s.setActive)
  const clear = useSlicerStore((s) => s.clear)

  const inlineRows = useMemo<Array<Record<string, unknown>>>(() => {
    if (sourceKind === 'inline') {
      const src = block.source as { rows?: Array<Record<string, unknown>> }
      return src.rows ?? []
    }
    return []
  }, [sourceKind, block.source])

  const dataSourceBlock = useMemo<DataSourceBlockType | null>(() => {
    if (sourceKind !== 'data-source' || !draft) return null
    const id = (block.source as { dataSourceId?: string }).dataSourceId
    if (!id) return null
    for (const section of draft.sections ?? []) {
      for (const b of (section.blocks ?? []) as Block[]) {
        if (b.id === id && b.type === 'data-source') return b as DataSourceBlockType
      }
    }
    return null
  }, [sourceKind, block.source, draft])

  const endpoint = dataSourceBlock?.endpoint ?? ''
  const params = dataSourceBlock?.params ?? null
  const { data, error, isLoading } = useQuery({
    queryKey: ['data-source', endpoint, JSON.stringify(params)],
    queryFn: () => fetchDataSource(endpoint, params),
    enabled: sourceKind === 'data-source' && Boolean(endpoint),
    retry: false,
  })

  const rows = sourceKind === 'inline'
    ? inlineRows
    : (payloadToRows(data?.data ?? null) as Array<Record<string, unknown>>)

  // Domain: explicit min/max wins, else min/max of `block.field` across rows.
  // Skips null cells; falls back to today if rows yield no parseable dates.
  const domain = useMemo<{ min: string; max: string }>(() => {
    if (block.min && block.max) return { min: block.min, max: block.max }
    let lo: number | null = null
    let hi: number | null = null
    for (const r of rows) {
      const v = r[block.field]
      if (v == null) continue
      const t = Date.parse(String(v))
      if (Number.isNaN(t)) continue
      if (lo === null || t < lo) lo = t
      if (hi === null || t > hi) hi = t
    }
    if (lo === null || hi === null) {
      const today = new Date().toISOString().slice(0, 10)
      return { min: block.min ?? today, max: block.max ?? today }
    }
    return {
      min: block.min ?? new Date(lo).toISOString().slice(0, 10),
      max: block.max ?? new Date(hi).toISOString().slice(0, 10),
    }
  }, [rows, block.field, block.min, block.max])

  const from: string = active.length === 2 ? (active[0] ?? domain.min) : domain.min
  const to: string = active.length === 2 ? (active[1] ?? domain.max) : domain.max
  const isAll = active.length !== 2 || (from === domain.min && to === domain.max)

  let body: ReactNode
  if (sourceKind === 'data-source' && isLoading) {
    body = <span className="text-[11px] text-gray-500 dark:text-gray-400">로딩 중…</span>
  } else if (sourceKind === 'data-source' && error) {
    body = (
      <span className="text-[11px] text-red-600 dark:text-red-400">
        오류: {(error as Error).message}
      </span>
    )
  } else if (sourceKind === 'data-source' && !dataSourceBlock) {
    body = (
      <span className="text-[11px] text-amber-700 dark:text-amber-300">
        dataSourceId 가 draft 에 없음
      </span>
    )
  } else {
    body = (
      <>
        <span
          className="font-mono text-[10px] text-gray-600 dark:text-gray-300"
          data-testid={`timeline-${block.id.slice(0, 8)}-from`}
        >
          {from}
        </span>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(pct(from, domain.min, domain.max) * 1000)}
          onChange={(e) => {
            const next = isoAt(Number(e.target.value) / 1000, domain.min, domain.max)
            setActive(block.id, [next > to ? to : next, to])
          }}
          aria-label="from"
          data-testid={`timeline-${block.id.slice(0, 8)}-from-input`}
          className="h-1 w-24 accent-smsg-600"
        />
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(pct(to, domain.min, domain.max) * 1000)}
          onChange={(e) => {
            const next = isoAt(Number(e.target.value) / 1000, domain.min, domain.max)
            setActive(block.id, [from, next < from ? from : next])
          }}
          aria-label="to"
          data-testid={`timeline-${block.id.slice(0, 8)}-to-input`}
          className="h-1 w-24 accent-smsg-600"
        />
        <span
          className="font-mono text-[10px] text-gray-600 dark:text-gray-300"
          data-testid={`timeline-${block.id.slice(0, 8)}-to`}
        >
          {to}
        </span>
      </>
    )
  }

  return (
    <section
      className="my-2 flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white p-2 text-[11px] dark:border-gray-700 dark:bg-gray-900"
      data-block-type="timeline"
      data-block-id={block.id}
      data-timeline-field={block.field}
    >
      {block.label && (
        <span className="mr-1 font-semibold text-gray-700 dark:text-gray-200">
          {block.label}:
        </span>
      )}
      {body}
      {!isAll && (
        <button
          type="button"
          onClick={() => clear(block.id)}
          aria-label="clear timeline"
          data-testid={`timeline-${block.id.slice(0, 8)}-clear`}
          className="ml-1 rounded border border-gray-300 px-1 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          ✕
        </button>
      )}
    </section>
  )
}

/**
 * G4 — resolve the `boundSlicers` list against the draft, treating any
 * id whose target is a TimelineBlock as a `between` filter source. Mirrors
 * `collectSlicerFilters` shape so a viewer can simply concat both.
 *
 * Exported for unit tests.
 */
export function collectTimelineFilters(
  boundSlicers: ReadonlyArray<string> | undefined,
  sections: ReadonlyArray<{ blocks?: Array<Block> }>,
  active: Record<string, string[]>,
): Array<{ field: string; op: 'between'; value: [string, string] }> {
  const ids = boundSlicers ?? []
  if (ids.length === 0) return []
  const byId = new Map<string, TimelineBlock>()
  for (const section of sections) {
    for (const b of (section.blocks ?? []) as Block[]) {
      if (b.type === 'timeline') byId.set(b.id, b as TimelineBlock)
    }
  }
  const out: Array<{ field: string; op: 'between'; value: [string, string] }> = []
  for (const id of ids) {
    const tl = byId.get(id)
    if (!tl) continue
    const v = active[id] ?? []
    if (v.length !== 2) continue
    const [lo, hi] = v
    if (lo === undefined || hi === undefined) continue
    out.push({ field: tl.field, op: 'between', value: [lo, hi] })
  }
  return out
}
