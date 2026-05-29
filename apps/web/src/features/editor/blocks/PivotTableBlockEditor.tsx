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
  return (
    <div data-testid="pivot-values-picker">
      <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-200">Values</p>
      <div className="mt-1 space-y-1">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-1">
            <select
              value={v.field}
              onChange={(e) =>
                onChange(
                  values.map((x, j) =>
                    j === i ? { ...x, field: e.target.value } : x,
                  ) as PivotTableBlock['values'],
                )
              }
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
            <select
              value={v.agg}
              onChange={(e) =>
                onChange(
                  values.map((x, j) =>
                    j === i ? { ...x, agg: e.target.value as Agg } : x,
                  ) as PivotTableBlock['values'],
                )
              }
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
        ))}
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
