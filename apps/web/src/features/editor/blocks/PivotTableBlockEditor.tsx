/**
 * Sprint 1 — PivotTableBlockEditor (M, ~1일).
 *
 * Source: inline JSON paste (paste-rows textarea) OR CSV paste (header row +
 * data rows, comma/tab separated). Field names are auto-detected from the
 * first row; dropdowns offer Rows/Cols/Values selection.
 *
 * Values picker: field + agg (8 aggregators). Multi-value via Add button.
 *
 * Preview: PivotTableBlockView renders the live cross-tab.
 */
import { useCallback, useMemo, useState } from 'react'
import type { PivotTableBlock } from '@/types/document'
import { PivotTableBlockView } from '@/components/blocks/PivotTableBlock'

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

  const fields = useMemo(() => detectFields(block.source.rows), [block.source.rows])

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

      {/* Detected fields */}
      {fields.length > 0 && (
        <p className="mb-2 text-[11px] text-gray-600 dark:text-gray-400">
          감지된 필드: {fields.join(', ')}
        </p>
      )}

      {/* Pickers */}
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <DimPicker
          label="Rows"
          dims={block.rows}
          fields={fields}
          onChange={(rows) => onChange({ ...block, rows })}
          testid="pivot-rows-picker"
        />
        <DimPicker
          label="Cols"
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

      {/* Totals / Sort / Filters (Sprint 2) */}
      <TotalsPicker block={block} onChange={onChange} />
      <SortPicker block={block} onChange={onChange} />
      <FiltersPicker block={block} fields={fields} onChange={onChange} />

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

function DimPicker({
  label,
  dims,
  fields,
  onChange,
  testid,
}: {
  label: string
  dims: string[]
  fields: string[]
  onChange: (next: string[]) => void
  testid: string
}) {
  return (
    <div data-testid={testid}>
      <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {dims.map((d, i) => (
          <span
            key={`${d}-${i}`}
            className="inline-flex items-center gap-0.5 rounded bg-smsg-100 px-1.5 py-0.5 text-[11px] text-smsg-800 dark:bg-smsg-900/40 dark:text-smsg-200"
          >
            {d}
            <button
              type="button"
              onClick={() => onChange(dims.filter((_, j) => j !== i))}
              aria-label={`${d} 제거`}
              className="ml-0.5 text-smsg-600 hover:text-red-600 dark:text-smsg-400"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) onChange([...dims, e.target.value])
        }}
        className="mt-1 block w-full rounded border border-gray-300 bg-white p-1 text-[11px] dark:border-gray-600 dark:bg-gray-800"
      >
        <option value="">+ 필드 추가</option>
        {fields
          .filter((f) => !dims.includes(f))
          .map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
      </select>
    </div>
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
    <div data-testid="pivot-values-picker">
      <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">Values</p>
      <div className="mt-1 space-y-1">
        {values.map((v, i) => {
          const mode: 'field' | 'expr' = v.expr != null ? 'expr' : 'field'
          return (
            <div
              key={i}
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
  const byOptions =
    axis === 'row'
      ? [...block.rows, ...block.values.map(measureLabel)]
      : [...block.cols, ...block.values.map(measureLabel)]
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
