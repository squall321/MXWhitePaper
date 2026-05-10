import type { Infobox as InfoboxData, InfoboxRich } from '@/types/document'

/**
 * Right-side wiki infobox. Renders `metadata.infobox` as a simple key/value
 * table. Each value can be:
 *   - string                  (plain text)
 *   - string[]                (bullet list)
 *   - InfoboxRich             (text with optional href / icon / badge / color)
 *   - InfoboxRich[]           (bullet list of rich entries)
 *
 * The schema is intentionally permissive (`oneOf`) so existing string-only
 * data keeps rendering identically while authors can opt into richer
 * presentation per row.
 */
export function Infobox({ data }: { data: InfoboxData }) {
  const entries = Object.entries(data).filter(
    (e): e is [string, AnyValue] => e[1] !== undefined,
  )
  if (entries.length === 0) return null

  return (
    <aside className="w-full rounded border border-gray-200 bg-smsg-100">
      <div className="border-b border-gray-200 bg-smsg-700 px-3 py-1.5 text-sm font-semibold text-white">
        주요 정보
      </div>
      <table className="w-full table-fixed text-sm">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-b border-gray-200 last:border-b-0">
              <th className="w-1/3 bg-smsg-100 px-3 py-2 text-left align-top text-xs font-semibold uppercase tracking-wide text-smsg-700">
                {key}
              </th>
              <td className="bg-white px-3 py-2 align-top text-smsg-900">
                {renderValue(value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  )
}

type AnyValue = string | string[] | InfoboxRich | InfoboxRich[]

function renderValue(value: AnyValue) {
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc pl-4">
        {value.map((v, i) => (
          <li key={i}>{renderScalar(v)}</li>
        ))}
      </ul>
    )
  }
  return renderScalar(value)
}

function renderScalar(v: string | InfoboxRich) {
  if (typeof v === 'string') return v
  return <RichValue v={v} />
}

const BADGE_CLASSES: Record<NonNullable<InfoboxRich['badge']>, string> = {
  success: 'bg-green-100 text-green-800',
  info: 'bg-blue-100 text-blue-800',
  warn: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-800',
  neutral: 'bg-gray-100 text-gray-700',
}

/**
 * Render a single InfoboxRich value. Order of precedence for color:
 *   - `badge` (full background pill, takes priority)
 *   - explicit `color` (text color only)
 *   - default
 *
 * `href` wraps the result in an <a>. `icon` renders before the text with
 * a small gap so emojis read as a leading affordance.
 */
function RichValue({ v }: { v: InfoboxRich }) {
  const inner = (
    <span className="inline-flex items-center gap-1">
      {v.icon && <span aria-hidden="true">{v.icon}</span>}
      {v.badge ? (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_CLASSES[v.badge]}`}
        >
          {v.text}
        </span>
      ) : (
        <span style={v.color ? { color: v.color } : undefined}>{v.text}</span>
      )}
    </span>
  )
  if (v.href) {
    return (
      <a
        href={v.href}
        className="text-smsg-700 underline-offset-2 hover:underline"
        target={v.href.startsWith('http') ? '_blank' : undefined}
        rel={v.href.startsWith('http') ? 'noreferrer' : undefined}
      >
        {inner}
      </a>
    )
  }
  return inner
}
