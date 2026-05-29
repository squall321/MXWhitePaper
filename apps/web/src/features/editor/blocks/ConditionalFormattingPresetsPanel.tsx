import { useMemo, useState } from 'react'
import type { TableBlock } from '@/types/document'
import {
  PRESET_LIST,
  appendPresetRules,
  type PresetId,
} from '@/components/blocks/conditionalPresets'
import type { ConditionalRule } from '@/components/blocks/conditionalFormatting'

interface Props {
  block: TableBlock
  /**
   * Column headers used to label the column picker. Sparse tables lift
   * names from their header row upstream and pass them in here.
   */
  headerNames: string[]
  /** Patches partial fields onto the local table block (debounced upstream). */
  onChange: (patch: Partial<TableBlock>) => void
}

type RawRule = NonNullable<TableBlock['options']>['conditionalFormatting'] extends
  | infer T
  | undefined
  ? T extends Array<infer U>
    ? U
    : never
  : never

/**
 * Extract a column's raw cell values from both flat and sparse tables.
 * Mirrors the same logic the renderer uses for `columnValuesByCol`. Kept
 * local because it's only needed by this panel; promoting it to a shared
 * helper would add an import surface for one caller.
 */
function columnValues(block: TableBlock, colIndex: number): string[] {
  const out: string[] = []
  if (block.cells && block.cells.length > 0) {
    for (const cell of block.cells) {
      if (cell.header) continue
      if (cell.blocks) continue
      if (cell.c !== colIndex) continue
      out.push(cell.text ?? '')
    }
    return out
  }
  for (const row of block.rows) {
    out.push(row[colIndex] ?? '')
  }
  return out
}

function describeRule(rule: ConditionalRule): string {
  const col =
    rule.column === undefined
      ? '전체'
      : typeof rule.column === 'number'
        ? `${rule.column + 1}열`
        : `"${rule.column}"`
  const opLabel: Record<ConditionalRule['operator'], string> = {
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    eq: '=',
    neq: '≠',
    between: '∈',
    top_n: '상위',
    bottom_n: '하위',
    contains: '⊃',
    not_contains: '⊅',
  }
  const v = Array.isArray(rule.value)
    ? `[${rule.value.join(', ')}]`
    : String(rule.value)
  return `${col} ${opLabel[rule.operator]} ${v}`
}

/**
 * Excel-style conditional formatting presets surfaced as one-click buttons.
 *
 * Why a separate panel (rather than folding into TableOptionsPanel)? The
 * presets emit *rules* — a list of objects — whereas TableOptionsPanel
 * deals with simple scalar toggles. Mixing the two would also bloat the
 * panel for users who never need conditional formatting. The panel renders
 * only when the table has at least one column, so brand-new empty tables
 * don't see a stray section.
 */
export function ConditionalFormattingPresetsPanel({
  block,
  headerNames,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [colIndex, setColIndex] = useState(0)
  const opts = block.options ?? {}
  const currentRulesRaw = opts.conditionalFormatting as RawRule[] | undefined
  const currentRules = currentRulesRaw ?? []
  const colCount = headerNames.length

  // Resolve the user-picked column → header text when present, else fall
  // back to the 0-based index. Header-text scope keeps the rule meaningful
  // after column reorder; index scope is only used when the header is empty.
  const columnScope = useMemo<string | number>(() => {
    const name = headerNames[colIndex]
    return name && name.trim() ? name : colIndex
  }, [headerNames, colIndex])

  if (colCount === 0) return null

  const applyPreset = (id: PresetId) => {
    const values = columnValues(block, colIndex)
    const merged = appendPresetRules(
      currentRulesRaw as ConditionalRule[] | undefined,
      id,
      columnScope,
      values,
    )
    // Identity-equal → preset emitted nothing (no numeric data, etc.). Skip
    // the patch so we don't trigger a needless save round trip.
    if (merged === (currentRulesRaw as ConditionalRule[] | undefined)) return
    onChange({
      options: { ...opts, conditionalFormatting: merged as RawRule[] },
    })
  }

  const removeRule = (idx: number) => {
    const merged = currentRules.filter((_, i) => i !== idx)
    onChange({
      options: {
        ...opts,
        conditionalFormatting: merged.length > 0 ? merged : undefined,
      },
    })
  }

  const clearAll = () => {
    onChange({ options: { ...opts, conditionalFormatting: undefined } })
  }

  return (
    <div
      data-cf-presets
      className="rounded border border-gray-200 bg-white text-xs"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        aria-expanded={open}
        data-action="toggle-cf-presets"
      >
        <span className="font-semibold">
          🎨 조건부 서식 프리셋
          {currentRules.length > 0 && (
            <span className="ml-1 rounded bg-smsg-100 px-1 text-[10px] text-smsg-700">
              {currentRules.length}
            </span>
          )}
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-gray-200 px-3 py-3">
          <label className="flex items-center gap-2">
            <span className="w-16 text-gray-600">대상 열</span>
            <select
              value={colIndex}
              onChange={(e) => setColIndex(Number(e.target.value))}
              aria-label="조건부 서식 대상 열"
              data-cf-column
              className="flex-1 rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
            >
              {Array.from({ length: colCount }).map((_, c) => (
                <option key={c} value={c}>
                  {headerNames[c]?.trim() ? headerNames[c] : `${c + 1}열`}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-1">
            {PRESET_LIST.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                title={p.description}
                data-cf-preset={p.id}
                className="rounded border border-smsg-200 bg-white px-2 py-1 text-smsg-700 hover:bg-smsg-50"
              >
                {p.label}
              </button>
            ))}
          </div>

          {currentRules.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">적용된 규칙 ({currentRules.length})</span>
                <button
                  type="button"
                  onClick={clearAll}
                  data-action="clear-cf-rules"
                  className="text-[11px] text-gray-500 hover:text-red-600"
                >
                  전부 지우기
                </button>
              </div>
              <ul className="space-y-0.5">
                {currentRules.map((rule, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-2 rounded bg-gray-50 px-2 py-1"
                  >
                    <span className="truncate text-gray-700">
                      {describeRule(rule as ConditionalRule)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRule(i)}
                      aria-label={`규칙 ${i + 1} 삭제`}
                      data-cf-remove={i}
                      className="rounded px-1 text-[11px] text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
