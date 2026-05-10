import { useState } from 'react'
import type { TableBlock } from '@/types/document'

type Density = 'compact' | 'normal' | 'comfortable'
type Border = 'none' | 'horizontal' | 'all'
type Aggregate = '' | 'sum' | 'avg' | 'count' | 'min' | 'max'

interface Props {
  block: TableBlock
  /** Number of columns — used to pad/trim the footer aggregates array. */
  colCount: number
  /** Patches partial fields onto the local table block (debounced upstream). */
  onChange: (patch: Partial<TableBlock>) => void
}

/**
 * Collapsible "표 옵션" panel surfaced from the table editor toolbar.
 *
 * Groups every table-level switch (display + interaction + footer) so the
 * default editor stays uncluttered for casual users while power users can
 * dial in formatting in one place. All edits flow back through `onChange`
 * which the editor merges into its debounced save pipeline.
 */
export function TableOptionsPanel({ block, colCount, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const opts = block.options ?? {}
  const density = (opts.density ?? 'normal') as Density
  const border = (opts.borderStyle ?? 'horizontal') as Border
  const stripe = opts.stripe !== false
  const stickyFirstCol = !!opts.stickyFirstCol
  const rowNumbers = !!opts.rowNumbers
  const searchable = !!opts.searchable
  const sortable = !!opts.sortable
  const footer = block.footer ?? {}
  const footerShow = !!footer.show
  const aggs = footer.aggregates ?? []

  const setOpt = <K extends keyof NonNullable<TableBlock['options']>>(
    key: K,
    value: NonNullable<TableBlock['options']>[K],
  ) => {
    onChange({ options: { ...opts, [key]: value } })
  }

  const setFooter = (patch: Partial<NonNullable<TableBlock['footer']>>) => {
    onChange({ footer: { ...footer, ...patch } })
  }

  const setAggregate = (col: number, kind: Aggregate) => {
    const next: Aggregate[] = []
    for (let i = 0; i < colCount; i++) next.push((aggs[i] as Aggregate) ?? '')
    next[col] = kind
    setFooter({ aggregates: next })
  }

  return (
    <div data-table-options className="rounded border border-gray-200 bg-white text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-gray-700 hover:bg-gray-50"
        aria-expanded={open}
        data-action="toggle-table-options"
      >
        <span className="font-semibold">⚙ 표 옵션</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-3 border-t border-gray-200 px-3 py-3 sm:grid-cols-2">
          {/* ── 표시 ──────────────────────────────────────── */}
          <fieldset className="space-y-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              표시
            </legend>
            <Toggle
              label="줄무늬"
              checked={stripe}
              onChange={(v) => setOpt('stripe', v)}
            />
            <Toggle
              label="첫 열 고정"
              checked={stickyFirstCol}
              onChange={(v) => setOpt('stickyFirstCol', v)}
            />
            <Toggle
              label="행 번호"
              checked={rowNumbers}
              onChange={(v) => setOpt('rowNumbers', v)}
            />
            <SelectRow
              label="밀도"
              value={density}
              onChange={(v) => setOpt('density', v as Density)}
              options={[
                { value: 'compact', label: '촘촘' },
                { value: 'normal', label: '보통' },
                { value: 'comfortable', label: '여유' },
              ]}
            />
            <SelectRow
              label="격자선"
              value={border}
              onChange={(v) => setOpt('borderStyle', v as Border)}
              options={[
                { value: 'horizontal', label: '가로만' },
                { value: 'all', label: '전체' },
                { value: 'none', label: '없음' },
              ]}
            />
          </fieldset>

          {/* ── 인터랙션 ─────────────────────────────────── */}
          <fieldset className="space-y-1">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              인터랙션
            </legend>
            <Toggle
              label="헤더 클릭 정렬"
              checked={sortable}
              onChange={(v) => setOpt('sortable', v)}
            />
            <Toggle
              label="행 검색박스"
              checked={searchable}
              onChange={(v) => setOpt('searchable', v)}
            />
          </fieldset>

          {/* ── Footer 집계 ────────────────────────────── */}
          <fieldset className="space-y-1 sm:col-span-2">
            <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              합계 행
            </legend>
            <Toggle
              label="합계 행 표시"
              checked={footerShow}
              onChange={(v) => setFooter({ show: v })}
            />
            {footerShow && (
              <>
                <label className="flex items-center gap-2">
                  <span className="w-16 text-gray-600">라벨</span>
                  <input
                    type="text"
                    value={footer.label ?? ''}
                    onChange={(e) => setFooter({ label: e.target.value })}
                    placeholder="합계"
                    className="flex-1 rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
                  />
                </label>
                <div className="space-y-1">
                  <span className="text-gray-600">컬럼별 집계</span>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: colCount }).map((_, c) => {
                      const cur = (aggs[c] as Aggregate) ?? ''
                      return (
                        <select
                          key={c}
                          value={cur}
                          onChange={(e) => setAggregate(c, e.target.value as Aggregate)}
                          aria-label={`${c + 1}열 집계`}
                          className="rounded border border-gray-300 px-1 py-0.5 text-[11px] focus:border-smsg-500 focus:outline-none"
                        >
                          <option value="">{c + 1}열: —</option>
                          <option value="sum">합계</option>
                          <option value="avg">평균</option>
                          <option value="count">개수</option>
                          <option value="min">최소</option>
                          <option value="max">최대</option>
                        </select>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </fieldset>
        </div>
      )}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-16 text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
