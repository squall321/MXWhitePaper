import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Block, DataSourceBlock as DataSourceBlockType, KpiCardsBlock } from '@/types/document'
import { getZebraClass } from '@/features/editor/blocks/zebra'
import { Sparkline } from '@/features/home/components/Sparkline'
import { WidgetExportMenu } from './WidgetExportMenu'
import { downloadBlob, drillRowsToCsv, kpiCardsToCsv } from '@/lib/widgetExport'
import { fetchDataSource } from './DataSourceBlock'
import { payloadToRows, collectSlicerFilters } from './PivotTableBlock'
import { collectTimelineFilters } from './TimelineBlock'
import { aggregateChartData, applyFilters } from './pivotEngine'
import { Modal } from '@/components/ui/Modal'
import { useEditorStore } from '@/features/editor/state'
import { useSlicerStore } from '@/features/slicer/store'

const TREND_GLYPH: Record<NonNullable<KpiCardsBlock['items'][number]['trend']>, string> = {
  up: '▲',
  down: '▼',
  flat: '→',
}

const TREND_COLOR: Record<NonNullable<KpiCardsBlock['items'][number]['trend']>, string> = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  flat: 'text-gray-500',
}

/**
 * I (cycle b) — hydrate KpiCards items by re-computing each card whose
 * `compute: {field, agg, when?}` is set against raw rows from `block.source`.
 * Cards without `compute` pass through unchanged so static + computed
 * cards can coexist in the same block.
 *
 * Cross-widget filtering: boundSlicers + block.filters are folded into a
 * single filter list, applied once per call. Per-card `when` adds an
 * extra in/eq filter scoped to that card only — useful when one block
 * shows "총 매출 / 마감 매출 / 진행중 매출" all from the same source.
 *
 * Re-aggregation reuses `aggregateChartData` with a synthetic single-
 * label (the card's index) so we get the existing agg pipeline for free.
 */
interface KpiDrillContext {
  rawRows: Array<Record<string, string | number | null>>
  allFilters: Array<{ field: string; op: string; value: unknown }>
}

function useHydratedKpiCardsBlock(block: KpiCardsBlock): {
  block: KpiCardsBlock
  drillContext: KpiDrillContext | null
} {
  const draft = useEditorStore((s) => s.draft)
  const slicerActive = useSlicerStore((s) => s.active)

  const ext = block as KpiCardsBlock & {
    source?: { kind: 'inline'; rows: Array<Record<string, unknown>> } | { kind: 'data-source'; dataSourceId: string }
    filters?: Array<{ field: string; op: string; value: unknown }>
    boundSlicers?: ReadonlyArray<string>
  }
  const source = ext.source
  const filters = ext.filters
  const boundSlicers = ext.boundSlicers

  const inline = source?.kind === 'inline'
  const dsId = source?.kind === 'data-source' ? source.dataSourceId : undefined

  const dataSourceBlock = useMemo<DataSourceBlockType | null>(() => {
    if (!dsId || !draft) return null
    for (const section of draft.sections ?? []) {
      for (const b of (section.blocks ?? []) as Block[]) {
        if (b.id === dsId && b.type === 'data-source') return b as DataSourceBlockType
      }
    }
    return null
  }, [dsId, draft])

  const endpoint = dataSourceBlock?.endpoint ?? ''
  const params = dataSourceBlock?.params ?? null
  const { data } = useQuery({
    queryKey: ['data-source', endpoint, JSON.stringify(params)],
    queryFn: () => fetchDataSource(endpoint, params),
    enabled: !inline && Boolean(endpoint),
    retry: false,
  })

  return useMemo<{ block: KpiCardsBlock; drillContext: KpiDrillContext | null }>(() => {
    // At least one item must use compute; otherwise nothing to do.
    const hasCompute = block.items.some((it) => (it as { compute?: unknown }).compute)
    if (!source || !hasCompute) return { block, drillContext: null }

    const rawRows = inline
      ? (source.rows ?? []) as Array<Record<string, unknown>>
      : (payloadToRows(data?.data ?? null) as Array<Record<string, unknown>>)

    const slicerFilters = collectSlicerFilters(boundSlicers, draft?.sections ?? [], slicerActive)
    const timelineFilters = collectTimelineFilters(boundSlicers, draft?.sections ?? [], slicerActive)
    const baseFilters = [...(filters ?? []), ...slicerFilters, ...timelineFilters] as unknown as Parameters<typeof aggregateChartData>[3]

    // Coerce non-primitive cells (Pivot 의 payloadToRows 도 같은 변환을
    // 비공식으로 하지만 chart aggregator 가 RawRow shape 을 요구해서 명시).
    const coerced = rawRows.map((r) => {
      const out: Record<string, string | number | null> = {}
      for (const [k, v] of Object.entries(r)) {
        out[k] = typeof v === 'string' || typeof v === 'number' || v === null
          ? v
          : v == null
            ? null
            : String(v)
      }
      return out
    })

    const nextItems = block.items.map((item) => {
      const compute = (item as { compute?: { field: string; agg?: 'sum' | 'avg' | 'count' | 'min' | 'max'; when?: { field: string; value: unknown } } }).compute
      if (!compute) return item

      // Per-card `when` becomes an extra filter — array → in semantic,
      // scalar → in [value] (single-element 'in' is `eq`).
      const cardFilters = compute.when
        ? [
            ...((baseFilters as unknown[]) ?? []),
            {
              field: compute.when.field,
              op: 'in',
              value: Array.isArray(compute.when.value) ? compute.when.value : [compute.when.value],
            },
          ]
        : baseFilters

      // Synthetic single-bucket: every row's label is '_' so the result
      // has exactly one number = the bucket aggregate.
      const synthetic = coerced.map((r) => ({ ...r, __kpi__: '_' }))
      const { series } = aggregateChartData(
        synthetic,
        '__kpi__',
        [{ field: compute.field, agg: compute.agg ?? 'sum' }],
        cardFilters as Parameters<typeof aggregateChartData>[3],
      )
      const value = series[0]?.values[0] ?? 0
      return { ...item, value }
    })

    return {
      block: { ...block, items: nextItems },
      drillContext: {
        rawRows: coerced,
        allFilters: baseFilters as Array<{ field: string; op: string; value: unknown }>,
      },
    }
  }, [block, source, filters, boundSlicers, data, draft, slicerActive, inline])
}

/**
 * KPI cards: small grid of label + value + delta. Trend glyph drives color.
 */
export function KpiCardsBlockView({ block: rawBlock }: { block: KpiCardsBlock }) {
  const { block, drillContext } = useHydratedKpiCardsBlock(rawBlock)
  // K-2 — drill state per item. Click a compute card → modal shows the
  // rows that contributed (after baseFilters + the card's `when`).
  const [drillIdx, setDrillIdx] = useState<number | null>(null)
  const drillCardItem =
    drillIdx !== null && block.items[drillIdx] ? block.items[drillIdx]! : null
  const drillRows = useMemo(() => {
    if (!drillContext || drillCardItem === null) return []
    const compute = (drillCardItem as { compute?: { field: string; agg?: string; when?: { field: string; value: unknown } } }).compute
    if (!compute) return []
    const cardFilters = compute.when
      ? [
          ...drillContext.allFilters,
          {
            field: compute.when.field,
            op: 'in',
            value: Array.isArray(compute.when.value) ? compute.when.value : [compute.when.value],
          },
        ]
      : drillContext.allFilters
    return applyFilters(
      [...drillContext.rawRows],
      cardFilters as Parameters<typeof applyFilters>[1],
    )
  }, [drillContext, drillCardItem])
  return (
    <div className="group relative" data-export-root="kpi-cards">
      <WidgetExportMenu
        formats={['csv']}
        getCsv={() => kpiCardsToCsv(block.items)}
        filename="kpi-cards"
      />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {block.items.map((item, idx) => {
        const zebra = getZebraClass('kpi-cards', block.options, idx)
        const surface = zebra || 'bg-white dark:bg-gray-900'
        const hasCompute = !!(item as { compute?: unknown }).compute
        const clickable = drillContext !== null && hasCompute
        return (
          <li
            key={idx}
            onClick={clickable ? () => setDrillIdx(idx) : undefined}
            className={`rounded border border-gray-200 ${surface} p-3 shadow-sm dark:border-gray-700${clickable ? ' cursor-pointer transition-colors hover:border-smsg-400' : ''}`}
            data-drill-clickable={clickable ? 'true' : undefined}
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
            <p className="mt-1 text-xl font-semibold text-smsg-900">{item.value}</p>
            {item.delta != null && (
              <p
                className={
                  'mt-1 text-xs ' +
                  (item.trend ? TREND_COLOR[item.trend] : 'text-gray-500')
                }
              >
                {item.trend ? TREND_GLYPH[item.trend] + ' ' : ''}
                {item.delta}
              </p>
            )}
            {item.sparkline && item.sparkline.values.length > 0 && (
              <div className={'mt-2 ' + (item.trend ? TREND_COLOR[item.trend] : 'text-smsg-600')}>
                <Sparkline
                  data={item.sparkline.values}
                  kind={item.sparkline.kind ?? 'line'}
                  color={item.sparkline.color}
                  palette={item.sparkline.palette}
                  width={120}
                  height={24}
                  ariaLabel={`${item.label} sparkline`}
                />
              </div>
            )}
          </li>
        )
      })}
      </ul>
      {drillIdx !== null && drillCardItem !== null && (
        <KpiDrillModal
          label={drillCardItem.label}
          rows={drillRows}
          onClose={() => setDrillIdx(null)}
        />
      )}
    </div>
  )
}

/**
 * K-2 — KpiCards drill modal. Shows the raw rows that contributed to
 * a single compute card (after base filters + the card's `when`).
 * Field union = first-seen order across the rows. Mirrors
 * ChartDrillModal in shape so users see the same modal "language"
 * everywhere.
 */
export function KpiDrillModal({
  label,
  rows,
  onClose,
}: {
  label: string
  rows: ReadonlyArray<Record<string, string | number | null | undefined>>
  onClose: () => void
}) {
  const fields = useMemo<string[]>(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of rows) {
      for (const k of Object.keys(r)) {
        if (!seen.has(k)) {
          seen.add(k)
          out.push(k)
        }
      }
    }
    return out
  }, [rows])
  return (
    <Modal open onClose={onClose} title={`${label} — 기여한 행`} size="xl">
      <div data-testid="kpi-drill-modal" className="px-5 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {rows.length === 0
              ? '이 카드에 기여한 row 가 없습니다.'
              : `${rows.length} row${rows.length === 1 ? '' : 's'}`}
          </p>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const csv = drillRowsToCsv(fields, rows as ReadonlyArray<Record<string, unknown>>)
                downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `kpi-drill-${label}.csv`)
              }}
              data-testid="kpi-drill-csv"
              className="rounded border border-gray-300 px-2 py-0.5 text-[11px] hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              📥 CSV
            </button>
          )}
        </div>
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  {fields.map((f) => (
                    <th
                      key={`kpi-drill-h-${f}`}
                      className="border-b border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
                    >
                      {f}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={`kpi-drill-r-${i}`}
                    className={i % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50'}
                  >
                    {fields.map((f) => (
                      <td
                        key={`kpi-drill-c-${i}-${f}`}
                        className="border-b border-gray-100 px-2 py-1 text-gray-800 dark:border-gray-800 dark:text-gray-200"
                      >
                        {r[f] == null ? '' : String(r[f])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}
