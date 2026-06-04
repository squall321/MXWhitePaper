import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fetchDataSource } from './DataSourceBlock'
import { payloadToRows } from './PivotTableBlock'
import { useEditorStore } from '@/features/editor/state'
import { useSlicerStore } from '@/features/slicer/store'
import type { Block, DataSourceBlock as DataSourceBlockType, SlicerBlock } from '@/types/document'

/**
 * Sprint 6 (G2) — Slicer widget.
 *
 * Renders a labelled row of chips, one per distinct value of `block.field`
 * in `block.source`. Active chips are pushed into `useSlicerStore` keyed
 * by this slicer's id; widgets that opt in via `boundSlicers` read those
 * values and apply them as additional filters.
 *
 * Two source shapes mirror PivotTable:
 *   - inline: `{kind:'inline', rows: [...]}` — distinct values lifted
 *     directly from the inline rows. Useful for hand-typed enums.
 *   - data-source: `{kind:'data-source', dataSourceId}` — fetched via the
 *     same query key as DataSourceBlockView / PivotTableBlockView so the
 *     three views share one HTTP request.
 */
interface Props {
  block: SlicerBlock
}

export function SlicerBlockView({ block }: Props) {
  const draft = useEditorStore((s) => s.draft)
  const sourceKind = block.source?.kind
  const active = useSlicerStore((s) => s.active[block.id] ?? [])
  const toggle = useSlicerStore((s) => s.toggle)
  const setSingle = useSlicerStore((s) => s.setSingle)
  const setActive = useSlicerStore((s) => s.setActive)

  // H1 — mount-시점 default hydration. block.default 가 있으면 첫 렌더에서
  // store 에 주입. 사용자가 chip 을 만진 후 ("All" 도 합법 상태) 에는
  // 덮어쓰지 않는다 — store entry 가 비어있을 때만 적용.
  useEffect(() => {
    const def = block.default
    if (!def || def.length === 0) return
    if (useSlicerStore.getState().active[block.id]?.length) return
    setActive(block.id, def)
  }, [block.id, block.default, setActive])

  // ── 1) collect rows depending on source kind ─────────────────────────
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
    : payloadToRows(data?.data ?? null) as Array<Record<string, unknown>>

  // Distinct values of `block.field`, in first-seen order. null/undefined
  // are skipped — the empty active set already means "show everything",
  // so a chip for missing is noisy.
  const distinct = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of rows) {
      const v = r[block.field]
      if (v == null) continue
      const s = String(v)
      if (!seen.has(s)) {
        seen.add(s)
        out.push(s)
      }
    }
    return out
  }, [rows, block.field])

  const multi = block.multiSelect === true

  // ── 2) render ────────────────────────────────────────────────────────
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
  } else if (distinct.length === 0) {
    body = (
      <span className="text-[11px] text-gray-500 dark:text-gray-400">
        값 없음 (field=<code>{block.field}</code>)
      </span>
    )
  } else {
    body = distinct.map((v) => {
      const isActive = active.includes(v)
      return (
        <button
          key={v}
          type="button"
          onClick={() => {
            if (multi) toggle(block.id, v)
            else setSingle(block.id, isActive ? null : v)
          }}
          aria-pressed={isActive}
          data-testid={`slicer-${block.id.slice(0, 8)}-chip-${v}`}
          className={
            'rounded-full border px-2 py-0.5 text-[11px] transition-colors ' +
            (isActive
              ? 'border-smsg-600 bg-smsg-600 text-white'
              : 'border-gray-300 bg-white text-gray-700 hover:border-smsg-400 hover:text-smsg-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:border-smsg-500')
          }
        >
          {v}
        </button>
      )
    })
  }

  return (
    <section
      className="my-2 flex flex-wrap items-center gap-1 rounded border border-gray-200 bg-white p-2 text-[11px] dark:border-gray-700 dark:bg-gray-900"
      data-block-type="slicer"
      data-block-id={block.id}
      data-slicer-field={block.field}
    >
      {block.label && (
        <span className="mr-1 font-semibold text-gray-700 dark:text-gray-200">
          {block.label}:
        </span>
      )}
      {body}
      {active.length > 0 && (
        <button
          type="button"
          onClick={() => useSlicerStore.getState().clear(block.id)}
          aria-label="clear slicer"
          data-testid={`slicer-${block.id.slice(0, 8)}-clear`}
          className="ml-1 rounded border border-gray-300 px-1 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          ✕
        </button>
      )}
    </section>
  )
}
