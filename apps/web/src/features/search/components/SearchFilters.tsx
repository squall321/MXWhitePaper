/**
 * <SearchFilters /> — advanced filter chip row for the /search results page.
 *
 * Offered chips:
 *   - 부서 (part)        — slug input (or org-tree dropdown when host wires one).
 *   - 태그 (tag)         — single tag string (`TagAutocomplete` reuse on caller's side).
 *   - 작성자 (author)    — user id (string for now; caller can wrap with /users/search).
 *   - 기간 (date range)  — preset (전체 / 7일 / 30일 / 90일 / 사용자 지정).
 *
 * The component is a pure controlled component:
 *   - `value` / `onChange` is the single source of truth.
 *   - URL-state encoding helpers (`encodeFiltersToParams`, `decodeFiltersFromParams`)
 *     are exported so the routed page can keep `?q=&part=&tag=…` shareable.
 */
import { useMemo } from 'react'
import type { SearchFilters as SearchFilterValues } from '../api'
import { cn } from '@/components/ui/cn'

export type DatePreset = 'all' | '7d' | '30d' | '90d' | 'custom'

export interface SearchFiltersProps {
  value: SearchFilterValues
  onChange: (next: SearchFilterValues) => void
  /** Optional list of part slugs (org tree). Empty = freeform string. */
  parts?: { slug: string; name?: string }[]
  /** Currently selected preset; falls back to 'all' if `from`/`to` are unset. */
  preset?: DatePreset
  onPresetChange?: (p: DatePreset) => void
}

export function SearchFilters({
  value,
  onChange,
  parts,
  preset,
  onPresetChange,
}: SearchFiltersProps) {
  const computedPreset: DatePreset = preset ?? presetFromRange(value.from, value.to)
  const hasAny =
    !!value.part || !!value.tag || !!value.author || !!value.from || !!value.to

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white p-2">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
        필터
      </span>

      {/* 부서 */}
      <PartChip
        value={value.part ?? null}
        options={parts}
        onChange={(v) => onChange({ ...value, part: v })}
      />

      {/* 태그 */}
      <ChipInput
        label="태그"
        value={value.tag ?? null}
        onChange={(v) => onChange({ ...value, tag: v })}
        placeholder="태그 입력"
      />

      {/* 작성자 */}
      <ChipInput
        label="작성자"
        value={value.author ?? null}
        onChange={(v) => onChange({ ...value, author: v })}
        placeholder="user-id 또는 이름"
      />

      {/* 기간 */}
      <DateRangeChip
        preset={computedPreset}
        from={value.from ?? null}
        to={value.to ?? null}
        onPresetChange={(p) => {
          if (onPresetChange) onPresetChange(p)
          const range = rangeForPreset(p)
          onChange({ ...value, from: range.from, to: range.to })
        }}
        onCustomChange={(from, to) => {
          if (onPresetChange) onPresetChange('custom')
          onChange({ ...value, from, to })
        }}
      />

      {/* Selected pill row */}
      {hasAny && (
        <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-gray-100 pt-2">
          {value.part && (
            <Pill label={`부서: ${value.part}`} onRemove={() => onChange({ ...value, part: null })} />
          )}
          {value.tag && (
            <Pill label={`#${value.tag}`} onRemove={() => onChange({ ...value, tag: null })} />
          )}
          {value.author && (
            <Pill label={`@${value.author}`} onRemove={() => onChange({ ...value, author: null })} />
          )}
          {(value.from || value.to) && (
            <Pill
              label={`${value.from ?? '…'} ~ ${value.to ?? '…'}`}
              onRemove={() => onChange({ ...value, from: null, to: null })}
            />
          )}
          <button
            type="button"
            onClick={() =>
              onChange({ ...value, part: null, tag: null, author: null, from: null, to: null })
            }
            className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium text-smsg-700 hover:bg-smsg-50"
          >
            전체 초기화
          </button>
        </div>
      )}
    </div>
  )
}

function PartChip({
  value,
  options,
  onChange,
}: {
  value: string | null
  options?: { slug: string; name?: string }[]
  onChange: (v: string | null) => void
}) {
  const opts = options ?? []
  if (opts.length === 0) {
    return (
      <ChipInput label="부서" value={value} onChange={onChange} placeholder="part-slug" />
    )
  }
  return (
    <label className="inline-flex">
      <span className="sr-only">부서</span>
      <select
        aria-label="부서"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(
          'appearance-none rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
          value
            ? 'border-smsg-700 bg-smsg-700 text-white'
            : 'border-gray-300 bg-white text-gray-700 hover:border-smsg-300',
        )}
      >
        <option value="">부서: 전체</option>
        {opts.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name ?? p.slug}
          </option>
        ))}
      </select>
    </label>
  )
}

function ChipInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string | null
  onChange: (v: string | null) => void
  placeholder?: string
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[11px]">
      <span className="text-gray-500">{label}:</span>
      <input
        aria-label={label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        placeholder={placeholder}
        className="w-32 bg-transparent outline-none placeholder:text-gray-400"
      />
    </label>
  )
}

function DateRangeChip({
  preset,
  from,
  to,
  onPresetChange,
  onCustomChange,
}: {
  preset: DatePreset
  from: string | null
  to: string | null
  onPresetChange: (p: DatePreset) => void
  onCustomChange: (from: string | null, to: string | null) => void
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label="기간"
        value={preset}
        onChange={(e) => onPresetChange(e.target.value as DatePreset)}
        className={cn(
          'appearance-none rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
          preset !== 'all'
            ? 'border-smsg-700 bg-smsg-700 text-white'
            : 'border-gray-300 bg-white text-gray-700',
        )}
      >
        <option value="all">기간: 전체</option>
        <option value="7d">지난 7일</option>
        <option value="30d">지난 30일</option>
        <option value="90d">지난 90일</option>
        <option value="custom">사용자 지정</option>
      </select>
      {preset === 'custom' && (
        <>
          <input
            type="date"
            aria-label="시작 날짜"
            value={from ?? ''}
            onChange={(e) => onCustomChange(e.target.value || null, to)}
            className="rounded border border-gray-300 px-1 py-0.5 text-[11px]"
          />
          <span className="text-gray-400">~</span>
          <input
            type="date"
            aria-label="종료 날짜"
            value={to ?? ''}
            onChange={(e) => onCustomChange(from, e.target.value || null)}
            className="rounded border border-gray-300 px-1 py-0.5 text-[11px]"
          />
        </>
      )}
    </span>
  )
}

function Pill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-smsg-100 px-2 py-0.5 text-[11px] text-smsg-900">
      {label}
      <button
        type="button"
        aria-label={`${label} 제거`}
        onClick={onRemove}
        className="text-smsg-700 hover:text-red-600"
      >
        ×
      </button>
    </span>
  )
}

function presetFromRange(from?: string | null, to?: string | null): DatePreset {
  if (!from && !to) return 'all'
  return 'custom'
}

function rangeForPreset(p: DatePreset): { from: string | null; to: string | null } {
  if (p === 'all' || p === 'custom') return { from: null, to: null }
  const days = p === '7d' ? 7 : p === '30d' ? 30 : 90
  const today = new Date()
  const start = new Date(today.getTime() - days * 24 * 60 * 60 * 1000)
  return {
    from: ymd(start),
    to: ymd(today),
  }
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/**
 * Encode the current filters into URLSearchParams. Useful for shareable
 * `/search?q=&part=&tag=...` URLs.
 */
export function encodeFiltersToParams(q: string, f: SearchFilterValues): URLSearchParams {
  const sp = new URLSearchParams()
  if (q) sp.set('q', q)
  if (f.part) sp.set('part', f.part)
  if (f.tag) sp.set('tag', f.tag)
  if (f.author) sp.set('author', f.author)
  if (f.team) sp.set('team', f.team)
  if (f.from) sp.set('from', f.from)
  if (f.to) sp.set('to', f.to)
  if (typeof f.limit === 'number') sp.set('limit', String(f.limit))
  if (typeof f.offset === 'number') sp.set('offset', String(f.offset))
  return sp
}

/** Inverse of `encodeFiltersToParams`. */
export function decodeFiltersFromParams(sp: URLSearchParams): { q: string; filters: SearchFilterValues } {
  const get = (k: string) => sp.get(k) || null
  const q = sp.get('q') || ''
  return {
    q,
    filters: {
      part: get('part'),
      tag: get('tag'),
      author: get('author'),
      team: get('team'),
      from: get('from'),
      to: get('to'),
      limit: sp.has('limit') ? Number(sp.get('limit')) || undefined : undefined,
      offset: sp.has('offset') ? Number(sp.get('offset')) || undefined : undefined,
    },
  }
}

/** Re-export the type for convenience. */
export type { SearchFilterValues }

/** Memoized helper used in unit tests. */
export function useEncodedFilterUrl(q: string, f: SearchFilterValues): string {
  return useMemo(() => `/search?${encodeFiltersToParams(q, f).toString()}`, [q, f])
}
