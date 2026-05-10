import { useEffect, useRef, useState } from 'react'
import type { Infobox as InfoboxData, InfoboxRich, Slug } from '@/types/document'
import { patchInfobox, isPreconditionFailed } from '../api'
import { useEditorStore } from '../state'
import { useT } from '@/lib/i18n'

interface Props {
  slug: Slug
  data: InfoboxData
}

type Mode = 'string' | 'list'

interface Row {
  key: string
  /** Plain text (mode=string) or comma-separated items (mode=list). */
  value: string
  mode: Mode
  /**
   * Optional rich-presentation overlay. When any field here is set, the
   * row serializes as an InfoboxRich object (or array of objects when
   * mode=list) instead of a plain string. Empty rich = serialize as plain.
   */
  rich: RichOverlay
}

type RichOverlay = {
  href?: string
  icon?: string
  badge?: NonNullable<InfoboxRich['badge']>
  color?: string
}

const BADGE_OPTIONS: { value: NonNullable<InfoboxRich['badge']> | ''; label: string }[] = [
  { value: '', label: '뱃지 없음' },
  { value: 'success', label: '✓ 성공' },
  { value: 'info', label: 'ℹ 정보' },
  { value: 'warn', label: '⚠ 주의' },
  { value: 'danger', label: '✕ 위험' },
  { value: 'neutral', label: '— 회색' },
]

/**
 * Infobox(주요 정보) editor. Each row is a label/value pair with three
 * value modes:
 *   - 단일 문자열 (default)
 *   - 콤마로 구분되는 항목 리스트 (• 항목 1 / 항목 2 …)
 *   - 풍부 표현(InfoboxRich): 위 모드 + 링크 / 이모지 / 뱃지 / 텍스트 색
 *
 * The "풍부" overlay is hidden behind a ✦ popover so the default editor
 * stays simple; once any rich field is set the renderer surfaces a small
 * indicator next to the value so the author knows the row is decorated.
 */
export function InfoboxEditor({ slug, data }: Props) {
  const t = useT()
  const etag = useEditorStore((s) => s.etag)
  const apply = useEditorStore((s) => s.applyServerSnapshot)
  const setConflict = useEditorStore((s) => s.setConflict)

  const [rows, setRows] = useState<Row[]>(() => objectToRows(data))
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    setRows(objectToRows(data))
  }, [data])

  useEffect(() => {
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    }
  }, [])

  const schedule = (next: Row[]) => {
    setRows(next)
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void persist(next)
    }, 800)
  }

  const persist = async (next: Row[]) => {
    if (!etag) return
    try {
      const payload = rowsToObject(next)
      const result = await patchInfobox(
        slug,
        payload,
        etag,
        t('editor.infobox.changeLog'),
      )
      apply(result.document, result.etag)
      setError(null)
    } catch (err) {
      if (isPreconditionFailed(err)) {
        setConflict(null)
        setError(t('editor.common.conflict'))
      } else {
        setError((err as Error).message)
      }
    }
  }

  const setRow = (idx: number, patch: Partial<Row>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    schedule(next)
  }
  const setRich = (idx: number, patch: Partial<RichOverlay>) => {
    const next = rows.map((r, i) =>
      i === idx ? { ...r, rich: pruneRich({ ...r.rich, ...patch }) } : r,
    )
    schedule(next)
  }
  const addRow = () => {
    schedule([...rows, { key: '', value: '', mode: 'string', rich: {} }])
  }
  const removeRow = (idx: number) => {
    schedule(rows.filter((_, i) => i !== idx))
  }
  const moveRow = (idx: number, dir: -1 | 1) => {
    const j = idx + dir
    if (j < 0 || j >= rows.length) return
    const next = rows.slice()
    const [r] = next.splice(idx, 1)
    if (!r) return
    next.splice(j, 0, r)
    schedule(next)
  }

  return (
    <aside
      data-infobox-editor
      className="w-full rounded border border-gray-200 bg-smsg-100"
    >
      <div className="flex items-center justify-between border-b border-gray-200 bg-smsg-700 px-3 py-1.5 text-sm font-semibold text-white">
        <span>{t('editor.infobox.heading')}</span>
        <button
          type="button"
          onClick={addRow}
          aria-label={t('editor.infobox.addRow')}
          title={t('editor.infobox.addRow')}
          className="rounded px-2 text-xs text-white/90 hover:bg-white/15"
        >
          + 행
        </button>
      </div>
      <table className="w-full table-fixed text-sm">
        <tbody>
          {rows.map((row, idx) => {
            const isRich = !isRichEmpty(row.rich)
            return (
              <tr key={idx} className="group/row border-b border-gray-200 last:border-b-0">
                <th className="w-1/3 bg-smsg-100 px-2 py-1 text-left align-top">
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => setRow(idx, { key: e.target.value })}
                    placeholder={t('editor.infobox.keyPlaceholder')}
                    aria-label={t('editor.infobox.keyLabel', { n: idx + 1 })}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold uppercase tracking-wide text-smsg-700 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
                  />
                </th>
                <td className="bg-white px-2 py-1 align-top text-smsg-900">
                  <div className="flex items-start gap-1">
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => setRow(idx, { value: e.target.value })}
                      placeholder={
                        row.mode === 'list'
                          ? t('editor.infobox.valueListPlaceholder')
                          : t('editor.infobox.valuePlaceholder')
                      }
                      aria-label={t('editor.infobox.valueLabel', { n: idx + 1 })}
                      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-gray-200 focus:border-smsg-500 focus:bg-white focus:outline-none"
                    />
                    <RichPopover
                      rich={row.rich}
                      onChange={(patch) => setRich(idx, patch)}
                      isActive={isRich}
                    />
                  </div>
                  <div className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-gray-500 opacity-0 transition-opacity group-hover/row:opacity-100">
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={row.mode === 'list'}
                        onChange={(e) =>
                          setRow(idx, { mode: e.target.checked ? 'list' : 'string' })
                        }
                        className="h-3 w-3"
                      />
                      {t('editor.infobox.asList')}
                    </label>
                    <button
                      type="button"
                      onClick={() => moveRow(idx, -1)}
                      disabled={idx === 0}
                      aria-label={t('editor.infobox.moveUp')}
                      className="rounded px-1 hover:bg-smsg-100 disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(idx, 1)}
                      disabled={idx === rows.length - 1}
                      aria-label={t('editor.infobox.moveDown')}
                      className="rounded px-1 hover:bg-smsg-100 disabled:opacity-30"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      aria-label={t('editor.infobox.remove')}
                      className="rounded px-1 hover:bg-red-50 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={2}
                className="bg-white px-3 py-3 text-center text-xs text-gray-500"
              >
                {t('editor.infobox.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {error && (
        <p
          role="status"
          aria-live="polite"
          className="border-t border-red-200 bg-red-50 px-3 py-1 text-xs text-red-700"
        >
          {error}
        </p>
      )}
    </aside>
  )
}

/**
 * The ✦ popover holds the rich overlay fields: link URL, icon, badge,
 * text color. Everything optional. When any field is set the trigger
 * button glows so the author knows the row is decorated even when the
 * popover is closed.
 */
function RichPopover({
  rich,
  onChange,
  isActive,
}: {
  rich: RichOverlay
  onChange: (patch: Partial<RichOverlay>) => void
  isActive: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return
      if (e.target instanceof Node && ref.current.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="풍부 표현 (링크/아이콘/뱃지)"
        title="풍부 표현 (링크/아이콘/뱃지/색)"
        className={`rounded px-1 text-[11px] hover:bg-smsg-100 ${isActive ? 'bg-smsg-100 text-smsg-700' : 'text-gray-400'}`}
        data-action="open-infobox-rich"
      >
        ✦
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-60 space-y-2 rounded border border-gray-200 bg-white p-3 text-xs shadow-lg"
        >
          <label className="block">
            <span className="mb-1 block font-semibold text-gray-700">링크 URL</span>
            <input
              type="text"
              value={rich.href ?? ''}
              onChange={(e) => onChange({ href: e.target.value || undefined })}
              placeholder="https://… / mailto:… / /docs/…"
              className="w-full rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold text-gray-700">아이콘</span>
            <input
              type="text"
              value={rich.icon ?? ''}
              onChange={(e) => onChange({ icon: e.target.value || undefined })}
              placeholder="📞 ✉️ 👤 …"
              className="w-full rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold text-gray-700">뱃지</span>
            <select
              value={rich.badge ?? ''}
              onChange={(e) =>
                onChange({
                  badge: (e.target.value || undefined) as
                    | NonNullable<InfoboxRich['badge']>
                    | undefined,
                })
              }
              className="w-full rounded border border-gray-300 px-2 py-1 focus:border-smsg-500 focus:outline-none"
            >
              {BADGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold text-gray-700">텍스트 색 (#RRGGBB)</span>
            <input
              type="text"
              value={rich.color ?? ''}
              onChange={(e) => {
                const v = e.target.value.trim()
                if (!v) {
                  onChange({ color: undefined })
                  return
                }
                if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) onChange({ color: v })
              }}
              placeholder="#1F2937"
              className="w-full rounded border border-gray-300 px-2 py-1 font-mono focus:border-smsg-500 focus:outline-none"
            />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => onChange({ href: undefined, icon: undefined, badge: undefined, color: undefined })}
              className="rounded border border-gray-200 px-2 py-1 text-gray-500 hover:bg-gray-50"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded bg-smsg-700 px-2 py-1 text-white hover:bg-smsg-900"
            >
              완료
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function pruneRich(r: RichOverlay): RichOverlay {
  const out: RichOverlay = {}
  if (r.href) out.href = r.href
  if (r.icon) out.icon = r.icon
  if (r.badge) out.badge = r.badge
  if (r.color) out.color = r.color
  return out
}

function isRichEmpty(r: RichOverlay): boolean {
  return !r.href && !r.icon && !r.badge && !r.color
}

function objectToRows(data: InfoboxData | undefined): Row[] {
  if (!data) return []
  return Object.entries(data)
    .filter((entry): entry is [string, NonNullable<InfoboxData[string]>] => entry[1] !== undefined)
    .map(([key, value]) => valueToRow(key, value))
}

function valueToRow(
  key: string,
  value: NonNullable<InfoboxData[string]>,
): Row {
  // string[]                     → list mode, no rich
  if (Array.isArray(value)) {
    if (value.length === 0) return { key, value: '', mode: 'list', rich: {} }
    if (typeof value[0] === 'string') {
      return { key, value: (value as string[]).join(', '), mode: 'list', rich: {} }
    }
    // InfoboxRich[] — flatten texts comma-separated, take rich overlay
    // from the first element. List-of-rich is rare; this preserves the
    // payload on round-trip without bloating the editor.
    const list = value as InfoboxRich[]
    const first = list[0] ?? { text: '' }
    return {
      key,
      value: list.map((r) => r.text).join(', '),
      mode: 'list',
      rich: pruneRich({ href: first.href, icon: first.icon, badge: first.badge, color: first.color }),
    }
  }
  if (typeof value === 'string') {
    return { key, value, mode: 'string', rich: {} }
  }
  // InfoboxRich
  const r = value as InfoboxRich
  return {
    key,
    value: r.text,
    mode: 'string',
    rich: pruneRich({ href: r.href, icon: r.icon, badge: r.badge, color: r.color }),
  }
}

function rowsToObject(
  rows: Row[],
): Record<string, string | string[] | InfoboxRich | InfoboxRich[] | null> {
  const out: Record<string, string | string[] | InfoboxRich | InfoboxRich[] | null> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    const rich = row.rich
    const hasRich = !isRichEmpty(rich)
    if (row.mode === 'list') {
      const items = row.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (items.length === 0) continue
      if (hasRich) {
        out[key] = items.map((text) => ({ text, ...rich })) as InfoboxRich[]
      } else {
        out[key] = items
      }
    } else {
      const v = row.value.trim()
      if (!v) continue
      if (hasRich) {
        out[key] = { text: v, ...rich } as InfoboxRich
      } else {
        out[key] = v
      }
    }
  }
  return out
}
