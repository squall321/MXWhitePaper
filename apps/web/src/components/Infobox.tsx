import type { Infobox as InfoboxData } from '@/types/document'

/**
 * Right-side wiki infobox. Renders `metadata.infobox` as a simple key/value
 * table. Arrays are rendered as a bullet list inside the value cell.
 */
export function Infobox({ data }: { data: InfoboxData }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return null

  return (
    <aside className="float-right ml-6 mb-4 w-72 rounded border border-gray-200 bg-smsg-100">
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
                {Array.isArray(value) ? (
                  <ul className="list-disc pl-4">
                    {value.map((v, i) => (
                      <li key={i}>{v}</li>
                    ))}
                  </ul>
                ) : (
                  value
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  )
}
