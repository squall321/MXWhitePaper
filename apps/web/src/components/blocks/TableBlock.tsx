import type { TableBlock } from '@/types/document'
import { Inline } from '../wiki/Inline'

/**
 * Table block — sticky header, zebra rows, horizontal scroll on small
 * screens. Cell text runs through the inline parser so wiki links inside
 * cells are clickable.
 */
export function TableBlockView({ block }: { block: TableBlock }) {
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200 shadow-sm">
      <table className="w-full min-w-[480px] border-collapse text-left text-sm">
        <thead className="sticky top-0 bg-smsg-50 text-smsg-900">
          <tr>
            {block.headers.map((h, i) => (
              <th
                key={i}
                className="border-b border-smsg-100 px-3 py-2 font-semibold whitespace-nowrap"
                scope="col"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr
              key={r}
              className="odd:bg-white even:bg-gray-50 transition-colors hover:bg-smsg-50/50"
            >
              {row.map((cell, c) => (
                <td
                  key={c}
                  className="border-b border-gray-100 px-3 py-2 align-top text-gray-800"
                >
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
