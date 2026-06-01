/**
 * Sprint 1 — PivotTableBlockEditor (M, ~1일).
 *
 * Source: inline JSON paste (paste-rows textarea) OR CSV paste (header row +
 * data rows, comma/tab separated). Field names are auto-detected from the
 * first row; dropdowns offer Rows/Cols/Values selection.
 *
 * Values picker: field + agg (8 aggregators). Multi-value via Add button.
 *
 * DnD augmentation — Available Fields panel + drop zones for Rows / Cols /
 * Values. Dropdowns/buttons remain as accessibility fallback (the DnD layer
 * only *adds* an Excel-pivot-style gesture). The reducer `applyPivotDragEnd`
 * is exported as a pure function for testing without simulating pointer events.
 *
 * Preview: PivotTableBlockView renders the live cross-tab.
 */
import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import type { PivotTableBlock } from '@/types/document'
import { PivotTableBlockView } from '@/components/blocks/PivotTableBlock'
import { dimField, dimLabel, type DimSpec, type DateGroup } from '@/components/blocks/pivotEngine'

const DATE_GROUPS: DateGroup[] = ['year', 'quarter', 'month', 'week', 'day']

type Agg = PivotTableBlock['values'][number]['agg']
const AGGS: Agg[] = ['sum', 'count', 'avg', 'min', 'max', 'median', 'stdev', 'var']

type FilterOp = NonNullable<PivotTableBlock['filters']>[number]['op']
const FILTER_OPS: FilterOp[] = ['in', 'not_in', 'gt', 'lt', 'top_n', 'bottom_n']
type SortAxis = NonNullable<PivotTableBlock['sort']>['axis']
type SortOrder = NonNullable<NonNullable<PivotTableBlock['sort']>['order']>

function measureLabel(m: PivotTableBlock['values'][number]): string {
  if (m.label) return m.label
  // Sprint 4 — expr 가 있으면 expr 기반 label, 없으면 field 기반.
  const source = m.expr ?? m.field ?? ''
  return `${m.agg}(${source})`
}

interface PivotTableBlockEditorProps {
  block: PivotTableBlock
  onChange: (next: PivotTableBlock) => void
}

export function PivotTableBlockEditor({ block, onChange }: PivotTableBlockEditorProps) {
  const [pasteText, setPasteText] = useState('')
  const [pasteKind, setPasteKind] = useState<'csv' | 'json'>('csv')
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [dragLabel, setDragLabel] = useState<string | null>(null)

  const fields = useMemo(() => detectFields(block.source.rows), [block.source.rows])

  // ── DnD wiring — small distance constraint so chip-internal clicks (× remove
  //    button, etc.) keep working when the pointer barely moves.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  const onDragStart = useCallback((e: DragStartEvent) => {
    const id = String(e.active.id)
    if (id.startsWith('field:')) setDragLabel(id.slice('field:'.length))
    else if (id.includes(':')) setDragLabel(id.split(':')[1] ?? id)
    else setDragLabel(id)
  }, [])

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragLabel(null)
      const next = applyPivotDragEnd(block, e.active.id as string, (e.over?.id as string) ?? null)
      if (next !== block) onChange(next)
    },
    [block, onChange],
  )

  const applyPaste = useCallback(() => {
    setPasteError(null)
    try {
      const rows =
        pasteKind === 'csv'
          ? parseCsv(pasteText)
          : (JSON.parse(pasteText) as PivotTableBlock['source']['rows'])
      if (!Array.isArray(rows)) throw new Error('rows is not an array')
      onChange({
        ...block,
        source: { kind: pasteKind === 'csv' ? 'csv' : 'inline', rows },
      })
      setPasteText('')
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : String(err))
    }
  }, [pasteText, pasteKind, block, onChange])

  return (
    <div
      className="my-2 rounded border border-gray-200 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-900"
      data-block-editor="pivot-table"
    >
      <header className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          🔀 Pivot Table
        </h4>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          source rows: {block.source.rows.length}
        </span>
      </header>

      {/* Source paste */}
      <section className="mb-3 rounded border border-dashed border-gray-300 p-2 dark:border-gray-700">
        <div className="mb-1 flex items-center gap-3 text-[11px]">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`pivot-paste-${block.id}`}
              checked={pasteKind === 'csv'}
              onChange={() => setPasteKind('csv')}
            />
            CSV paste
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name={`pivot-paste-${block.id}`}
              checked={pasteKind === 'json'}
              onChange={() => setPasteKind('json')}
            />
            JSON rows
          </label>
        </div>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={
            pasteKind === 'csv'
              ? 'department,year,revenue\nSales,2024,100\nR&D,2024,80'
              : '[{"department":"Sales","year":2024,"revenue":100}, ...]'
          }
          rows={4}
          className="block w-full rounded border border-gray-300 bg-white p-1.5 font-mono text-[11px] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          data-testid="pivot-paste-textarea"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={applyPaste}
            disabled={pasteText.trim().length === 0}
            className="rounded bg-smsg-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-smsg-700 disabled:opacity-50"
            data-testid="pivot-paste-apply"
          >
            적용
          </button>
          {pasteError && (
            <span className="text-[11px] text-red-600 dark:text-red-400">{pasteError}</span>
          )}
        </div>
      </section>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Available Fields panel — drag source for Excel-pivot UX. The
            existing dropdowns inside each zone remain as accessibility/
            keyboard fallback. */}
        <AvailableFieldsPanel fields={fields} />

        {/* Pickers — each is a drop zone */}
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <DimPicker
            label="Rows"
            zone="rows"
            dims={block.rows}
            fields={fields}
            onChange={(rows) => onChange({ ...block, rows })}
            testid="pivot-rows-picker"
          />
          <DimPicker
            label="Cols"
            zone="cols"
            dims={block.cols}
            fields={fields}
            onChange={(cols) => onChange({ ...block, cols })}
            testid="pivot-cols-picker"
          />
          <ValuesPicker
            values={block.values}
            fields={fields}
            onChange={(values) => onChange({ ...block, values })}
          />
        </div>

        <DragOverlay>
          {dragLabel ? (
            <span
              className="inline-flex items-center rounded bg-smsg-600 px-2 py-0.5 text-[11px] font-medium text-white shadow"
              data-testid="pivot-drag-overlay"
            >
              {dragLabel}
            </span>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Totals / Sort / Filters (Sprint 2) */}
      <TotalsPicker block={block} onChange={onChange} />
      <SortPicker block={block} onChange={onChange} />
      <FiltersPicker block={block} fields={fields} onChange={onChange} />

      {/* Calculated items (Sprint 5) */}
      <CalculatedItemsPicker block={block} onChange={onChange} />

      {/* Preview */}
      <section className="border-t border-gray-200 pt-2 dark:border-gray-700">
        <h5 className="mb-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
          미리보기
        </h5>
        <PivotTableBlockView block={block} />
      </section>
    </div>
  )
}

function AvailableFieldsPanel({ fields }: { fields: string[] }) {
  if (fields.length === 0) return null
  return (
    <section
      className="mb-2 rounded border border-dashed border-gray-300 p-2 dark:border-gray-700"
      data-testid="pivot-available-fields"
    >
      <p className="mb-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
        Available Fields
      </p>
      <p className="mb-1 text-[10px] text-gray-500 dark:text-gray-400">
        감지된 필드: {fields.join(', ')}{' '}
        <span className="text-[10px] text-gray-400">(드래그하여 Rows/Cols/Values 에 추가)</span>
      </p>
      <div className="flex flex-wrap gap-1">
        {fields.map((f) => (
          <DraggableField key={f} name={f} />
        ))}
      </div>
    </section>
  )
}

function DraggableField({ name }: { name: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: fieldDragId(name),
  })
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={`${name} 드래그`}
      data-testid={`pivot-field-${name}`}
      className={
        'inline-flex cursor-grab items-center rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700 hover:border-smsg-400 hover:bg-smsg-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 ' +
        (isDragging ? 'opacity-30' : '')
      }
    >
      <span aria-hidden="true" className="mr-1 text-gray-400">⋮⋮</span>
      {name}
    </button>
  )
}

function DroppableZone({
  zone,
  children,
  className = '',
}: {
  zone: PivotZone
  children: React.ReactNode
  className?: string
}) {
  const { isOver, setNodeRef } = useDroppable({ id: zoneDropId(zone) })
  return (
    <div
      ref={setNodeRef}
      data-testid={`pivot-dropzone-${zone}`}
      className={
        className +
        ' rounded transition-colors ' +
        (isOver ? 'bg-smsg-50 ring-1 ring-smsg-400 dark:bg-smsg-900/30' : '')
      }
    >
      {children}
    </div>
  )
}

function DraggableDimChip({
  name,
  zone,
  index,
  onRemove,
}: {
  name: string
  zone: PivotZone
  index: number
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: itemDragId(zone, index),
  })
  return (
    <span
      ref={setNodeRef}
      data-testid={`pivot-${zone}-chip-${index}`}
      className={
        'inline-flex cursor-grab items-center gap-0.5 rounded bg-smsg-100 px-1.5 py-0.5 text-[11px] text-smsg-800 dark:bg-smsg-900/40 dark:text-smsg-200 ' +
        (isDragging ? 'opacity-30' : '')
      }
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={`${name} 드래그`}
        className="cursor-grab text-smsg-500"
      >
        ⋮⋮
      </span>
      {name}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${name} 제거`}
        className="ml-0.5 text-smsg-600 hover:text-red-600 dark:text-smsg-400"
      >
        ×
      </button>
    </span>
  )
}

function DimPicker({
  label,
  zone,
  dims,
  fields,
  onChange,
  testid,
}: {
  label: string
  zone: PivotZone
  dims: DimSpec[]
  fields: string[]
  onChange: (next: DimSpec[]) => void
  testid: string
}) {
  // Sprint 5 — each chip now exposes a "그룹" dropdown (year/quarter/…)
  // when the user wants to bucket a date-typed field. The list of
  // already-picked fields uses `dimField` so re-adding the same field
  // with a different group is allowed (e.g. row=year(date), col=month(date)).
  const usedFields = new Set(dims.map(dimField))
  return (
    <DroppableZone zone={zone} className="p-1">
      <div data-testid={testid}>
        <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{label}</p>
        <div className="mt-1 flex min-h-[1.5rem] flex-wrap gap-1">
          {dims.length === 0 && (
            <span className="text-[10px] italic text-gray-400 dark:text-gray-500">
              필드 드래그
            </span>
          )}
          {dims.map((d, i) => {
            const field = dimField(d)
            const group = typeof d === 'string' ? '' : (d.group ?? '')
            return (
              <span key={`${dimLabel(d)}-${i}`} className="inline-flex items-center gap-1">
                <DraggableDimChip
                  name={dimLabel(d)}
                  zone={zone}
                  index={i}
                  onRemove={() => onChange(dims.filter((_, j) => j !== i))}
                />
                <select
                  value={group}
                  onChange={(e) => {
                    const next = e.target.value as '' | DateGroup
                    const replacement: DimSpec = next ? { field, group: next } : field
                    onChange(dims.map((x, j) => (j === i ? replacement : x)))
                  }}
                  aria-label={`${dimLabel(d)} 시간 그룹`}
                  data-testid={`pivot-dim-group-${field}`}
                  className="rounded border border-gray-300 bg-white px-1 text-[10px] dark:border-gray-600 dark:bg-gray-800"
                >
                  <option value="">raw</option>
                  {DATE_GROUPS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </span>
            )
          })}
        </div>
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onChange([...dims, e.target.value])
          }}
          aria-label={`${label} 필드 추가`}
          className="mt-1 block w-full rounded border border-gray-300 bg-white p-1 text-[11px] dark:border-gray-600 dark:bg-gray-800"
        >
          <option value="">+ 필드 추가</option>
          {fields
            .filter((f) => !usedFields.has(f))
            .map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
        </select>
      </div>
    </DroppableZone>
  )
}

function ValuesPicker({
  values,
  fields,
  onChange,
}: {
  values: PivotTableBlock['values']
  fields: string[]
  onChange: (next: PivotTableBlock['values']) => void
  // (caller passes maybe-empty arrays during edits — cast as ValuesArr inside)
}) {
  // Sprint 4 — each measure is either field-based (default) or expr-based
  // (calculated field). Toggle replaces the field <select> with an <input>
  // expression editor and shows the detected fields as a hint.
  const updateAt = (i: number, patch: Partial<PivotTableBlock['values'][number]>) =>
    onChange(
      values.map((x, j) => (j === i ? { ...x, ...patch } : x)) as PivotTableBlock['values'],
    )

  return (
    <DroppableZone zone="values" className="p-1">
      <div data-testid="pivot-values-picker">
        <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">Values</p>
        <div className="mt-1 space-y-1">
          {values.map((v, i) => {
            const mode: 'field' | 'expr' = v.expr != null ? 'expr' : 'field'
            return (
              <DraggableValueRow key={i} zone="values" index={i}>
                <div
                  className="rounded border border-gray-200 p-1 dark:border-gray-700"
                  data-testid={`pivot-value-row-${i}`}
                >
              <div className="mb-1 flex items-center gap-2 text-[11px]">
                <span className="text-gray-500 dark:text-gray-400">mode:</span>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`pivot-value-mode-${i}`}
                    checked={mode === 'field'}
                    onChange={() => {
                      // Switching to field mode: drop expr.
                      const next = values.map((x, j) =>
                        j === i ? { field: x.field ?? '', agg: x.agg, label: x.label, showAs: x.showAs, numberFormat: x.numberFormat } : x,
                      ) as PivotTableBlock['values']
                      onChange(next)
                    }}
                    data-testid={`pivot-value-mode-field-${i}`}
                  />
                  field
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name={`pivot-value-mode-${i}`}
                    checked={mode === 'expr'}
                    onChange={() => {
                      // Switching to expr mode: drop field, seed empty expr.
                      const next = values.map((x, j) =>
                        j === i ? { expr: x.expr ?? '', agg: x.agg, label: x.label, showAs: x.showAs, numberFormat: x.numberFormat } : x,
                      ) as PivotTableBlock['values']
                      onChange(next)
                    }}
                    data-testid={`pivot-value-mode-expr-${i}`}
                  />
                  expr
                </label>
              </div>
              <div className="flex items-center gap-1">
                {mode === 'field' ? (
                  <select
                    value={v.field ?? ''}
                    onChange={(e) => updateAt(i, { field: e.target.value })}
                    aria-label={`value ${i + 1} field`}
                    className="flex-1 rounded border border-gray-300 bg-white p-1 text-[11px] dark:border-gray-600 dark:bg-gray-800"
                  >
                    <option value="">필드</option>
                    {fields.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                ) : (
                  <textarea
                    value={v.expr ?? ''}
                    onChange={(e) => updateAt(i, { expr: e.target.value })}
                    aria-label={`value ${i + 1} expr`}
                    placeholder="revenue - cost"
                    rows={1}
                    className="flex-1 rounded border border-gray-300 bg-white p-1 font-mono text-[11px] dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    data-testid={`pivot-value-expr-${i}`}
                  />
                )}
                <select
                  value={v.agg}
                  onChange={(e) => updateAt(i, { agg: e.target.value as Agg })}
                  aria-label={`value ${i + 1} agg`}
                  className="w-20 rounded border border-gray-300 bg-white p-1 text-[11px] dark:border-gray-600 dark:bg-gray-800"
                >
                  {AGGS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={values.length <= 1}
                  onClick={() =>
                    onChange(
                      values.filter((_, j) => j !== i) as PivotTableBlock['values'],
                    )
                  }
                  aria-label={`value ${i + 1} 제거`}
                  className="text-smsg-600 hover:text-red-600 disabled:opacity-40 dark:text-smsg-400"
                >
                  ×
                </button>
              </div>
              {mode === 'expr' && fields.length > 0 && (
                <p
                  className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400"
                  data-testid={`pivot-value-expr-fields-${i}`}
                >
                  사용 가능 fields: {fields.join(', ')}
                </p>
              )}
                </div>
              </DraggableValueRow>
            )
          })}
          <button
            type="button"
            onClick={() =>
              onChange([
                ...values,
                { field: '', agg: 'sum' },
              ] as PivotTableBlock['values'])
            }
            className="mt-0.5 text-[11px] text-smsg-700 hover:underline dark:text-smsg-300"
            data-testid="pivot-add-value"
          >
            + measure 추가
          </button>
        </div>
      </div>
    </DroppableZone>
  )
}

function DraggableValueRow({
  zone,
  index,
  children,
}: {
  zone: PivotZone
  index: number
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: itemDragId(zone, index),
  })
  return (
    <div
      ref={setNodeRef}
      data-testid={`pivot-${zone}-row-drag-${index}`}
      className={'relative ' + (isDragging ? 'opacity-30' : '')}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`value ${index + 1} 드래그`}
        className="absolute right-1 top-1 cursor-grab text-gray-400 hover:text-gray-700"
      >
        ⋮⋮
      </button>
      {children}
    </div>
  )
}

function TotalsPicker({
  block,
  onChange,
}: {
  block: PivotTableBlock
  onChange: (next: PivotTableBlock) => void
}) {
  const totals = block.totals ?? {}
  const update = (patch: Partial<NonNullable<PivotTableBlock['totals']>>) => {
    const next = { ...totals, ...patch }
    // Drop totals key entirely when all toggles are off (yagni).
    const anyOn = next.grand || next.row || next.col
    const out = { ...block }
    if (anyOn) out.totals = next
    else delete out.totals
    onChange(out)
  }
  return (
    <section
      className="mb-2 rounded border border-dashed border-gray-200 p-2 dark:border-gray-700"
      data-testid="pivot-totals-picker"
    >
      <p className="mb-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">Totals</p>
      <div className="flex flex-wrap gap-3 text-[11px]">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!totals.grand}
            onChange={(e) => update({ grand: e.target.checked })}
            data-testid="pivot-totals-grand"
          />
          Grand
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!totals.row}
            onChange={(e) => update({ row: e.target.checked })}
            data-testid="pivot-totals-row"
          />
          Row
        </label>
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={!!totals.col}
            onChange={(e) => update({ col: e.target.checked })}
            data-testid="pivot-totals-col"
          />
          Col
        </label>
      </div>
    </section>
  )
}

function SortPicker({
  block,
  onChange,
}: {
  block: PivotTableBlock
  onChange: (next: PivotTableBlock) => void
}) {
  const sort = block.sort
  const axis: SortAxis = sort?.axis ?? 'row'
  // Sprint 5 — rows/cols are DimSpec[]; sort.by compares against dimLabel.
  const byOptions: string[] =
    axis === 'row'
      ? [...block.rows.map(dimLabel), ...block.values.map(measureLabel)]
      : [...block.cols.map(dimLabel), ...block.values.map(measureLabel)]
  const update = (next: PivotTableBlock['sort'] | undefined) => {
    const out = { ...block }
    if (next && next.by) out.sort = next
    else delete out.sort
    onChange(out)
  }
  return (
    <section
      className="mb-2 rounded border border-dashed border-gray-200 p-2 dark:border-gray-700"
      data-testid="pivot-sort-picker"
    >
      <p className="mb-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">Sort</p>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span>axis:</span>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`pivot-sort-axis-${block.id}`}
            checked={axis === 'row'}
            onChange={() =>
              update({ axis: 'row', by: sort?.by ?? '', order: sort?.order ?? 'asc' })
            }
          />
          row
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`pivot-sort-axis-${block.id}`}
            checked={axis === 'col'}
            onChange={() =>
              update({ axis: 'col', by: sort?.by ?? '', order: sort?.order ?? 'asc' })
            }
          />
          col
        </label>
        <span className="ml-2">by:</span>
        <select
          value={sort?.by ?? ''}
          onChange={(e) =>
            update(
              e.target.value
                ? { axis, by: e.target.value, order: sort?.order ?? 'asc' }
                : undefined,
            )
          }
          data-testid="pivot-sort-by"
          aria-label="sort by"
          className="rounded border border-gray-300 bg-white p-0.5 text-[11px] dark:border-gray-600 dark:bg-gray-800"
        >
          <option value="">(none)</option>
          {byOptions.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <span className="ml-2">order:</span>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`pivot-sort-order-${block.id}`}
            checked={(sort?.order ?? 'asc') === 'asc'}
            disabled={!sort?.by}
            onChange={() =>
              sort?.by && update({ axis, by: sort.by, order: 'asc' as SortOrder })
            }
          />
          asc
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name={`pivot-sort-order-${block.id}`}
            checked={sort?.order === 'desc'}
            disabled={!sort?.by}
            onChange={() =>
              sort?.by && update({ axis, by: sort.by, order: 'desc' as SortOrder })
            }
          />
          desc
        </label>
      </div>
    </section>
  )
}

function FiltersPicker({
  block,
  fields,
  onChange,
}: {
  block: PivotTableBlock
  fields: string[]
  onChange: (next: PivotTableBlock) => void
}) {
  const filters = block.filters ?? []
  const update = (next: NonNullable<PivotTableBlock['filters']>) => {
    const out = { ...block }
    if (next.length > 0) out.filters = next
    else delete out.filters
    onChange(out)
  }
  const add = () => {
    const first = fields[0] ?? ''
    update([...filters, { field: first, op: 'in', value: '' }])
  }
  return (
    <section
      className="mb-2 rounded border border-dashed border-gray-200 p-2 dark:border-gray-700"
      data-testid="pivot-filters-picker"
    >
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">Filters</p>
        <button
          type="button"
          onClick={add}
          className="rounded bg-smsg-600 px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-smsg-700"
          data-testid="pivot-add-filter"
        >
          + Add filter
        </button>
      </div>
      <div className="space-y-1">
        {filters.map((f, i) => (
          <div
            key={i}
            className="flex items-center gap-1 text-[11px]"
            data-testid={`pivot-filter-row-${i}`}
          >
            <select
              value={f.field}
              onChange={(e) =>
                update(
                  filters.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)),
                )
              }
              aria-label={`filter ${i + 1} field`}
              className="flex-1 rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="">필드</option>
              {fields.map((fld) => (
                <option key={fld} value={fld}>
                  {fld}
                </option>
              ))}
            </select>
            <select
              value={f.op}
              onChange={(e) =>
                update(
                  filters.map((x, j) =>
                    j === i ? { ...x, op: e.target.value as FilterOp } : x,
                  ),
                )
              }
              aria-label={`filter ${i + 1} op`}
              className="w-20 rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
            >
              {FILTER_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={
                Array.isArray(f.value)
                  ? (f.value as unknown[]).join(',')
                  : f.value == null
                    ? ''
                    : String(f.value)
              }
              onChange={(e) => {
                const raw = e.target.value
                const isList = f.op === 'in' || f.op === 'not_in'
                const value: unknown = isList
                  ? raw
                      .split(',')
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0)
                  : raw
                update(filters.map((x, j) => (j === i ? { ...x, value } : x)))
              }}
              aria-label={`filter ${i + 1} value`}
              placeholder={
                f.op === 'in' || f.op === 'not_in' ? 'a,b,c' : 'value'
              }
              className="flex-1 rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
            />
            <button
              type="button"
              onClick={() => update(filters.filter((_, j) => j !== i))}
              aria-label={`filter ${i + 1} 제거`}
              className="text-smsg-600 hover:text-red-600 dark:text-smsg-400"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── DnD identifiers + reducer (exported for testing) ──────────────────

export type PivotZone = 'rows' | 'cols' | 'values'

/** DnD id grammar — single string so dnd-kit's UniqueIdentifier works.
 *  - `field:<name>`        — Available Fields panel item (source only)
 *  - `zone:<rows|cols|values>` — drop zone container itself
 *  - `<rows|cols|values>:<index>` — chip/row inside a zone (source + over) */
export function fieldDragId(name: string): string {
  return `field:${name}`
}
export function zoneDropId(zone: PivotZone): string {
  return `zone:${zone}`
}
export function itemDragId(zone: PivotZone, index: number): string {
  return `${zone}:${index}`
}

interface ParsedDragId {
  kind: 'field' | 'zone' | 'item'
  zone?: PivotZone
  name?: string
  index?: number
}

function parseDragId(id: string | number | null | undefined): ParsedDragId | null {
  if (id == null) return null
  const s = String(id)
  if (s.startsWith('field:')) return { kind: 'field', name: s.slice('field:'.length) }
  if (s.startsWith('zone:')) {
    const z = s.slice('zone:'.length) as PivotZone
    if (z === 'rows' || z === 'cols' || z === 'values') return { kind: 'zone', zone: z }
    return null
  }
  const m = /^(rows|cols|values):(\d+)$/.exec(s)
  if (m) return { kind: 'item', zone: m[1] as PivotZone, index: Number(m[2]) }
  return null
}

/** Resolve which zone a drag is over — direct zone drop or a chip within
 *  the zone both count. */
function resolveTargetZone(over: ParsedDragId | null): PivotZone | null {
  if (!over) return null
  if (over.kind === 'zone') return over.zone ?? null
  if (over.kind === 'item') return over.zone ?? null
  return null
}

/** Pure reducer — pivot block + dnd-kit DragEndEvent ids → next pivot block.
 *  Returns the same `block` reference (no-op) when the drag is meaningless
 *  so callers can cheap-check via `next === block` if they want. */
export function applyPivotDragEnd(
  block: PivotTableBlock,
  activeId: string | null | undefined,
  overId: string | null | undefined,
): PivotTableBlock {
  const active = parseDragId(activeId)
  const over = parseDragId(overId)
  if (!active || !over) return block
  const targetZone = resolveTargetZone(over)
  if (!targetZone) return block

  // ── Available Fields → drop zone ──
  if (active.kind === 'field' && active.name != null) {
    const name = active.name
    if (targetZone === 'values') {
      // Push a new measure with default agg=sum (multi-mode preserved).
      const nextValues = [...block.values, { field: name, agg: 'sum' as const }]
      return { ...block, values: nextValues as PivotTableBlock['values'] }
    }
    // rows / cols — skip if already present (same-zone dup avoided).
    const arr = targetZone === 'rows' ? block.rows : block.cols
    if (arr.includes(name)) return block
    const nextArr = [...arr, name]
    return targetZone === 'rows'
      ? { ...block, rows: nextArr }
      : { ...block, cols: nextArr }
  }

  // ── Item drag (reorder within zone OR move between dim zones) ──
  if (active.kind === 'item' && active.zone && active.index != null) {
    const sourceZone = active.zone
    const sourceIndex = active.index

    // values <-> rows/cols cross moves don't have a sensible mapping
    // (values carry agg/expr metadata). Restrict to dim<->dim or same-zone.
    if (sourceZone === 'values' && targetZone !== 'values') return block
    if (targetZone === 'values' && sourceZone !== 'values') return block

    if (sourceZone === targetZone) {
      // Reorder within the same zone.
      const overIndex = over.kind === 'item' && over.index != null ? over.index : -1
      if (overIndex < 0 || overIndex === sourceIndex) return block
      if (sourceZone === 'values') {
        const arr = [...block.values]
        const [moved] = arr.splice(sourceIndex, 1)
        if (!moved) return block
        arr.splice(overIndex, 0, moved)
        return { ...block, values: arr as PivotTableBlock['values'] }
      }
      const arr = sourceZone === 'rows' ? [...block.rows] : [...block.cols]
      const [moved] = arr.splice(sourceIndex, 1)
      if (moved == null) return block
      arr.splice(overIndex, 0, moved)
      return sourceZone === 'rows' ? { ...block, rows: arr } : { ...block, cols: arr }
    }

    // Cross-zone dim move (rows <-> cols).
    const sourceArr = sourceZone === 'rows' ? block.rows : block.cols
    const moved = sourceArr[sourceIndex]
    if (moved == null) return block
    const nextSource = sourceArr.filter((_, i) => i !== sourceIndex)
    const targetArr = targetZone === 'rows' ? block.rows : block.cols
    if (targetArr.includes(moved)) {
      // Already present in target — just remove from source.
      return sourceZone === 'rows'
        ? { ...block, rows: nextSource }
        : { ...block, cols: nextSource }
    }
    const nextTarget = [...targetArr, moved]
    const out = { ...block }
    if (sourceZone === 'rows') out.rows = nextSource
    else out.cols = nextSource
    if (targetZone === 'rows') out.rows = nextTarget
    else out.cols = nextTarget
    return out
  }

  return block
}

// ── helpers (exported for testing) ─────────────────────────────────────

export function detectFields(rows: PivotTableBlock['source']['rows']): string[] {
  const set = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r)) set.add(k)
  return [...set]
}

/**
 * Minimal CSV parser — RFC 4180 quote handling, comma OR tab separator
 * auto-detected from header line. First line = field names. Subsequent
 * lines = data rows. Numeric-looking values coerced; otherwise string.
 */
export function parseCsv(text: string): PivotTableBlock['source']['rows'] {
  const trimmed = text.replace(/\r\n/g, '\n').replace(/^﻿/, '').trim()
  if (!trimmed) return []
  const lines = trimmed.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return []
  const sep = (lines[0] as string).includes('\t') ? '\t' : ','
  const headers = splitCsvLine(lines[0] as string, sep)
  const out: PivotTableBlock['source']['rows'] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i] as string, sep)
    const row: Record<string, string | number | null> = {}
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] as string
      const raw = cells[c] ?? ''
      if (raw === '') {
        row[key] = null
      } else {
        const n = Number(raw)
        row[key] = Number.isFinite(n) && raw.trim() === String(n) ? n : raw
      }
    }
    out.push(row)
  }
  return out
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let buf = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          buf += '"'
          i++
        } else {
          inQ = false
        }
      } else {
        buf += ch
      }
    } else if (ch === '"') {
      inQ = true
    } else if (ch === sep) {
      out.push(buf)
      buf = ''
    } else {
      buf += ch
    }
  }
  out.push(buf)
  return out
}

// ── Sprint 5 — calculated items picker ──────────────────────────────────
type CalcItem = NonNullable<PivotTableBlock['calculatedItems']>[number]

function CalculatedItemsPicker({
  block,
  onChange,
}: {
  block: PivotTableBlock
  onChange: (next: PivotTableBlock) => void
}) {
  const items: CalcItem[] = block.calculatedItems ?? []
  const update = (next: CalcItem[]) => {
    const out = { ...block }
    if (next.length === 0) delete out.calculatedItems
    else out.calculatedItems = next as PivotTableBlock['calculatedItems']
    onChange(out)
  }
  return (
    <section
      data-testid="pivot-calc-items"
      className="mt-2 rounded border border-dashed border-gray-300 p-2 dark:border-gray-700"
    >
      <p className="mb-1 text-[11px] font-semibold text-gray-700 dark:text-gray-200">
        Calculated items
        <span className="ml-1 font-normal text-gray-500 dark:text-gray-400">
          (e.g. <code>`Jan` + `Feb` + `Mar`</code>)
        </span>
      </p>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li key={i} className="flex flex-wrap items-center gap-1 text-[11px]">
              <select
                value={it.axis}
                onChange={(e) =>
                  update(
                    items.map((x, j) =>
                      j === i ? { ...x, axis: e.target.value as 'row' | 'col' } : x,
                    ),
                  )
                }
                data-testid={`pivot-calc-item-${i}-axis`}
                aria-label="axis"
                className="rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
              >
                <option value="row">row</option>
                <option value="col">col</option>
              </select>
              <input
                type="text"
                value={it.name}
                onChange={(e) =>
                  update(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                }
                placeholder="name (e.g. Q1)"
                aria-label="name"
                data-testid={`pivot-calc-item-${i}-name`}
                className="w-24 rounded border border-gray-300 bg-white p-0.5 dark:border-gray-600 dark:bg-gray-800"
              />
              <span>=</span>
              <input
                type="text"
                value={it.formula}
                onChange={(e) =>
                  update(items.map((x, j) => (j === i ? { ...x, formula: e.target.value } : x)))
                }
                placeholder="`Jan` + `Feb` + `Mar`"
                aria-label="formula"
                data-testid={`pivot-calc-item-${i}-formula`}
                className="min-w-0 flex-1 rounded border border-gray-300 bg-white p-0.5 font-mono dark:border-gray-600 dark:bg-gray-800"
              />
              <button
                type="button"
                onClick={() => update(items.filter((_, j) => j !== i))}
                aria-label="remove calculated item"
                data-testid={`pivot-calc-item-${i}-remove`}
                className="rounded border border-gray-300 px-1 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() =>
          update([...items, { axis: 'row', name: '', formula: '' }])
        }
        data-testid="pivot-calc-item-add"
        className="mt-1 rounded border border-gray-300 px-1.5 py-0.5 text-[11px] hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
      >
        + add
      </button>
    </section>
  )
}
